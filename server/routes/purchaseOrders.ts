import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createPoSchema = z.object({
  branchId: z.string().uuid('Invalid branch ID'),
  supplierId: z.string().uuid('Invalid supplier ID'),
  poNumber: z.string().min(1, 'PO number is required').max(50),
  orderDate: z.string().datetime(),
  totalAmount: z.number().nonnegative('Total amount must be non-negative'),
  isApproved: z.boolean().default(false),
});

const updatePoSchema = createPoSchema.partial();

const poParamsSchema = z.object({
  id: z.string().uuid('Invalid purchase order ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  isApproved: z.coerce.boolean().optional(),
});

// GET /api/purchase-orders
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, supplierId, branchId, isApproved } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    branch: { organizationId: req.user!.organizationId },
  };

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.branchId = req.user!.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (supplierId) where.supplierId = supplierId;
  if (isApproved !== undefined) where.isApproved = isApproved;

  if (search) {
    where.OR = [
      { poNumber: { contains: search, mode: 'insensitive' } },
      { supplier: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: { select: { id: true, name: true, branchCode: true } },
        supplier: { select: { id: true, name: true, kraPin: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  res.json({
    data: orders,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/purchase-orders/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'), validateParams(poParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, name: true, branchCode: true, organizationId: true } },
      supplier: { select: { id: true, name: true, kraPin: true, email: true, phone: true, paymentTermsDays: true } },
    },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  }

  if (order.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && order.branchId !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: order });
}));

// POST /api/purchase-orders
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER'), validateBody(createPoSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify branch
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
  });

  if (!branch || branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && branch.id !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this branch');
  }

  // Verify supplier
  const supplier = await prisma.supplier.findUnique({
    where: { id: data.supplierId },
  });

  if (!supplier) {
    throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  }

  // Check PO number uniqueness
  const existing = await prisma.purchaseOrder.findUnique({
    where: { poNumber: data.poNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_PO_NUMBER', 'PO number already exists');
  }

  const order = await prisma.purchaseOrder.create({
    data: {
      ...data,
      orderDate: new Date(data.orderDate),
    },
    include: {
      branch: { select: { id: true, name: true, branchCode: true } },
      supplier: { select: { id: true, name: true } },
    },
  });

  res.status(201).json({ data: order });
}));

// PUT /api/purchase-orders/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER'), validateParams(poParamsSchema), validateBody(updatePoSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { branch: true },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  }

  if (order.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Verify branch if changing
  if (data.branchId && data.branchId !== order.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: data.branchId },
    });

    if (!branch || branch.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Branch not found');
    }
  }

  // Verify supplier if changing
  if (data.supplierId && data.supplierId !== order.supplierId) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: data.supplierId },
    });

    if (!supplier) {
      throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
    }
  }

  // Check PO number if changing
  if (data.poNumber && data.poNumber !== order.poNumber) {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { poNumber: data.poNumber },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_PO_NUMBER', 'PO number already exists');
    }
  }

  const updatedOrder = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      ...data,
      orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
    },
    include: {
      branch: { select: { id: true, name: true, branchCode: true } },
      supplier: { select: { id: true, name: true } },
    },
  });

  res.json({ data: updatedOrder });
}));

// POST /api/purchase-orders/:id/approve
router.post('/:id/approve', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'), validateParams(poParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { branch: true },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  }

  if (order.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (order.isApproved) {
    throw new AppError(400, 'ALREADY_APPROVED', 'Purchase order already approved');
  }

  const updatedOrder = await prisma.purchaseOrder.update({
    where: { id },
    data: { isApproved: true },
    include: {
      branch: { select: { id: true, name: true, branchCode: true } },
      supplier: { select: { id: true, name: true } },
    },
  });

  res.json({ data: updatedOrder, message: 'Purchase order approved' });
}));

// DELETE /api/purchase-orders/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(poParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { branch: true },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  }

  if (order.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (order.isApproved) {
    throw new AppError(400, 'ALREADY_APPROVED', 'Cannot delete approved purchase order');
  }

  await prisma.purchaseOrder.delete({ where: { id } });
  res.json({ message: 'Purchase order deleted successfully' });
}));

export default router;