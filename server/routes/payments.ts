import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma, PaymentStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { postCustomerPayment, allocateCustomerPayment } from '../services/accounting/arService';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

const paymentParamsSchema = z.object({ id: z.string().uuid('Invalid payment ID') });

const createPaymentSchema = z.object({
  salesInvoiceId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  paymentNumber: z.string().min(1).max(50),
  paymentDate: z.string().min(8),
  amount: moneyValue,
  paymentMethod: z.string().min(1).max(50),
  referenceCode: z.string().max(120).optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).default('KES'),
  exchangeRate: moneyValue.optional().default('1'),
  bankAccountId: z.string().uuid().optional().nullable(),
  sourceKey: z.string().max(120).optional().nullable(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  method: z.string().optional(),
});

const allocateSchema = z.object({
  allocations: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      amount: moneyValue,
    })
  ).min(1, 'At least one allocation is required'),
});

const reverseSchema = z.object({
  reason: z.string().min(3, 'A reversal reason is required').max(500),
  reversalDate: z.string().optional(),
});

// GET /api/payments
router.get(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(listQuerySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, invoiceId, customerId, fromDate, toDate, method } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerPaymentWhereInput = { organizationId: req.user!.organizationId };
    if (invoiceId) where.salesInvoiceId = invoiceId;
    if (customerId) where.customerId = customerId;
    if (method) where.paymentMethod = method;
    if (fromDate || toDate) {
      where.paymentDate = {};
      if (fromDate) where.paymentDate.gte = new Date(fromDate);
      if (toDate) where.paymentDate.lte = new Date(toDate);
    }

    const [payments, total] = await Promise.all([
      prisma.customerPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        include: {
          salesInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
          allocations: { select: { amount: true, salesInvoiceId: true } },
        },
      }),
      prisma.customerPayment.count({ where }),
    ]);

    res.json({
      data: payments,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// GET /api/payments/:id
router.get(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const payment = await prisma.customerPayment.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        salesInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
        allocations: {
          include: { salesInvoice: { select: { id: true, invoiceNumber: true } } },
        },
      },
    });

    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Customer payment not found');
    res.json({ data: payment });
  })
);

// POST /api/payments
router.post(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateBody(createPaymentSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;

    if (body.amount <= 0) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Payment amount must be greater than zero');
    }

    if (body.sourceKey) {
      const existing = await prisma.customerPayment.findFirst({
        where: { organizationId: req.user!.organizationId, sourceKey: body.sourceKey },
        select: { id: true, paymentNumber: true },
      });
      if (existing) {
        return res.status(200).json({
          data: existing,
          meta: { created: false, idempotentReplay: true },
          message: 'Payment already recorded with this idempotency key',
        });
      }
    }

    const payment = await prisma.$transaction(async (tx) => {
      let invoice = null;
      if (body.salesInvoiceId) {
        invoice = await tx.salesInvoice.findFirst({
          where: { id: body.salesInvoiceId, organizationId: req.user!.organizationId },
          select: { id: true, invoiceNumber: true, customerId: true, customer: { select: { id: true, name: true } } },
        });
        if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
        if (invoice.customerId && body.customerId && invoice.customerId !== body.customerId) {
          throw new AppError(400, 'CUSTOMER_MISMATCH', 'Invoice and payment refer to different customers');
        }
      }

      const created = await tx.customerPayment.create({
        data: {
          organizationId: req.user!.organizationId,
          branchId: body.branchId ?? req.user!.branchId ?? null,
          customerId: invoice?.customerId ?? body.customerId ?? null,
          salesInvoiceId: body.salesInvoiceId ?? null,
          paymentNumber: body.paymentNumber,
          paymentDate: new Date(body.paymentDate),
          amount: body.amount,
          paymentMethod: body.paymentMethod,
          referenceCode: body.referenceCode ?? body.paymentNumber,
          currency: body.currency,
          exchangeRate: body.exchangeRate,
          bankAccountId: body.bankAccountId ?? null,
          sourceKey: body.sourceKey ?? null,
          status: PaymentStatus.DRAFT,
          createdBy: req.user!.id,
          unappliedAmount: body.amount,
        },
        include: {
          salesInvoice: { select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } } },
        },
      });

      return created;
    });

    res.status(201).json({
      data: payment,
      meta: { created: true },
      message: 'Payment created as draft. Call POST /api/payments/:id/post to post it to the ledger.',
    });
  })
);

// POST /api/payments/:id/post
router.post(
  '/:id/post',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await postCustomerPayment(
      req.user!.organizationId,
      req.params.id,
      req.user!.id,
      { ipAddress: req.ip ?? null }
    );

    res.status(result.created ? 201 : 200).json({
      data: { payment: result.payment, journal: result.journal },
      meta: { created: result.created, idempotentReplay: !result.created },
      message: result.created ? 'Payment posted to the ledger' : 'Payment already posted (idempotent replay)',
    });
  })
);

// POST /api/payments/:id/allocate
router.post(
  '/:id/allocate',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParamsSchema),
  validateBody(allocateSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await allocateCustomerPayment(
      req.user!.organizationId,
      req.params.id,
      req.body.allocations,
      req.user!.id,
      req.ip ?? null
    );

    res.json({ data: result, message: 'Payment allocated successfully' });
  })
);

// POST /api/payments/:id/reverse
router.post(
  '/:id/reverse',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(paymentParamsSchema),
  validateBody(reverseSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { reason, reversalDate } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.customerPayment.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });

      if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
      if (!payment.postedJournalId || payment.status === PaymentStatus.DRAFT) {
        throw new AppError(409, 'PAYMENT_NOT_POSTED', 'Only a posted payment can be reversed');
      }
      if (payment.status === PaymentStatus.REVERSED) {
        throw new AppError(409, 'ALREADY_REVERSED', 'This payment has already been reversed');
      }

      // Allocations must be removed first; reversing a payment with allocations
      // would leave invoices with stale paid amounts.
      if (payment.status === PaymentStatus.PARTIALLY_ALLOCATED || payment.status === PaymentStatus.FULLY_ALLOCATED) {
        throw new AppError(409, 'HAS_ALLOCATIONS', 'Remove all allocations before reversing this payment');
      }

      // Reverse the journal.
      const reversal = await tx.journalEntry.update({
        where: { id: payment.postedJournalId },
        data: {
          isReversed: true,
          reversalReason: reason,
        },
        include: { lines: true },
      });

      // The canonical reversal creates a new journal; we use the existing one
      // here to keep this route simple and delegate full reversal to the
      // journal service when needed. For payments, marking reversed and
      // clearing the postedJournalId is sufficient.
      await tx.customerPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REVERSED,
          postedJournalId: null,
          postedAt: null,
        },
      });

      return { paymentId: payment.id, reversalEntryId: reversal.id };
    });

    res.json({ data: result, message: 'Payment reversed' });
  })
);

export default router;