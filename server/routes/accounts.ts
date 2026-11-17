import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createAccountSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required').max(20),
  name: z.string().min(1, 'Account name is required').max(255),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).default('KES'),
  isActive: z.boolean().default(true),
  currentBalance: z.number().default(0),
});

const updateAccountSchema = createAccountSchema.partial();

const accountParamsSchema = z.object({
  id: z.string().uuid('Invalid account ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().optional(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']).optional(),
  isActive: z.coerce.boolean().optional(),
});

// GET /api/accounts
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, type, isActive } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  if (type) where.type = type;
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where.OR = [
      { accountNumber: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      skip,
      take: limit,
      orderBy: { accountNumber: 'asc' },
      include: {
        _count: { select: { journalLines: true } },
      },
    }),
    prisma.account.count({ where }),
  ]);

  res.json({
    data: accounts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/accounts/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(accountParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const account = await prisma.account.findUnique({
    where: { id },
    include: {
      journalLines: {
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              postingDate: true,
              sourceModule: true,
              description: true,
            },
          },
        },
        orderBy: { journalEntry: { postingDate: 'desc' } },
        take: 50,
      },
      _count: { select: { journalLines: true } },
    },
  });

  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  if (account.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: account });
}));

// POST /api/accounts
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateBody(createAccountSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if account number already exists in organization
  const existing = await prisma.account.findUnique({
    where: {
      organizationId_accountNumber: {
        organizationId: req.user!.organizationId,
        accountNumber: data.accountNumber,
      },
    },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_ACCOUNT_NUMBER', 'Account number already exists in this organization');
  }

  const account = await prisma.account.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      currentBalance: data.currentBalance || 0,
    },
    include: {
      _count: { select: { journalLines: true } },
    },
  });

  res.status(201).json({ data: account });
}));

// PUT /api/accounts/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(accountParamsSchema), validateBody(updateAccountSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const account = await prisma.account.findUnique({
    where: { id },
  });

  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  if (account.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check account number uniqueness if changing
  if (data.accountNumber && data.accountNumber !== account.accountNumber) {
    const existing = await prisma.account.findUnique({
      where: {
        organizationId_accountNumber: {
          organizationId: req.user!.organizationId,
          accountNumber: data.accountNumber,
        },
      },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_ACCOUNT_NUMBER', 'Account number already exists in this organization');
    }
  }

  const updatedAccount = await prisma.account.update({
    where: { id },
    data,
    include: {
      _count: { select: { journalLines: true } },
    },
  });

  res.json({ data: updatedAccount });
}));

// DELETE /api/accounts/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(accountParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const account = await prisma.account.findUnique({
    where: { id },
    include: { _count: { select: { journalLines: true } } },
  });

  if (!account) {
    throw new AppError(404, 'NOT_FOUND', 'Account not found');
  }

  if (account.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (account._count.journalLines > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete account with existing journal entries');
  }

  await prisma.account.delete({
    where: { id },
  });

  res.json({ message: 'Account deleted successfully' });
}));

// GET /api/accounts/chart-of-accounts
router.get('/chart-of-accounts', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const accounts = await prisma.account.findMany({
    where: {
      organizationId: req.user!.organizationId,
      isActive: true,
    },
    orderBy: { accountNumber: 'asc' },
  });

  // Group by type
  const grouped = accounts.reduce((acc, account) => {
    if (!acc[account.type]) {
      acc[account.type] = [];
    }
    acc[account.type].push(account);
    return acc;
  }, {} as Record<string, typeof accounts>);

  res.json({ data: grouped });
}));

export default router;