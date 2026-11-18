import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createWarehouseSchema = z.object({
  branchId: z.string().uuid('Invalid branch ID'),
  name: z.string().min(1, 'Name is required').max(255),
  code: z.string().min(1, 'Code is required').max(20),
  location: z.string().optional(),
});

const updateWarehouseSchema = createWarehouseSchema.partial();

const warehouseParamsSchema = z.object({
  id: z.string().uuid('Invalid warehouse ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  branchId: z.string().uuid().optional(),
});

// GET /api/warehouses
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, branchId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    branch: { organizationId: req.user!.organizationId },
  };

  // Non-admin users can only see warehouses in their branch
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.branchId = req.user!.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [warehouses, total] = await Promise.all([
    prisma.warehouse.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true, branchCode: true } },
        _count: { select: { stockLevels: true, movements: true } },
      },
    }),
    prisma.warehouse.count({ where }),
  ]);

  res.json({
    data: warehouses,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/warehouses/:id
router.get('/:id', authenticateToken, validateParams(warehouseParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true, branchCode: true, organizationId: true } },
      stockLevels: {
        include: {
          product: { select: { id: true, sku: true, name: true, reorderLevel: true } },
        },
        orderBy: { quantityOnHand: 'asc' },
      },
      _count: { select: { stockLevels: true, movements: true } },
    },
  });

  if (!warehouse) {
    throw new AppError(404, 'NOT_FOUND', 'Warehouse not found');
  }

  if (warehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role) && warehouse.branchId !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: warehouse });
}));

// POST /api/warehouses
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'), validateBody(createWarehouseSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify branch belongs to organization
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
  });

  if (!branch || branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  // Check if code already exists in branch (audit fix SC-6: branch-scoped unique)
  const existing = await prisma.warehouse.findUnique({
    where: { branchId_code: { branchId: data.branchId, code: data.code } },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_CODE', 'Warehouse code already exists in this branch');
  }

  const warehouse = await prisma.warehouse.create({
    data,
    include: {
      branch: { select: { id: true, name: true, branchCode: true } },
      _count: { select: { stockLevels: true, movements: true } },
    },
  });

  res.status(201).json({ data: warehouse });
}));

// PUT /api/warehouses/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'), validateParams(warehouseParamsSchema), validateBody(updateWarehouseSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    include: { branch: true },
  });

  if (!warehouse) {
    throw new AppError(404, 'NOT_FOUND', 'Warehouse not found');
  }

  if (warehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check code uniqueness if changing (audit fix SC-6: branch-scoped unique)
  if (data.code && data.code !== warehouse.code) {
    const branchId = data.branchId ?? warehouse.branchId;
    const existing = await prisma.warehouse.findUnique({
      where: { branchId_code: { branchId, code: data.code } },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_CODE', 'Warehouse code already exists in this branch');
    }
  }

  // Verify branch if changing
  if (data.branchId && data.branchId !== warehouse.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: data.branchId },
    });

    if (!branch || branch.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Branch not found');
    }
  }

  const updatedWarehouse = await prisma.warehouse.update({
    where: { id },
    data,
    include: {
      branch: { select: { id: true, name: true, branchCode: true } },
      _count: { select: { stockLevels: true, movements: true } },
    },
  });

  res.json({ data: updatedWarehouse });
}));

// DELETE /api/warehouses/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'), validateParams(warehouseParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const warehouse = await prisma.warehouse.findUnique({
    where: { id },
    include: { 
      branch: true,
      _count: { select: { stockLevels: true, movements: true } },
    },
  });

  if (!warehouse) {
    throw new AppError(404, 'NOT_FOUND', 'Warehouse not found');
  }

  if (warehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (warehouse._count.stockLevels > 0 || warehouse._count.movements > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete warehouse with existing stock levels or movements');
  }

  await prisma.warehouse.delete({
    where: { id },
  });

  res.json({ message: 'Warehouse deleted successfully' });
}));

export default router;