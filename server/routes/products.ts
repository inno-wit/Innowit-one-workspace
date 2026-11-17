import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createProductSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(50),
  barcode: z.string().optional(),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  uom: z.string().default('PCS'),
  costPrice: z.number().nonnegative('Cost price must be non-negative'),
  sellingPrice: z.number().nonnegative('Selling price must be non-negative'),
  taxClassification: z.enum(['STANDARD_16', 'ZERO_RATED', 'EXEMPT', 'WITHHOLDING']).default('STANDARD_16'),
  reorderLevel: z.number().int().nonnegative().default(10),
});

const updateProductSchema = createProductSchema.partial();

const productParamsSchema = z.object({
  id: z.string().uuid('Invalid product ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  lowStock: z.coerce.boolean().optional(),
});

// GET /api/products
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, lowStock } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  if (search) {
    where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (lowStock) {
    where.stockLevels = {
      some: {
        quantityOnHand: { lte: prisma.product.fields.reorderLevel },
      },
    };
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        stockLevels: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
        _count: { select: { movements: true, invoiceItems: true, orderItems: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  res.json({
    data: products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/products/:id
router.get('/:id', authenticateToken, validateParams(productParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      stockLevels: {
        include: {
          warehouse: { select: { id: true, name: true, code: true, branch: { select: { id: true, name: true } } } },
        },
      },
      movements: {
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
        },
        orderBy: { timestamp: 'desc' },
        take: 20,
      },
      _count: { select: { movements: true, invoiceItems: true, orderItems: true } },
    },
  });

  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  if (product.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: product });
}));

// POST /api/products
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'), validateBody(createProductSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if SKU already exists
  const existing = await prisma.product.findUnique({
    where: { sku: data.sku },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_SKU', 'SKU already exists');
  }

  // Check barcode uniqueness if provided
  if (data.barcode) {
    const existingBarcode = await prisma.product.findUnique({
      where: { barcode: data.barcode },
    });

    if (existingBarcode) {
      throw new AppError(409, 'DUPLICATE_BARCODE', 'Barcode already exists');
    }
  }

  const product = await prisma.product.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
    },
    include: {
      stockLevels: {
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });

  res.status(201).json({ data: product });
}));

// PUT /api/products/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'), validateParams(productParamsSchema), validateBody(updateProductSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const product = await prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  if (product.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check SKU uniqueness if changing
  if (data.sku && data.sku !== product.sku) {
    const existing = await prisma.product.findUnique({
      where: { sku: data.sku },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_SKU', 'SKU already exists');
    }
  }

  // Check barcode uniqueness if changing
  if (data.barcode && data.barcode !== product.barcode) {
    const existing = await prisma.product.findUnique({
      where: { barcode: data.barcode },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_BARCODE', 'Barcode already exists');
    }
  }

  const updatedProduct = await prisma.product.update({
    where: { id },
    data,
    include: {
      stockLevels: {
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });

  res.json({ data: updatedProduct });
}));

// DELETE /api/products/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'), validateParams(productParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: { _count: { select: { movements: true, invoiceItems: true, orderItems: true, stockLevels: true } } },
  });

  if (!product) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  if (product.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (product._count.movements > 0 || product._count.invoiceItems > 0 || product._count.orderItems > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete product with existing movements, invoice items, or order items');
  }

  await prisma.product.delete({
    where: { id },
  });

  res.json({ message: 'Product deleted successfully' });
}));

export default router;