import { Router, Response } from 'express';
import { z } from 'zod';
import { CurrencyCode, Prisma, PaymentStatus, SupplierBillStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { postSupplierPayment, allocateSupplierPayment, apAgeing } from '../services/accounting/apService';
import { requireMappedAccount, requireAccountInOrg } from '../services/accounting/context';
import { postJournalInTransaction } from '../services/accounting/journal';
import { emitDomainEvent } from '../services/accounting/audit';
import { money, mul, dec } from '../services/accounting/money';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

const paymentParams = z.object({ id: z.string().uuid('Invalid payment ID') });

const createPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  paymentNumber: z.string().min(1).max(50),
  paymentDate: z.string().min(8),
  amount: moneyValue,
  paymentMethod: z.string().min(1).max(50),
  referenceCode: z.string().max(120).optional().nullable(),
  currency: z.nativeEnum(CurrencyCode).default(CurrencyCode.KES),
  exchangeRate: moneyValue.optional().default('1'),
  whtAmount: moneyValue.optional().default('0'),
  bankAccountId: z.string().uuid().optional().nullable(),
  sourceKey: z.string().max(120).optional().nullable(),
});

const allocateSchema = z.object({
  allocations: z.array(
    z.object({
      billId: z.string().uuid(),
      amount: moneyValue,
    })
  ).min(1, 'At least one allocation is required'),
});

const reverseSchema = z.object({
  reason: z.string().min(3).max(500),
  reversalDate: z.string().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  supplierId: z.string().uuid().optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

// GET /api/suppliers/payments
router.get(
  '/suppliers/payments',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(listQuery),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, supplierId, status, fromDate, toDate } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierPaymentWhereInput = { organizationId: req.user!.organizationId };
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.paymentDate = {};
      if (fromDate) where.paymentDate.gte = new Date(fromDate);
      if (toDate) where.paymentDate.lte = new Date(toDate);
    }

    const [payments, total] = await Promise.all([
      prisma.supplierPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true, supplierCode: true } },
          allocations: { include: { supplierBill: { select: { id: true, internalNumber: true } } } },
        },
      }),
      prisma.supplierPayment.count({ where }),
    ]);

    res.json({ data: payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// GET /api/suppliers/payments/:id
router.get(
  '/suppliers/payments/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const payment = await prisma.supplierPayment.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        supplier: { select: { id: true, name: true, supplierCode: true } },
        allocations: { include: { supplierBill: { select: { id: true, internalNumber: true } } } },
      },
    });

    if (!payment) throw new AppError(404, 'NOT_FOUND', 'Supplier payment not found');
    res.json({ data: payment });
  })
);

// POST /api/suppliers/payments (create as draft)
router.post(
  '/suppliers/payments',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'),
  validateBody(createPaymentSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;

    const supplier = await prisma.supplier.findFirst({
      where: { id: body.supplierId, organizationId: req.user!.organizationId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');

    if (body.amount <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Payment amount must be greater than zero');

    if (body.sourceKey) {
      const existing = await prisma.supplierPayment.findFirst({
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

    const payment = await prisma.supplierPayment.create({
      data: {
        organizationId: req.user!.organizationId,
        branchId: body.branchId,
        supplierId: body.supplierId,
        paymentNumber: body.paymentNumber,
        paymentDate: new Date(body.paymentDate),
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        referenceCode: body.referenceCode ?? body.paymentNumber,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        whtAmount: body.whtAmount ?? 0,
        bankAccountId: body.bankAccountId ?? null,
        sourceKey: body.sourceKey ?? null,
        status: PaymentStatus.DRAFT,
        createdBy: req.user!.id,
        unappliedAmount: body.amount,
      },
    });

    res.status(201).json({
      data: payment,
      meta: { created: true },
      message: 'Supplier payment created as draft. Call POST /api/suppliers/payments/:id/post to post it to the ledger.',
    });
  })
);

// POST /api/suppliers/payments/:id/post
router.post(
  '/suppliers/payments/:id/post',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await postSupplierPayment(
      req.user!.organizationId,
      req.params.id,
      req.user!.id,
      { ipAddress: req.ip ?? null }
    );

    res.status(result.created ? 201 : 200).json({
      data: { payment: result.payment, journal: result.journal },
      meta: { created: result.created, idempotentReplay: !result.created },
      message: result.created ? 'Supplier payment posted to the ledger' : 'Supplier payment already posted (idempotent replay)',
    });
  })
);

// POST /api/suppliers/payments/:id/allocate
router.post(
  '/suppliers/payments/:id/allocate',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(paymentParams),
  validateBody(allocateSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await allocateSupplierPayment(
      req.user!.organizationId,
      req.params.id,
      req.body.allocations,
      req.user!.id
    );

    res.json({ data: result, message: 'Supplier payment allocated successfully' });
  })
);

// POST /api/suppliers/payments/:id/reverse
router.post(
  '/suppliers/payments/:id/reverse',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(paymentParams),
  validateBody(reverseSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { reason, reversalDate } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplierPayment.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });

      if (!payment) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
      if (!payment.postedJournalId || payment.status === PaymentStatus.DRAFT) {
        throw new AppError(409, 'PAYMENT_NOT_POSTED', 'Only a posted payment can be reversed');
      }
      if (payment.status === PaymentStatus.REVERSED) {
        throw new AppError(409, 'ALREADY_REVERSED', 'This payment has already been reversed');
      }

      if (payment.status === PaymentStatus.PARTIALLY_ALLOCATED || payment.status === PaymentStatus.FULLY_ALLOCATED) {
        throw new AppError(409, 'HAS_ALLOCATIONS', 'Remove all allocations before reversing this payment');
      }

      await tx.supplierPayment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REVERSED, postedJournalId: null, postedAt: null },
      });

      return { paymentId: payment.id };
    });

    res.json({ data: result, message: 'Supplier payment reversed' });
  })
);

export default router;