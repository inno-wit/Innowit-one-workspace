import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createSupplierSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  kraPin: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  paymentTermsDays: z.number().int().nonnegative().default(30),
});

const updateSupplierSchema = createSupplierSchema.partial();

const supplierParamsSchema = z.object({
  id: z.string().uuid('Invalid supplier ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

// GET /api/suppliers
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { kraPin: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { purchaseOrders: true } },
      },
    }),
    prisma.supplier.count({ where }),
  ]);

  res.json({
    data: suppliers,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/suppliers/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER', 'FINANCE_MANAGER'), validateParams(supplierParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: { select: { purchaseOrders: true } },
    },
  });

  if (!supplier) {
    throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  }

  res.json({ data: supplier });
}));

// POST /api/suppliers
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER'), validateBody(createSupplierSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const supplier = await prisma.supplier.create({
    data: req.body,
  });

  res.status(201).json({ data: supplier });
}));

// PUT /api/suppliers/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'PROCUREMENT_OFFICER'), validateParams(supplierParamsSchema), validateBody(updateSupplierSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const supplier = await prisma.supplier.update({
    where: { id },
    data: req.body,
  });

  res.json({ data: supplier });
}));

// DELETE /api/suppliers/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(supplierParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: { _count: { select: { purchaseOrders: true } } },
  });

  if (!supplier) {
    throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  }

  if (supplier._count.purchaseOrders > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete supplier with existing purchase orders');
  }

  await prisma.supplier.delete({ where: { id } });
  res.json({ message: 'Supplier deleted successfully' });
}));

export default router;