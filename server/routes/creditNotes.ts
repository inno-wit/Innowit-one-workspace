import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const creditNoteItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  taxClassification: z.enum(['STANDARD_16', 'ZERO_RATED', 'EXEMPT', 'WITHHOLDING']).default('STANDARD_16'),
});

const createCreditNoteSchema = z.object({
  salesInvoiceId: z.string().uuid('Invalid invoice ID'),
  creditNoteNumber: z.string().min(1, 'Credit note number is required').max(50),
  reason: z.string().min(1, 'Reason is required').max(500),
  items: z.array(creditNoteItemSchema).min(1, 'At least one item required'),
});

const creditNoteParamsSchema = z.object({
  id: z.string().uuid('Invalid credit note ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// Tax calculation helper
function calculateTax(amount: number, classification: string): number {
  switch (classification) {
    case 'STANDARD_16': return amount * 0.16;
    case 'ZERO_RATED': return 0;
    case 'EXEMPT': return 0;
    case 'WITHHOLDING': return amount * 0.05;
    default: return amount * 0.16;
  }
}

// GET /api/credit-notes
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, invoiceId, customerId, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    salesInvoice: { customer: { organizationId: req.user!.organizationId } },
  };

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.salesInvoice = { ...where.salesInvoice, branchId: req.user!.branchId };
  }

  if (invoiceId) where.salesInvoiceId = invoiceId;
  if (customerId) where.salesInvoice = { ...where.salesInvoice, customerId };
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
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { id: true, name: true, customerCode: true } },
          },
        },
      },
    }),
    prisma.creditNote.count({ where }),
  ]);

  res.json({
    data: creditNotes,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/credit-notes/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'), validateParams(creditNoteParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const creditNote = await prisma.creditNote.findUnique({
    where: { id },
    include: {
      salesInvoice: {
        include: {
          customer: { select: { id: true, name: true, customerCode: true, email: true } },
          items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      },
    },
  });

  if (!creditNote) {
    throw new AppError(404, 'NOT_FOUND', 'Credit note not found');
  }

  if (creditNote.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: creditNote });
}));

// POST /api/credit-notes
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateBody(createCreditNoteSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify invoice
  const invoice = await prisma.salesInvoice.findUnique({
    where: { id: data.salesInvoiceId },
    include: { 
      customer: true, 
      items: { include: { product: true } },
      etimsInvoice: true,
    },
  });

  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check if invoice has eTIMS record (required for credit notes in Kenya)
  if (!invoice.etimsInvoice) {
    throw new AppError(400, 'NO_ETIMS', 'Cannot create credit note for invoice not submitted to eTIMS');
  }

  // Verify credit note number uniqueness
  const existing = await prisma.creditNote.findUnique({
    where: { creditNoteNumber: data.creditNoteNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_CREDIT_NOTE_NUMBER', 'Credit note number already exists');
  }

  // Validate items don't exceed original invoice quantities
  for (const item of data.items) {
    const originalItem = invoice.items.find(i => i.productId === item.productId);
    if (!originalItem) {
      throw new AppError(400, 'INVALID_ITEM', `Product ${item.productId} not in original invoice`);
    }
    if (item.quantity > Number(originalItem.quantity)) {
      throw new AppError(400, 'EXCEEDS_ORIGINAL', `Quantity exceeds original invoice quantity for ${originalItem.product.name}`);
    }
  }

  // Calculate totals
  let totalAmount = 0;
  let taxAmount = 0;

  const itemsWithCalculations = data.items.map((item: any) => {
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineTax = calculateTax(lineSubtotal, item.taxClassification);
    totalAmount += lineSubtotal;
    taxAmount += lineTax;
    return {
      ...item,
      taxAmount: lineTax,
      lineTotal: lineSubtotal + lineTax,
    };
  });

  // Create credit note and reverse journal entry
  const creditNote = await prisma.$transaction(async (tx) => {
    // Create credit note
    const newCreditNote = await tx.creditNote.create({
      data: {
        salesInvoiceId: data.salesInvoiceId,
        creditNoteNumber: data.creditNoteNumber,
        reason: data.reason,
        totalAmount,
        taxAmount,
        issuedAt: new Date(),
      },
      include: {
        salesInvoice: {
          select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } },
        },
      },
    });

    // Get accounts for reversal
    const accounts = await tx.account.findMany({
      where: { 
        organizationId: req.user!.organizationId,
        isActive: true,
      },
    });

    const arAccount = accounts.find(a => a.accountNumber === '1200') || accounts.find(a => a.type === 'ASSET');
    const revenueAccount = accounts.find(a => a.accountNumber === '4000') || accounts.find(a => a.type === 'REVENUE');
    const vatAccount = accounts.find(a => a.accountNumber === '2200') || accounts.find(a => a.type === 'LIABILITY');

    if (arAccount && revenueAccount && vatAccount) {
      // Create reversing journal entry
      await tx.journalEntry.create({
        data: {
          organizationId: req.user!.organizationId,
          entryNumber: `JE-CN-${data.creditNoteNumber}`,
          postingDate: new Date(),
          sourceModule: 'CREDIT_NOTE',
          sourceId: newCreditNote.id,
          description: `Credit Note ${data.creditNoteNumber} for Invoice ${invoice.invoiceNumber} - ${data.reason}`,
          lines: {
            create: [
              {
                accountId: revenueAccount.id,
                description: 'Sales Returns',
                debit: totalAmount,
                credit: 0,
              },
              {
                accountId: vatAccount.id,
                description: 'VAT Output Reversal',
                debit: taxAmount,
                credit: 0,
              },
              {
                accountId: arAccount.id,
                description: `AR - ${invoice.customer.name} (Credit)`,
                debit: 0,
                credit: totalAmount + taxAmount,
              },
            ],
          },
        },
      });

      // Update balances
      await tx.account.update({
        where: { id: arAccount.id },
        data: { currentBalance: { increment: -(totalAmount + taxAmount) } },
      });
      await tx.account.update({
        where: { id: revenueAccount.id },
        data: { currentBalance: { increment: -totalAmount } },
      });
      await tx.account.update({
        where: { id: vatAccount.id },
        data: { currentBalance: { increment: -taxAmount } },
      });
    }

    // Create stock movements for returned items
    for (const item of data.items) {
      const warehouse = await tx.warehouse.findFirst({
        where: { branchId: invoice.branchId },
      });

      if (warehouse) {
        // Restore stock
        await tx.warehouseStock.upsert({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouse.id,
            },
          },
          create: {
            productId: item.productId,
            warehouseId: warehouse.id,
            quantityOnHand: item.quantity,
            quantityReserved: 0,
          },
          update: {
            quantityOnHand: { increment: item.quantity },
          },
        });

        // Create stock movement
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: warehouse.id,
            movementType: 'RETURN',
            quantity: item.quantity,
            unitCost: item.unitPrice,
            referenceDocument: data.creditNoteNumber,
            notes: `Return from credit note ${data.creditNoteNumber}`,
          },
        });
      }
    }

    // Create eTIMS transmission queue for credit note
    await tx.etimsTransmissionQueue.create({
      data: {
        salesInvoiceId: data.salesInvoiceId,
        idempotencyKey: `CN-${data.creditNoteNumber}-${Date.now()}`,
        status: 'PENDING',
        payloadJson: JSON.stringify({ creditNoteId: newCreditNote.id, type: 'CREDIT_NOTE' }),
      },
    });

    return newCreditNote;
  });

  res.status(201).json({ 
    data: creditNote, 
    message: 'Credit note created, journal entry reversed, stock restored, and queued for eTIMS' 
  });
}));

export default router;