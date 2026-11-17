import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const journalLineSchema = z.object({
  accountId: z.string().uuid('Invalid account ID'),
  description: z.string().optional(),
  debit: z.number().nonnegative().default(0),
  credit: z.number().nonnegative().default(0),
});

const createJournalEntrySchema = z.object({
  entryNumber: z.string().min(1, 'Entry number is required').max(50),
  postingDate: z.string().datetime(),
  sourceModule: z.string().min(1, 'Source module is required').max(50),
  sourceId: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  lines: z.array(journalLineSchema).min(2, 'At least two lines required'),
});

const updateJournalEntrySchema = z.object({
  entryNumber: z.string().max(50).optional(),
  postingDate: z.string().datetime().optional(),
  sourceModule: z.string().max(50).optional(),
  sourceId: z.string().optional(),
  description: z.string().optional(),
  lines: z.array(journalLineSchema).min(2).optional(),
});

const journalParamsSchema = z.object({
  id: z.string().uuid('Invalid journal entry ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sourceModule: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// Validation function to ensure debits equal credits
function validateBalanced(lines: { debit: number; credit: number }[]): boolean {
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}

// GET /api/journal
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, sourceModule, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  if (sourceModule) where.sourceModule = sourceModule;
  if (fromDate || toDate) {
    where.postingDate = {};
    if (fromDate) where.postingDate.gte = new Date(fromDate);
    if (toDate) where.postingDate.lte = new Date(toDate);
  }

  if (search) {
    where.OR = [
      { entryNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      skip,
      take: limit,
      orderBy: { postingDate: 'desc' },
      include: {
        lines: {
          include: {
            account: { select: { id: true, accountNumber: true, name: true, type: true } },
          },
        },
      },
    }),
    prisma.journalEntry.count({ where }),
  ]);

  res.json({
    data: entries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/journal/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(journalParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          account: { select: { id: true, accountNumber: true, name: true, type: true } },
        },
      },
    },
  });

  if (!entry) {
    throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
  }

  if (entry.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: entry });
}));

// POST /api/journal
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateBody(createJournalEntrySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Validate balanced entry
  if (!validateBalanced(data.lines)) {
    throw new AppError(400, 'UNBALANCED_ENTRY', 'Total debits must equal total credits');
  }

  // Check if entry number already exists
  const existing = await prisma.journalEntry.findUnique({
    where: { entryNumber: data.entryNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_ENTRY_NUMBER', 'Entry number already exists');
  }

  // Verify all accounts belong to organization
  const accountIds = data.lines.map((l: any) => l.accountId);
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
  });

  if (accounts.length !== accountIds.length) {
    throw new AppError(400, 'INVALID_ACCOUNT', 'One or more accounts not found');
  }

  const invalidOrg = accounts.some(a => a.organizationId !== req.user!.organizationId);
  if (invalidOrg) {
    throw new AppError(403, 'FORBIDDEN', 'Account belongs to different organization');
  }

  const entry = await prisma.journalEntry.create({
    data: {
      ...data,
      postingDate: new Date(data.postingDate),
      organizationId: req.user!.organizationId,
      lines: {
        create: data.lines.map((line: any) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: { select: { id: true, accountNumber: true, name: true, type: true } },
        },
      },
    },
  });

  // Update account balances
  for (const line of data.lines) {
    const account = accounts.find(a => a.id === line.accountId);
    if (account) {
      const balanceChange = line.debit - line.credit;
      const newBalance = Number(account.currentBalance) + balanceChange;
      await prisma.account.update({
        where: { id: account.id },
        data: { currentBalance: newBalance },
      });
    }
  }

  res.status(201).json({ data: entry });
}));

// PUT /api/journal/:id (only for draft/reversible entries)
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(journalParamsSchema), validateBody(updateJournalEntrySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!entry) {
    throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
  }

  if (entry.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Don't allow editing posted entries from source modules (only manual entries)
  if (entry.sourceModule !== 'MANUAL' && !entry.isReversed) {
    throw new AppError(400, 'CANNOT_EDIT', 'Cannot edit posted entries from source modules');
  }

  // If lines are being updated, validate balance
  if (data.lines) {
    if (!validateBalanced(data.lines)) {
      throw new AppError(400, 'UNBALANCED_ENTRY', 'Total debits must equal total credits');
    }

    // Verify all accounts belong to organization
    const accountIds = data.lines.map((l: any) => l.accountId);
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds } },
    });

    if (accounts.length !== accountIds.length) {
      throw new AppError(400, 'INVALID_ACCOUNT', 'One or more accounts not found');
    }

    const invalidOrg = accounts.some(a => a.organizationId !== req.user!.organizationId);
    if (invalidOrg) {
      throw new AppError(403, 'FORBIDDEN', 'Account belongs to different organization');
    }
  }

  // Reverse old balances
  for (const line of entry.lines) {
    const balanceChange = line.credit - line.debit; // Reverse
    await prisma.account.update({
      where: { id: line.accountId },
      data: { currentBalance: { increment: balanceChange } },
    });
  }

  // Delete old lines
  await prisma.journalLine.deleteMany({
    where: { journalEntryId: id },
  });

  // Create new lines and apply new balances
  const newLines = data.lines || entry.lines.map(l => ({
    accountId: l.accountId,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
  }));

  const updatedEntry = await prisma.journalEntry.update({
    where: { id },
    data: {
      ...data,
      postingDate: data.postingDate ? new Date(data.postingDate) : undefined,
      lines: {
        create: newLines.map((line: any) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: { select: { id: true, accountNumber: true, name: true, type: true } },
        },
      },
    },
  });

  // Apply new balances
  for (const line of newLines) {
    const balanceChange = line.debit - line.credit;
    await prisma.account.update({
      where: { id: line.accountId },
      data: { currentBalance: { increment: balanceChange } },
    });
  }

  res.json({ data: updatedEntry });
}));

// POST /api/journal/:id/reverse
router.post('/:id/reverse', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(journalParamsSchema), validateBody(z.object({
  reversalEntryNumber: z.string().min(1).max(50),
  reversalDate: z.string().datetime(),
  reversalDescription: z.string().min(1),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reversalEntryNumber, reversalDate, reversalDescription } = req.body;

  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true },
  });

  if (!entry) {
    throw new AppError(404, 'NOT_FOUND', 'Journal entry not found');
  }

  if (entry.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (entry.isReversed) {
    throw new AppError(400, 'ALREADY_REVERSED', 'Entry already reversed');
  }

  // Check if reversal entry number exists
  const existing = await prisma.journalEntry.findUnique({
    where: { entryNumber: reversalEntryNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_ENTRY_NUMBER', 'Reversal entry number already exists');
  }

  // Create reversal entry
  const reversalEntry = await prisma.journalEntry.create({
    data: {
      entryNumber: reversalEntryNumber,
      postingDate: new Date(reversalDate),
      sourceModule: 'MANUAL',
      description: reversalDescription,
      isReversed: false,
      reversalEntryId: id,
      organizationId: req.user!.organizationId,
      lines: {
        create: entry.lines.map(line => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.credit, // Swap debit/credit
          credit: line.debit,
        })),
      },
    },
    include: {
      lines: {
        include: {
          account: { select: { id: true, accountNumber: true, name: true, type: true } },
        },
      },
    },
  });

  // Mark original as reversed
  await prisma.journalEntry.update({
    where: { id },
    data: {
      isReversed: true,
      reversalEntryId: reversalEntry.id,
    },
  });

  // Reverse account balances
  for (const line of entry.lines) {
    const balanceChange = line.credit - line.debit;
    await prisma.account.update({
      where: { id: line.accountId },
      data: { currentBalance: { increment: balanceChange } },
    });
  }

  res.status(201).json({ data: reversalEntry });
}));

export default router;