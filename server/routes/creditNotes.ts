import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma, CreditNoteStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { postCreditNote } from '../services/accounting/arService';
import { findTaxCode, resolveTaxCode, taxAmountFor, ruleSnapshot, recordTaxTransaction } from '../services/accounting/taxService';
import { getAccountingProfile, requireMappedAccount } from '../services/accounting/context';
import { postJournalInTransaction } from '../services/accounting/journal';
import { emitDomainEvent } from '../services/accounting/audit';
import { money, mul, dec } from '../services/accounting/money';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

const creditNoteItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  description: z.string().min(1).max(500),
  quantity: moneyValue,
  unitPrice: moneyValue,
  taxClassification: z.nativeEnum(Prisma.TaxClassification).default(Prisma.TaxClassification.STANDARD_16),
});

const createCreditNoteSchema = z.object({
  salesInvoiceId: z.string().uuid('Invalid invoice ID'),
  creditNoteNumber: z.string().min(1).max(50),
  reason: z.string().min(1).max(500),
  items: z.array(creditNoteItemSchema).min(1, 'At least one item required'),
  branchId: z.string().uuid().optional().nullable(),
});

const creditNoteParamsSchema = z.object({
  id: z.string().uuid('Invalid credit note ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

const postSchema = z.object({
  // Empty body; the credit note is already created as a draft.
});

// GET /api/credit-notes
router.get(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'),
  validateQuery(listQuerySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, invoiceId, customerId, fromDate, toDate } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.CreditNoteWhereInput = {
      organizationId: req.user!.organizationId,
      ...(invoiceId ? { salesInvoiceId: invoiceId } : {}),
      ...(customerId ? { salesInvoice: { customerId } } : {}),
    };

    if (fromDate || toDate) {
      where.issuedAt = {};
      if (fromDate) where.issuedAt.gte = new Date(fromDate);
      if (toDate) where.issuedAt.lte = new Date(toDate);
    }

    const [creditNotes, total] = await Promise.all([
      prisma.creditNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: { issuedAt: 'desc' },
        include: {
          salesInvoice: {
            select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true, customerCode: true } } },
          },
        },
      }),
      prisma.creditNote.count({ where }),
    ]);

    res.json({
      data: creditNotes,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// GET /api/credit-notes/:id
router.get(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'),
  validateParams(creditNoteParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const creditNote = await prisma.creditNote.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        salesInvoice: {
          include: {
            customer: { select: { id: true, name: true, customerCode: true, email: true } },
            items: { include: { product: { select: { id: true, sku: true, name: true } } } },
          },
        },
      },
    });

    if (!creditNote) throw new AppError(404, 'NOT_FOUND', 'Credit note not found');

    res.json({ data: creditNote });
  })
);

// POST /api/credit-notes (create as draft)
router.post(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateBody(createCreditNoteSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = req.body;

    const invoice = await prisma.salesInvoice.findFirst({
      where: { id: data.salesInvoiceId, organizationId: req.user!.organizationId },
      include: { customer: true, items: { include: { product: true } } },
    });

    if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');

    const existing = await prisma.creditNote.findFirst({
      where: { organizationId: req.user!.organizationId, creditNoteNumber: data.creditNoteNumber },
    });
    if (existing) throw new AppError(409, 'DUPLICATE_CREDIT_NOTE_NUMBER', 'Credit note number already exists in this organization');

    let subtotal = dec(0);
    let taxTotal = dec(0);

    for (const item of data.items) {
      const qty = dec(item.quantity);
      const price = dec(item.unitPrice);
      const lineSubtotal = mul(qty, price);
      subtotal = subtotal.plus(lineSubtotal);

      const profile = await getAccountingProfile(prisma, req.user!.organizationId);
      const rule = await resolveTaxCode(
        prisma,
        req.user!.organizationId,
        { code: { 'STANDARD_16': 'KE-VAT-STD', 'ZERO_RATED': 'KE-VAT-ZERO', 'EXEMPT': 'KE-VAT-EXEMPT' }[item.taxClassification] ?? 'KE-VAT-STD' },
        invoice.invoiceDate,
        'SALES'
      );

      const tax = rule ? taxAmountFor(lineSubtotal, rule.ratePercent) : dec(0);
      taxTotal = taxTotal.plus(tax);
    }

    const totalAmount = subtotal.plus(taxTotal);

    const creditNote = await prisma.creditNote.create({
      data: {
        organizationId: req.user!.organizationId,
        salesInvoiceId: data.salesInvoiceId,
        creditNoteNumber: data.creditNoteNumber,
        reason: data.reason,
        totalAmount,
        taxAmount: taxTotal,
        subtotal,
        issuedAt: new Date(),
        status: CreditNoteStatus.DRAFT,
        branchId: data.branchId ?? invoice.branchId,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        createdBy: req.user!.id,
      },
      include: {
        salesInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
      },
    });

    res.status(201).json({
      data: creditNote,
      message: 'Credit note created as draft. Call POST /api/credit-notes/:id/post to post it to the ledger.',
    });
  })
);

// POST /api/credit-notes/:id/post
router.post(
  '/:id/post',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(creditNoteParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await postCreditNote(
      req.user!.organizationId,
      req.params.id,
      req.user!.id,
      { ipAddress: req.ip ?? null }
    );

    res.status(result.created ? 201 : 200).json({
      data: { creditNote: result.creditNote, journal: result.journal },
      meta: { created: result.created, idempotentReplay: !result.created },
      message: result.created ? 'Credit note posted to the ledger' : 'Credit note already posted (idempotent replay)',
    });
  })
);

// DELETE /api/credit-notes/:id (drafts only)
router.delete(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(creditNoteParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const creditNote = await prisma.creditNote.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });

    if (!creditNote) throw new AppError(404, 'NOT_FOUND', 'Credit note not found');
    if (creditNote.status !== CreditNoteStatus.DRAFT) {
      throw new AppError(
        409,
        'CREDIT_NOTE_IMMUTABLE',
        'A posted credit note cannot be deleted. Reverse the journal instead.'
      );
    }

    await prisma.creditNote.delete({ where: { id: creditNote.id } });

    res.json({ data: { deleted: true }, message: 'Draft credit note deleted' });
  })
);

export default router;