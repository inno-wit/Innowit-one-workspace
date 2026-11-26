import { Router, Response } from 'express';
import { z } from 'zod';
import { CurrencyCode, Prisma, SupplierBillStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { postSupplierBill, postSupplierPayment, allocateSupplierPayment, apAgeing } from '../services/accounting/apService';
import { findTaxCode, taxAmountFor, ruleSnapshot, recordTaxTransaction } from '../services/accounting/taxService';
import { getAccountingProfile, requireMappedAccount, requireAccountInOrg } from '../services/accounting/context';
import { postJournalInTransaction } from '../services/accounting/journal';
import { emitDomainEvent } from '../services/accounting/audit';
import { money, mul, dec } from '../services/accounting/money';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

const billParams = z.object({ id: z.string().uuid('Invalid bill ID') });

const billLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: moneyValue.default('1'),
  unitPrice: moneyValue,
  taxCodeId: z.string().uuid().optional().nullable(),
  expenseAccountId: z.string().uuid(),
  costCentreId: z.string().uuid().optional().nullable(),
});

const createBillSchema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid(),
  billNumber: z.string().min(1).max(50),
  billDate: z.string().min(8),
  dueDate: z.string().min(8),
  currency: z.nativeEnum(CurrencyCode).default(CurrencyCode.KES),
  exchangeRate: moneyValue.optional().default('1'),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  goodsReceiptRef: z.string().max(120).optional().nullable(),
  lines: z.array(billLineSchema).min(1, 'At least one line required'),
});

const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  supplierId: z.string().uuid().optional(),
  status: z.nativeEnum(SupplierBillStatus).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

// GET /api/suppliers/bills
router.get(
  '/bills',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(listQuery),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, supplierId, status, fromDate, toDate } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierBillWhereInput = { organizationId: req.user!.organizationId };
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.billDate = {};
      if (fromDate) where.billDate.gte = new Date(fromDate);
      if (toDate) where.billDate.lte = new Date(toDate);
    }

    const [bills, total] = await Promise.all([
      prisma.supplierBill.findMany({
        where,
        skip,
        take: limit,
        orderBy: { billDate: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } },
          _count: { select: { lines: true, allocations: true } },
        },
      }),
      prisma.supplierBill.count({ where }),
    ]);

    res.json({ data: bills, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// GET /api/suppliers/bills/:id
router.get(
  '/bills/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(billParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const bill = await prisma.supplierBill.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        supplier: { select: { id: true, name: true, kraPin: true, email: true } },
        lines: { include: { costCentre: { select: { id: true, code: true, name: true } } } },
        allocations: { include: { supplierPayment: { select: { id: true, paymentNumber: true, paymentDate: true } } } },
      },
    });

    if (!bill) throw new AppError(404, 'NOT_FOUND', 'Supplier bill not found');

    res.json({ data: bill });
  })
);

// POST /api/suppliers/bills (create as draft)
router.post(
  '/bills',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'),
  validateBody(createBillSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;

    const supplier = await prisma.supplier.findFirst({
      where: { id: body.supplierId, organizationId: req.user!.organizationId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');

    const internalNumber = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
        INSERT INTO "DocumentSequence" ("id", "organizationId", "prefix", "scope", "year", "nextValue", "updatedAt")
        VALUES (gen_random_uuid(), ${req.user!.organizationId}, 'BILL', ${req.body.branchId ?? 'GLOBAL'}, ${new Date(body.billDate).getFullYear()}, 2, now())
        ON CONFLICT ("organizationId", "prefix", "scope", "year")
        DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1, "updatedAt" = now()
        RETURNING "nextValue"
      `;
      const next = rows[0]?.nextValue ?? 1;
      return `BILL-${new Date(body.billDate).getFullYear()}-${String(next - 1).padStart(4, '0')}`;
    });

    let subtotal = dec(0);
    let taxTotal = dec(0);
    let whtTotal = dec(0);

    const linesWithCalc = await Promise.all(body.lines.map(async (line: any) => {
      const qty = dec(line.quantity);
      const price = dec(line.unitPrice);
      const lineSubtotal = mul(qty, price);
      subtotal = subtotal.plus(lineSubtotal);

      let tax = dec(0);
      let wht = dec(0);
      let rule = null;

      if (line.taxCodeId) {
        rule = await findTaxCode(prisma, req.user!.organizationId, { taxCodeId: line.taxCodeId }, new Date(body.billDate), 'PURCHASE');
      }

      if (rule) {
        tax = taxAmountFor(lineSubtotal, rule.ratePercent);
        taxTotal = taxTotal.plus(tax);
      }

      // WHT is captured via a separate tax rule with kind WHT_INCOME or WHT_VAT
      if (rule?.kind === 'WHT_INCOME' || rule?.kind === 'WHT_VAT') {
        wht = tax; // already computed
        whtTotal = whtTotal.plus(wht);
      }

      return { ...line, lineSubtotal, tax, wht, lineTotal: lineSubtotal.plus(tax), rule };
    }));

    const totalAmount = subtotal.plus(taxTotal).minus(whtTotal);

    const bill = await prisma.supplierBill.create({
      data: {
        organizationId: req.user!.organizationId,
        branchId: body.branchId,
        supplierId: body.supplierId,
        billNumber: body.billNumber,
        internalNumber,
        billDate: new Date(body.billDate),
        dueDate: new Date(body.dueDate),
        currency: body.currency,
        exchangeRate: body.exchangeRate,
        subtotal,
        taxAmount: taxTotal,
        whtAmount: whtTotal,
        totalAmount,
        purchaseOrderId: body.purchaseOrderId ?? null,
        goodsReceiptRef: body.goodsReceiptRef ?? null,
        status: SupplierBillStatus.DRAFT,
        createdBy: req.user!.userId,
        lines: {
          create: linesWithCalc.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxCodeId: l.taxCodeId ?? null,
            taxAmount: l.tax,
            whtAmount: l.wht,
            lineTotal: l.lineTotal,
            expenseAccountId: l.expenseAccountId,
            costCentreId: l.costCentreId ?? null,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        lines: { include: { costCentre: { select: { id: true, code: true, name: true } } } },
      },
    });

    res.status(201).json({
      data: bill,
      message: 'Supplier bill created as draft. Call POST /api/suppliers/bills/:id/post to post it to the ledger.',
    });
  })
);

// POST /api/suppliers/bills/:id/post
router.post(
  '/bills/:id/post',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(billParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) =>
      postSupplierBill(tx, {
        organizationId: req.user!.organizationId,
        billId: req.params.id,
        userId: req.user!.userId,
        ipAddress: req.ip ?? null,
      })
    );

    res.status(result.created ? 201 : 200).json({
      data: { bill: result.bill, journal: result.journal },
      meta: { created: result.created, idempotentReplay: !result.created },
      message: result.created ? 'Supplier bill posted to the ledger' : 'Supplier bill already posted (idempotent replay)',
    });
  })
);

export default router;