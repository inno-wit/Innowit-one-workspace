import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createBranchSchema = z.object({
  branchCode: z.string().min(1, 'Branch code is required').max(10),
  name: z.string().min(1, 'Name is required').max(255),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  isHq: z.boolean().default(false),
});

const updateBranchSchema = createBranchSchema.partial();

const branchParamsSchema = z.object({
  id: z.string().uuid('Invalid branch ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

// GET /api/branches
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  // Non-admin users can only see their own branch
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.id = req.user!.branchId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { branchCode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [branches, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { users: true, warehouses: true, invoices: true },
        },
      },
    }),
    prisma.branch.count({ where }),
  ]);

  res.json({
    data: branches,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/branches/:id
router.get('/:id', authenticateToken, validateParams(branchParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const branch = await prisma.branch.findUnique({
    where: { id },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
        },
      },
      warehouses: true,
      _count: {
        select: { users: true, warehouses: true, invoices: true, purchaseOrders: true },
      },
    },
  });

  if (!branch) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  if (branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && branch.id !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: branch });
}));

// POST /api/branches
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateBody(createBranchSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if branch code already exists in organization
  const existing = await prisma.branch.findUnique({
    where: {
      organizationId_branchCode: {
        organizationId: req.user!.organizationId,
        branchCode: data.branchCode,
      },
    },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_BRANCH_CODE', 'Branch code already exists in this organization');
  }

  // If this is HQ, ensure no other HQ exists
  if (data.isHq) {
    const existingHq = await prisma.branch.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        isHq: true,
      },
    });

    if (existingHq) {
      throw new AppError(409, 'HQ_EXISTS', 'An HQ branch already exists for this organization');
    }
  }

  const branch = await prisma.branch.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
    },
    include: {
      _count: {
        select: { users: true, warehouses: true, invoices: true },
      },
    },
  });

  res.status(201).json({ data: branch });
}));

// PUT /api/branches/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(branchParamsSchema), validateBody(updateBranchSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const branch = await prisma.branch.findUnique({
    where: { id },
  });

  if (!branch) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  if (branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check branch code uniqueness if changing
  if (data.branchCode && data.branchCode !== branch.branchCode) {
    const existing = await prisma.branch.findUnique({
      where: {
        organizationId_branchCode: {
          organizationId: req.user!.organizationId,
          branchCode: data.branchCode,
        },
      },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_BRANCH_CODE', 'Branch code already exists in this organization');
    }
  }

  // Handle HQ change
  if (data.isHq === true && !branch.isHq) {
    const existingHq = await prisma.branch.findFirst({
      where: {
        organizationId: req.user!.organizationId,
        isHq: true,
        id: { not: id },
      },
    });

    if (existingHq) {
      throw new AppError(409, 'HQ_EXISTS', 'An HQ branch already exists for this organization');
    }
  }

  const updatedBranch = await prisma.branch.update({
    where: { id },
    data,
    include: {
      _count: {
        select: { users: true, warehouses: true, invoices: true },
      },
    },
  });

  res.json({ data: updatedBranch });
}));

// DELETE /api/branches/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(branchParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const branch = await prisma.branch.findUnique({
    where: { id },
    include: {
      _count: {
        select: { users: true, warehouses: true, invoices: true, purchaseOrders: true },
      },
    },
  });

  if (!branch) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  if (branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Prevent deletion if branch has related records
  if (branch._count.users > 0 || branch._count.warehouses > 0 || branch._count.invoices > 0 || branch._count.purchaseOrders > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete branch with existing users, warehouses, invoices, or purchase orders');
  }

  await prisma.branch.delete({
    where: { id },
  });

  res.json({ message: 'Branch deleted successfully' });
}));

export default router;