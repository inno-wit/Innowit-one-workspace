import { Router, Response } from 'express';
import { z } from 'zod';
import {
  BankAccountType,
  BudgetStatus,
  CurrencyCode,
  ExchangeRateSource,
  MpesaTransactionStatus,
  MpesaTransactionType,
  PeriodStatus,
  Prisma,
  ReconciliationStatus,
  TaxApplicability,
  TaxKind,
} from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { recordAudit, emitDomainEvent } from '../services/accounting/audit';
import { currentPeriod, resolvePostingPeriod } from '../services/accounting/periods';
import { functionalCurrency, getAccountingProfile, requireMappedAccount, requireAccountInOrg } from '../services/accounting/context';
import { seedKenyanVatCodes, vatSummary } from '../services/accounting/taxService';
import { captureRate, toFunctional } from '../services/accounting/fxService';
import { createBankAccount, parseStatementCsv, importStatement, autoMatch, finalizeReconciliation, startReconciliation } from '../services/accounting/bankService';
import { recordMpesaCallback, linkMpesaToPayment, mpesaIdempotencyKey } from '../services/accounting/bankService';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

// ============================================================================
// Tax codes
// ============================================================================

const taxCodeSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(1).max(120),
  kind: z.nativeEnum(TaxKind),
  applicability: z.nativeEnum(TaxApplicability).default(TaxApplicability.BOTH),
  ratePercent: moneyValue,
  isRecoverable: z.boolean().optional(),
  isCompound: z.boolean().optional(),
  reverseCharge: z.boolean().optional(),
  whtRecipientType: z.string().max(32).optional().nullable(),
  effectiveFrom: z.string().min(8),
  effectiveTo: z.string().optional().nullable(),
  glOutputAccountId: z.string().uuid().optional().nullable(),
  glInputAccountId: z.string().uuid().optional().nullable(),
  glLiabilityAccountId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
  legalRef: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const taxCodeParams = z.object({ id: z.string().uuid() });

router.get(
  '/tax-codes',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), kind: z.string().optional(), isActive: z.string().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, kind, isActive } = req.query as any;
    const where: Prisma.TaxCodeWhereInput = { organizationId: req.user!.organizationId };
    if (kind) where.kind = kind;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [codes, total] = await Promise.all([
      prisma.taxCode.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.taxCode.count({ where }),
    ]);

    res.json({ data: codes, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.post(
  '/tax-codes',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(taxCodeSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;

    if (body.effectiveTo) {
      const from = new Date(body.effectiveFrom);
      const to = new Date(body.effectiveTo);
      if (to < from) throw new AppError(400, 'INVALID_DATES', 'effectiveTo cannot be before effectiveFrom');
    }

    if (body.glOutputAccountId) {
      await requireAccountInOrg(prisma, req.user!.organizationId, body.glOutputAccountId, 'output account');
    }
    if (body.glInputAccountId) {
      await requireAccountInOrg(prisma, req.user!.organizationId, body.glInputAccountId, 'input account');
    }
    if (body.glLiabilityAccountId) {
      await requireAccountInOrg(prisma, req.user!.organizationId, body.glLiabilityAccountId, 'liability account');
    }

    const code = await prisma.taxCode.create({
      data: {
        organizationId: req.user!.organizationId,
        code: body.code,
        name: body.name,
        kind: body.kind,
        applicability: body.applicability,
        ratePercent: body.ratePercent,
        isRecoverable: body.isRecoverable ?? true,
        isCompound: body.isCompound ?? false,
        reverseCharge: body.reverseCharge ?? false,
        whtRecipientType: body.whtRecipientType ?? null,
        effectiveFrom: new Date(body.effectiveFrom),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        glOutputAccountId: body.glOutputAccountId ?? null,
        glInputAccountId: body.glInputAccountId ?? null,
        glLiabilityAccountId: body.glLiabilityAccountId ?? null,
        isActive: body.isActive ?? true,
        legalRef: body.legalRef ?? null,
        notes: body.notes ?? null,
        createdBy: req.user!.userId,
      },
    });

    res.status(201).json({ data: code });
  })
);

router.put(
  '/tax-codes/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(taxCodeParams),
  validateBody(taxCodeSchema.partial()),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const existing = await prisma.taxCode.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Tax code not found');

    if (req.body.effectiveTo) {
      const from = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : existing.effectiveFrom;
      const to = new Date(req.body.effectiveTo);
      if (to < from) throw new AppError(400, 'INVALID_DATES', 'effectiveTo cannot be before effectiveFrom');
    }

    const code = await prisma.taxCode.update({
      where: { id: existing.id },
      data: {
        code: req.body.code,
        name: req.body.name,
        kind: req.body.kind,
        applicability: req.body.applicability,
        ratePercent: req.body.ratePercent,
        isRecoverable: req.body.isRecoverable,
        isCompound: req.body.isCompound,
        reverseCharge: req.body.reverseCharge,
        whtRecipientType: req.body.whtRecipientType,
        effectiveFrom: req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : undefined,
        effectiveTo: req.body.effectiveTo === null ? null : req.body.effectiveTo ? new Date(req.body.effectiveTo) : undefined,
        glOutputAccountId: req.body.glOutputAccountId,
        glInputAccountId: req.body.glInputAccountId,
        glLiabilityAccountId: req.body.glLiabilityAccountId,
        isActive: req.body.isActive,
        legalRef: req.body.legalRef,
        notes: req.body.notes,
      },
    });

    res.json({ data: code });
  })
);

router.post(
  '/tax-codes/seed-kenya',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) => seedKenyanVatCodes(tx, req.user!.organizationId, req.user!.userId));
    res.json({ data: result, message: 'Kenyan VAT codes seeded' });
  })
);

// ============================================================================
// Exchange rates
// ============================================================================

const exchangeRateSchema = z.object({
  fromCurrency: z.nativeEnum(CurrencyCode),
  toCurrency: z.nativeEnum(CurrencyCode),
  rate: moneyValue,
  rateDate: z.string().min(8),
  source: z.nativeEnum(ExchangeRateSource).optional(),
  sourceRef: z.string().max(200).optional().nullable(),
  isOverride: z.boolean().optional(),
  overrideReason: z.string().max(500).optional().nullable(),
});

const fxParams = z.object({ id: z.string().uuid() });

router.get(
  '/exchange-rates',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), from: z.nativeEnum(CurrencyCode).optional(), to: z.nativeEnum(CurrencyCode).optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, from, to } = req.query as any;
    const where: Prisma.ExchangeRateWhereInput = { organizationId: req.user!.organizationId };
    if (from) where.fromCurrency = from;
    if (to) where.toCurrency = to;

    const [rates, total] = await Promise.all([
      prisma.exchangeRate.findMany({ where, orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.exchangeRate.count({ where }),
    ]);

    res.json({ data: rates, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.post(
  '/exchange-rates',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(exchangeRateSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) =>
      captureRate(tx, { ...req.body, rateValue: req.body.rate, rateDate: new Date(req.body.rateDate), organizationId: req.user!.organizationId, createdBy: req.user!.userId })
    );
    res.status(201).json({ data: result });
  })
);

router.get(
  '/exchange-rates/convert',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ amount: moneyValue, from: z.nativeEnum(CurrencyCode), to: z.nativeEnum(CurrencyCode), date: z.string().min(8) })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { amount, from, to, date } = req.query as any;
    const result = await prisma.$transaction((tx) =>
      toFunctional(tx, req.user!.organizationId, amount, from, to, new Date(date))
    );
    res.json({ data: result });
  })
);

// ============================================================================
// Bank accounts
// ============================================================================

const bankAccountSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(BankAccountType).optional(),
  accountNumber: z.string().max(64).optional().nullable(),
  glAccountId: z.string().uuid(),
  currency: z.nativeEnum(CurrencyCode).optional(),
  provider: z.string().max(64).optional().nullable(),
  mpesaShortcode: z.string().max(32).optional().nullable(),
  openingBalance: moneyValue.optional().default('0'),
  openingDate: z.string().optional().nullable(),
  branchId: z.string().uuid().optional().nullable(),
});

const bankAccountParams = z.object({ id: z.string().uuid() });

router.get(
  '/bank-accounts',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const accounts = await prisma.bankAccount.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { glAccount: { select: { id: true, accountNumber: true, name: true, currentBalance: true } }, _count: { select: { statements: true, reconciliations: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ data: accounts });
  })
);

router.post(
  '/bank-accounts',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(bankAccountSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const account = await prisma.$transaction((tx) => createBankAccount(tx, { ...req.body, organizationId: req.user!.organizationId, openingBalance: req.body.openingBalance ?? 0 }));
    res.status(201).json({ data: account });
  })
);

router.get(
  '/bank-accounts/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(bankAccountParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const account = await prisma.bankAccount.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { glAccount: true, statements: { orderBy: { statementTo: 'desc' }, take: 10 }, reconciliations: { orderBy: { periodEnd: 'desc' }, take: 10 } },
    });
    if (!account) throw new AppError(404, 'NOT_FOUND', 'Bank account not found');
    res.json({ data: account });
  })
);

// ============================================================================
// Bank statements
// ============================================================================

const importStatementSchema = z.object({
  bankAccountId: z.string().uuid(),
  fileName: z.string().optional().nullable(),
  format: z.string().optional(),
  statementFrom: z.string().min(8),
  statementTo: z.string().min(8),
  openingBalance: moneyValue,
  closingBalance: moneyValue,
  content: z.string(), // CSV text; caller is responsible for reading the file
  importedBy: z.string().optional().nullable(),
});

router.post(
  '/bank-statements/import',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(importStatementSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;
    const lines = parseStatementCsv(body.content);
    const contentHash = require('crypto').createHash('sha256').update(body.content).digest('hex');

    const statement = await prisma.$transaction((tx) =>
      importStatement(tx, {
        organizationId: req.user!.organizationId,
        bankAccountId: body.bankAccountId,
        fileName: body.fileName ?? null,
        contentHash,
        format: body.format ?? 'CSV',
        statementFrom: new Date(body.statementFrom),
        statementTo: new Date(body.statementTo),
        openingBalance: body.openingBalance,
        closingBalance: body.closingBalance,
        lines,
        importedBy: body.importedBy ?? req.user!.userId,
      })
    );

    res.status(201).json({ data: statement, message: `Imported ${statement.lineCount} statement lines` });
  })
);

router.get(
  '/bank-statements',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), bankAccountId: z.string().uuid().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, bankAccountId } = req.query as any;
    const where: Prisma.BankStatementWhereInput = { organizationId: req.user!.organizationId };
    if (bankAccountId) where.bankAccountId = bankAccountId;

    const [statements, total] = await Promise.all([
      prisma.bankStatement.findMany({ where, orderBy: { statementTo: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.bankStatement.count({ where }),
    ]);

    res.json({ data: statements, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// ============================================================================
// Bank reconciliation
// ============================================================================

const reconciliationParams = z.object({ id: z.string().uuid() });

router.post(
  '/bank-reconciliation',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(z.object({ bankAccountId: z.string().uuid(), statementId: z.string().uuid().optional().nullable(), periodStart: z.string().min(8), periodEnd: z.string().min(8), statementClosingBalance: moneyValue, preparedBy: z.string().optional().nullable() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const reconciliation = await prisma.$transaction((tx) =>
      startReconciliation(tx, {
        organizationId: req.user!.organizationId,
        bankAccountId: req.body.bankAccountId,
        statementId: req.body.statementId ?? null,
        periodStart: new Date(req.body.periodStart),
        periodEnd: new Date(req.body.periodEnd),
        statementClosingBalance: req.body.statementClosingBalance,
        preparedBy: req.body.preparedBy ?? req.user!.userId,
      })
    );
    res.status(201).json({ data: reconciliation });
  })
);

router.post(
  '/bank-reconciliation/:id/auto-match',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(reconciliationParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) =>
      autoMatch(tx, { organizationId: req.user!.organizationId, reconciliationId: req.params.id, userId: req.user!.userId })
    );
    res.json({ data: result, message: `Auto-matched ${result.matched} lines; ${result.unmatched} remain unmatched` });
  })
);

router.post(
  '/bank-reconciliation/:id/finalize',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(reconciliationParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) =>
      finalizeReconciliation(tx, { organizationId: req.user!.organizationId, reconciliationId: req.params.id, userId: req.user!.userId, allowSelfApproval: false })
    );
    res.json({ data: result, message: 'Reconciliation finalized' });
  })
);

router.get(
  '/bank-reconciliation',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), bankAccountId: z.string().uuid().optional(), status: z.nativeEnum(ReconciliationStatus).optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, bankAccountId, status } = req.query as any;
    const where: Prisma.BankReconciliationWhereInput = { organizationId: req.user!.organizationId };
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (status) where.status = status;

    const [reconciliations, total] = await Promise.all([
      prisma.bankReconciliation.findMany({ where, orderBy: { periodEnd: 'desc' }, skip: (page - 1) * limit, take: limit, include: { bankAccount: { select: { id: true, name: true } } } }),
      prisma.bankReconciliation.count({ where }),
    ]);

    res.json({ data: reconciliations, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// ============================================================================
// M-Pesa
// ============================================================================

const mpesaParams = z.object({ id: z.string().uuid() });

router.post(
  '/mpesa/callback',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateBody(z.object({
    transactionType: z.nativeEnum(MpesaTransactionType),
    amount: moneyValue,
    idempotencyKey: z.string().min(1).max(128),
    mpesaReceiptNumber: z.string().optional().nullable(),
    merchantRequestId: z.string().optional().nullable(),
    checkoutRequestId: z.string().optional().nullable(),
    phoneNumber: z.string().optional().nullable(),
    resultCode: z.string().optional().nullable(),
    resultDesc: z.string().optional().nullable(),
    accountReference: z.string().optional().nullable(),
    bankAccountId: z.string().uuid().optional().nullable(),
    rawPayload: z.any(),
    currency: z.nativeEnum(CurrencyCode).optional(),
  })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await prisma.$transaction((tx) =>
      recordMpesaCallback(tx, { ...req.body, organizationId: req.user!.organizationId, amount: req.body.amount })
    );
    res.status(result.created ? 201 : 200).json({ data: result.transaction, meta: { created: result.created } });
  })
);

router.post(
  '/mpesa/:id/link-payment',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(mpesaParams),
  validateBody(z.object({ paymentId: z.string().uuid() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const linked = await prisma.$transaction((tx) =>
      linkMpesaToPayment(tx, { organizationId: req.user!.organizationId, mpesaTransactionId: req.params.id, paymentId: req.body.paymentId })
    );
    res.json({ data: linked, message: 'M-Pesa transaction linked to payment' });
  })
);

router.get(
  '/mpesa',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), status: z.nativeEnum(MpesaTransactionStatus).optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, status } = req.query as any;
    const where: Prisma.MpesaTransactionWhereInput = { organizationId: req.user!.organizationId };
    if (status) where.status = status;

    const [txns, total] = await Promise.all([
      prisma.mpesaTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.mpesaTransaction.count({ where }),
    ]);

    res.json({ data: txns, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// ============================================================================
// Budgets
// ============================================================================

const budgetSchema = z.object({
  fiscalYearId: z.string().uuid(),
  name: z.string().min(1).max(100),
  costCentreId: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    periodNumber: z.number().int().min(1).max(12),
    amount: moneyValue,
    costCentreId: z.string().uuid().optional().nullable(),
  })).min(1),
});

const budgetParams = z.object({ id: z.string().uuid() });

router.post(
  '/budgets',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateBody(budgetSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const budget = await prisma.$transaction(async (tx) => {
      const created = await tx.budget.create({
        data: {
          organizationId: req.user!.organizationId,
          fiscalYearId: req.body.fiscalYearId,
          name: req.body.name,
          costCentreId: req.body.costCentreId ?? null,
          notes: req.body.notes ?? null,
          createdBy: req.user!.userId,
        },
      });

      await tx.budgetLine.createMany({
        data: req.body.lines.map((line: any) => ({
          organizationId: req.user!.organizationId,
          budgetId: created.id,
          accountId: line.accountId,
          periodNumber: line.periodNumber,
          amount: line.amount,
          costCentreId: line.costCentreId ?? null,
        })),
      });

      return tx.budget.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
    });

    res.status(201).json({ data: budget });
  })
);

router.post(
  '/budgets/:id/approve',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'),
  validateParams(budgetParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const budget = await prisma.budget.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!budget) throw new AppError(404, 'NOT_FOUND', 'Budget not found');
    if (budget.createdBy && budget.createdBy === req.user!.userId) {
      throw new AppError(403, 'SEGREGATION_OF_DUTIES', 'Budget creator cannot approve their own budget');
    }

    const updated = await prisma.budget.update({
      where: { id: budget.id },
      data: {
        status: BudgetStatus.APPROVED,
        approvedBy: req.user!.userId,
        approvedAt: new Date(),
      },
    });
    res.json({ data: updated, message: 'Budget approved' });
  })
);

router.get(
  '/budgets',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(200).default(50), fiscalYearId: z.string().uuid().optional(), status: z.string().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, fiscalYearId, status } = req.query as any;
    const where: Prisma.BudgetWhereInput = { organizationId: req.user!.organizationId };
    if (fiscalYearId) where.fiscalYearId = fiscalYearId;
    if (status) where.status = status;

    const [budgets, total] = await Promise.all([
      prisma.budget.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { _count: { select: { lines: true } }, fiscalYear: { select: { id: true, name: true } } } }),
      prisma.budget.count({ where }),
    ]);

    res.json({ data: budgets, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// ============================================================================
// Reports
// ============================================================================

const reportQuery = z.object({
  from: z.string().min(8),
  to: z.string().min(8),
});

router.get(
  '/reports/trial-balance',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(reportQuery.extend({ includeZero: z.string().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { from, to, includeZero } = req.query as any;
    const { trialBalance } = await import('../services/accounting/reportService');
    const result = await trialBalance(prisma, req.user!.organizationId, new Date(from), new Date(to), { includeZero: includeZero === 'true' });
    res.json({ data: result });
  })
);

router.get(
  '/reports/profit-and-loss',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(reportQuery),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { from, to } = req.query as any;
    const { profitAndLoss } = await import('../services/accounting/reportService');
    const result = await profitAndLoss(prisma, req.user!.organizationId, new Date(from), new Date(to));
    res.json({ data: result });
  })
);

router.get(
  '/reports/balance-sheet',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ asOf: z.string().min(8) })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { asOf } = req.query as any;
    const { balanceSheet } = await import('../services/accounting/reportService');
    const result = await balanceSheet(prisma, req.user!.organizationId, new Date(asOf));
    res.json({ data: result });
  })
);

router.get(
  '/reports/ar-ageing',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ asOf: z.string().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { arAgeing } = await import('../services/accounting/reportService');
    const result = await arAgeing(prisma, req.user!.organizationId, req.query.asOf ? new Date(String(req.query.asOf)) : new Date());
    res.json({ data: result });
  })
);

router.get(
  '/reports/ap-ageing',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ asOf: z.string().optional() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { apAgeing } = await import('../services/accounting/apService');
    const result = await apAgeing(prisma, req.user!.organizationId, req.query.asOf ? new Date(String(req.query.asOf)) : new Date());
    res.json({ data: result });
  })
);

router.get(
  '/reports/cash-flow',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(reportQuery),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { from, to } = req.query as any;
    const { cashFlow } = await import('../services/accounting/reportService');
    const result = await cashFlow(prisma, req.user!.organizationId, new Date(from), new Date(to));
    res.json({ data: result });
  })
);

router.get(
  '/reports/budget-variance/:budgetId',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(z.object({ budgetId: z.string().uuid() })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { budgetVariance } = await import('../services/accounting/reportService');
    const result = await budgetVariance(prisma, req.user!.organizationId, req.params.budgetId);
    res.json({ data: result });
  })
);

router.get(
  '/reports/fx-revaluation',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(z.object({ asOf: z.string().min(8) })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { asOf } = req.query as any;
    const { computeRevaluation } = await import('../services/accounting/fxService');
    const result = await prisma.$transaction(async (tx) => {
      const fnCurrency = await functionalCurrency(tx, req.user!.organizationId);
      return computeRevaluation(tx, req.user!.organizationId, fnCurrency, new Date(asOf));
    });
    res.json({ data: result });
  })
);

router.get(
  '/reports/vat-summary',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(reportQuery),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { from, to } = req.query as any;
    const result = await vatSummary(prisma, req.user!.organizationId, new Date(from), new Date(to));
    res.json({ data: result });
  })
);

// ============================================================================
// Fiscal years & accounting periods
// ============================================================================

router.get(
  '/fiscal-years',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await currentPeriod(req.user!.organizationId);
    const years = await prisma.fiscalYear.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
      orderBy: { startDate: 'desc' },
    });
    res.json({ data: years });
  })
);

router.get(
  '/periods',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await currentPeriod(req.user!.organizationId);
    const periods = await prisma.accountingPeriod.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { startDate: 'asc' },
    });
    res.json({ data: periods });
  })
);

const periodParams = z.object({ id: z.string().uuid() });

router.post(
  '/periods/:id/soft-close',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(periodParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!period) throw new AppError(404, 'NOT_FOUND', 'Accounting period not found');
    if (period.status === PeriodStatus.CLOSED) {
      throw new AppError(409, 'PERIOD_CLOSED', 'A closed period must be reopened before soft-closing');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.accountingPeriod.update({
        where: { id: period.id },
        data: { status: PeriodStatus.SOFT_CLOSED },
      });
      await recordAudit(tx, {
        organizationId: req.user!.organizationId,
        userId: req.user!.userId,
        action: 'PERIOD_SOFT_CLOSED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        changes: { status: PeriodStatus.SOFT_CLOSED },
      });
      return next;
    });
    res.json({ data: updated, message: `Period ${updated.name} soft-closed` });
  })
);

router.post(
  '/periods/:id/close',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(periodParams),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!period) throw new AppError(404, 'NOT_FOUND', 'Accounting period not found');
    if (period.status === PeriodStatus.CLOSED) {
      return res.json({ data: period, message: `Period ${period.name} is already closed` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.accountingPeriod.update({
        where: { id: period.id },
        data: {
          status: PeriodStatus.CLOSED,
          closedBy: req.user!.userId,
          closedAt: new Date(),
        },
      });
      await recordAudit(tx, {
        organizationId: req.user!.organizationId,
        userId: req.user!.userId,
        action: 'PERIOD_CLOSED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        changes: { status: PeriodStatus.CLOSED },
      });
      await emitDomainEvent(tx, {
        organizationId: req.user!.organizationId,
        eventType: 'period.closed',
        aggregateType: 'AccountingPeriod',
        aggregateId: period.id,
        payload: { name: period.name },
      });
      return next;
    });
    res.json({ data: updated, message: `Period ${updated.name} closed` });
  })
);

router.post(
  '/periods/:id/reopen',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(periodParams),
  validateBody(z.object({ reason: z.string().min(3).max(500) })),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!period) throw new AppError(404, 'NOT_FOUND', 'Accounting period not found');

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.accountingPeriod.update({
        where: { id: period.id },
        data: {
          status: PeriodStatus.OPEN,
          reopenReason: req.body.reason,
        },
      });
      await recordAudit(tx, {
        organizationId: req.user!.organizationId,
        userId: req.user!.userId,
        action: 'PERIOD_REOPENED',
        entityType: 'AccountingPeriod',
        entityId: period.id,
        changes: { status: PeriodStatus.OPEN, reason: req.body.reason },
      });
      await emitDomainEvent(tx, {
        organizationId: req.user!.organizationId,
        eventType: 'period.reopened',
        aggregateType: 'AccountingPeriod',
        aggregateId: period.id,
        payload: { name: period.name, reason: req.body.reason },
      });
      return next;
    });
    res.json({ data: updated, message: `Period ${updated.name} reopened` });
  })
);

export default router;