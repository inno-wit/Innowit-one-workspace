import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma, JournalStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import {
  postJournal,
  postDraftJournal,
  reverseJournal,
  reconcileAccountBalances,
  normaliseJournalLines,
} from '../services/accounting/journal';
import { ZERO } from '../services/accounting/money';

const router = Router();

const moneyValue = z.union([z.string(), z.number()]);

const journalLineSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().uuid('Invalid account ID'),
  description: z.string().max(500).optional().nullable(),
  debit: moneyValue.optional().default('0'),
  credit: moneyValue.optional().default('0'),
  costCentreId: z.string().uuid().optional().nullable(),
  dimensionTag: z.string().max(100).optional().nullable(),
});

const createJournalEntrySchema = z.object({
  // Optional: the server allocates a gapless number atomically.
  entryNumber: z.string().min(1).max(50).optional(),
  postingDate: z.string().min(8),
  sourceModule: z.string().min(1).max(50).default('MANUAL'),
  sourceId: z.string().optional().nullable(),
  sourceKey: z.string().max(120).optional().nullable(),
  transactionRef: z.string().max(120).optional().nullable(),
  description: z.string().min(1).max(500),
  branchId: z.string().uuid().optional().nullable(),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).default('KES'),
  exchangeRate: moneyValue.optional().default('1'),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'POSTED']).default('POSTED'),
  lines: z.array(journalLineSchema).min(2, 'At least two lines required'),
});

const updateJournalEntrySchema = z.object({
  postingDate: z.string().min(8).optional(),
  description: z.string().min(1).max(500).optional(),
  transactionRef: z.string().max(120).optional().nullable(),
  lines: z.array(journalLineSchema).min(2).optional(),
});

const journalParamsSchema = z.object({ id: z.string().uuid('Invalid journal entry ID') });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().optional(),
  sourceModule: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'VOID']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

const reverseBodySchema = z.object({
  reason: z.string().min(3, 'A reversal reason is required').max(500),
  reversalDate: z.string().optional(),
});

// GET /api/journal
router.get(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateQuery(listQuerySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page, limit, search, sourceModule, status, fromDate, toDate } = req.query as any;
    const skip = (page - 1) * limit;

    const where: Prisma.JournalEntryWhereInput = { organizationId: req.user!.organizationId };
    if (sourceModule) where.sourceModule = sourceModule;
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.postingDate = {};
      if (fromDate) where.postingDate.gte = new Date(fromDate);
      if (toDate) where.postingDate.lte = new Date(toDate);
    }
    if (search) {
      where.OR = [
        { entryNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { transactionRef: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          entryNumber: true,
          postingDate: true,
          description: true,
          sourceModule: true,
          sourceId: true,
          transactionRef: true,
          status: true,
          isReversed: true,
          reversalEntryId: true,
          currency: true,
          exchangeRate: true,
          postedAt: true,
          postedBy: true,
          createdAt: true,
          period: { select: { id: true, name: true, status: true } },
          lines: {
            select: {
              id: true,
              debit: true,
              credit: true,
              baseDebit: true,
              baseCredit: true,
              description: true,
              account: { select: { id: true, accountNumber: true, name: true, type: true } },
            },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({
      data: entries.map((entry) => ({
        ...entry,
        totalDebit: entry.lines.reduce((acc, l) => acc.plus(l.debit), ZERO).toFixed(2),
        totalCredit: entry.lines.reduce((acc, l) => acc.plus(l.credit), ZERO).toFixed(2),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

// GET /api/journal/balance-reconciliation
router.get(
  '/balance-reconciliation',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const apply = String(req.query.apply ?? 'false') === 'true';
    if (apply) {
      throw new AppError(
        403,
        'RECONCILE_REQUIRES_DEDICATED_ENDPOINT',
        'Use POST /api/journal/balance-reconciliation/apply to write corrections'
      );
    }
    const result = await reconcileAccountBalances(req.user!.organizationId, { apply: false });
    res.json({ data: result });
  })
);

// POST /api/journal/balance-reconciliation/apply
router.post(
  '/balance-reconciliation/apply',
  authenticateToken,
  authorize('SUPER_ADMIN', 'FINANCE_MANAGER'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await reconcileAccountBalances(req.user!.organizationId, { apply: true });
    res.json({ data: result });
  })
);

// GET /api/journal/:id
router.get(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(journalParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        period: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
        lines: {
          include: {
            account: {
              select: { id: true, accountNumber: true, name: true, type: true, controlType: true },
            },
            costCentre: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!entry) {
      throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
    }

    res.json({
      data: {
        ...entry,
        totalDebit: entry.lines.reduce((acc, l) => acc.plus(l.debit), ZERO).toFixed(2),
        totalCredit: entry.lines.reduce((acc, l) => acc.plus(l.credit), ZERO).toFixed(2),
      },
    });
  })
);

// POST /api/journal
router.post(
  '/',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateBody(createJournalEntrySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body;

    const result = await postJournal({
      organizationId: req.user!.organizationId,
      branchId: body.branchId ?? req.user!.branchId ?? null,
      postingDate: body.postingDate,
      description: body.description,
      sourceModule: body.sourceModule,
      sourceId: body.sourceId ?? null,
      sourceKey: body.sourceKey ?? null,
      transactionRef: body.transactionRef ?? null,
      currency: body.currency,
      exchangeRate: body.exchangeRate,
      status: body.status,
      entryNumber: body.entryNumber,
      createdBy: req.user!.userId,
      postedBy: req.user!.userId,
      strictPrecision: true,
      ipAddress: req.ip ?? null,
      lines: body.lines,
    });

    const status = result.created ? (body.status === 'POSTED' ? 201 : 201) : 200;
    res.status(status).json({
      data: result.journal,
      meta: { created: result.created, idempotentReplay: !result.created },
    });
  })
);

// PUT /api/journal/:id — draft-only edit. Posted journals are immutable.
router.put(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(journalParamsSchema),
  validateBody(updateJournalEntrySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const organizationId = req.user!.organizationId;
    const body = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: req.params.id, organizationId },
        include: { lines: true },
      });

      if (!entry) throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');

      if (entry.status === JournalStatus.POSTED || entry.status === JournalStatus.REVERSED) {
        throw new AppError(
          409,
          'JOURNAL_IMMUTABLE',
          'A posted journal is immutable. Reverse it and post a correcting entry instead.'
        );
      }

      if (body.lines) {
        const normalised = await normaliseJournalLines(tx, organizationId, body.lines, {
          strictPrecision: true,
          exchangeRate: entry.exchangeRate,
        });

        await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
        await tx.journalLine.createMany({
          data: normalised.lines.map((line) => ({
            journalEntryId: entry.id,
            accountId: line.accountId,
            description: line.description ?? null,
            debit: line.debit,
            credit: line.credit,
            currency: entry.currency,
            fxRate: entry.exchangeRate,
            baseDebit: line.baseDebit,
            baseCredit: line.baseCredit,
            costCentreId: line.costCentreId ?? null,
            dimensionTag: line.dimensionTag ?? null,
          })),
        });
      }

      return tx.journalEntry.update({
        where: { id: entry.id },
        data: {
          postingDate: body.postingDate ? new Date(body.postingDate) : undefined,
          description: body.description ?? undefined,
          transactionRef:
            body.transactionRef === undefined ? undefined : body.transactionRef,
        },
        include: { lines: true },
      });
    });

    res.json({ data: updated });
  })
);

// POST /api/journal/:id/post — move a draft into the ledger
router.post(
  '/:id/post',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(journalParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await postDraftJournal(
      req.user!.organizationId,
      req.params.id,
      req.user!.userId,
      { ipAddress: req.ip ?? null }
    );
    res.json({ data: result.journal, meta: { created: result.created } });
  })
);

// POST /api/journal/:id/reverse
router.post(
  '/:id/reverse',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'),
  validateParams(journalParamsSchema),
  validateBody(reverseBodySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await reverseJournal({
      organizationId: req.user!.organizationId,
      journalId: req.params.id,
      reason: req.body.reason,
      reversedBy: req.user!.userId,
      reversalDate: req.body.reversalDate,
    });

    res.status(201).json({ data: result.reversal, meta: { originalId: result.originalId } });
  })
);

// DELETE /api/journal/:id — drafts only
router.delete(
  '/:id',
  authenticateToken,
  authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'),
  validateParams(journalParamsSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const organizationId = req.user!.organizationId;

    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findFirst({
        where: { id: req.params.id, organizationId },
      });
      if (!entry) throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
      if (entry.status !== JournalStatus.DRAFT) {
        throw new AppError(
          409,
          'JOURNAL_IMMUTABLE',
          'Only a DRAFT journal can be deleted. Posted journals are corrected by reversal.'
        );
      }
      await tx.journalLine.deleteMany({ where: { journalEntryId: entry.id } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: req.user!.userId,
          action: 'DELETE',
          entityType: 'JournalEntry',
          entityId: entry.id,
          changesJson: JSON.stringify({ entryNumber: entry.entryNumber }),
        },
      });
    });

    res.json({ data: { deleted: true } });
  })
);

export default router;
