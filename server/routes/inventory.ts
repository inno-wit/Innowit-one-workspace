import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createStockMovementSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  warehouseId: z.string().uuid('Invalid warehouse ID'),
  movementType: z.enum(['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'RETURN']),
  quantity: z.number().positive('Quantity must be positive'),
  unitCost: z.number().nonnegative('Unit cost must be non-negative'),
  referenceDocument: z.string().optional(),
  notes: z.string().optional(),
});

const movementParamsSchema = z.object({
  id: z.string().uuid('Invalid movement ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  movementType: z.enum(['RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'RETURN']).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// GET /api/inventory/movements
router.get('/movements', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, productId, warehouseId, movementType, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    product: { organizationId: req.user!.organizationId },
  };

  // Non-admin users can only see movements in their branch's warehouses
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.warehouse = { branchId: req.user!.branchId };
  } else if (warehouseId) {
    where.warehouseId = warehouseId;
  }

  if (productId) where.productId = productId;
  if (movementType) where.movementType = movementType;
  if (fromDate || toDate) {
    where.timestamp = {};
    if (fromDate) where.timestamp.gte = new Date(fromDate);
    if (toDate) where.timestamp.lte = new Date(toDate);
  }

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { 
          select: { id: true, name: true, code: true, branch: { select: { id: true, name: true } } } 
        },
      },
    }),
    prisma.stockMovement.count({ where }),
  ]);

  res.json({
    data: movements,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/inventory/movements/:id
router.get('/movements/:id', authenticateToken, validateParams(movementParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const movement = await prisma.stockMovement.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, sku: true, name: true, organizationId: true } },
      warehouse: { 
        select: { id: true, name: true, code: true, branch: { select: { id: true, name: true, organizationId: true } } } 
      },
    },
  });

  if (!movement) {
    throw new AppError(404, 'NOT_FOUND', 'Stock movement not found');
  }

  if (movement.product.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role) && movement.warehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: movement });
}));

// POST /api/inventory/movements (Create stock movement with automatic stock level update)
router.post('/movements', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'), validateBody(createStockMovementSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify product belongs to organization
  const product = await prisma.product.findUnique({
    where: { id: data.productId },
  });

  if (!product || product.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  // Verify warehouse belongs to organization
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: data.warehouseId },
    include: { branch: true },
  });

  if (!warehouse || warehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Warehouse not found');
  }

  // Check branch access
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role) && warehouse.branchId !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this warehouse');
  }

  // Get or create stock level
  let stockLevel = await prisma.warehouseStock.findUnique({
    where: {
      productId_warehouseId: {
        productId: data.productId,
        warehouseId: data.warehouseId,
      },
    },
  });

  if (!stockLevel) {
    stockLevel = await prisma.warehouseStock.create({
      data: {
        productId: data.productId,
        warehouseId: data.warehouseId,
        quantityOnHand: 0,
        quantityReserved: 0,
      },
    });
  }

  // Calculate new quantities based on movement type
  let newQuantityOnHand = Number(stockLevel.quantityOnHand);
  let newQuantityReserved = Number(stockLevel.quantityReserved);

  switch (data.movementType) {
    case 'RECEIPT':
      newQuantityOnHand += data.quantity;
      break;
    case 'ISSUE':
      if (newQuantityOnHand < data.quantity) {
        throw new AppError(400, 'INSUFFICIENT_STOCK', `Insufficient stock. Available: ${newQuantityOnHand}`);
      }
      newQuantityOnHand -= data.quantity;
      break;
    case 'ADJUSTMENT':
      // For adjustments, quantity is the new total
      newQuantityOnHand = data.quantity;
      break;
    case 'RETURN':
      newQuantityOnHand += data.quantity;
      break;
    case 'TRANSFER':
      // Transfer out - handled by separate transfer endpoint
      throw new AppError(400, 'INVALID_TYPE', 'Use transfer endpoint for transfers');
  }

  // Create movement and update stock level in transaction
  const movement = await prisma.$transaction(async (tx) => {
    const newMovement = await tx.stockMovement.create({
      data: {
        ...data,
        unitCost: data.unitCost || product.costPrice,
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });

    await tx.warehouseStock.update({
      where: { id: stockLevel!.id },
      data: {
        quantityOnHand: newQuantityOnHand,
        quantityReserved: newQuantityReserved,
      },
    });

    return newMovement;
  });

  res.status(201).json({ data: movement });
}));

// POST /api/inventory/transfer (Transfer stock between warehouses)
router.post('/transfer', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'), validateBody(z.object({
  productId: z.string().uuid(),
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().optional(),
  referenceDocument: z.string().optional(),
  notes: z.string().optional(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { productId, fromWarehouseId, toWarehouseId, quantity, unitCost, referenceDocument, notes } = req.body;

  if (fromWarehouseId === toWarehouseId) {
    throw new AppError(400, 'SAME_WAREHOUSE', 'Source and destination warehouses must be different');
  }

  // Verify product
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product || product.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }

  // Verify both warehouses
  const [fromWarehouse, toWarehouse] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: fromWarehouseId }, include: { branch: true } }),
    prisma.warehouse.findUnique({ where: { id: toWarehouseId }, include: { branch: true } }),
  ]);

  if (!fromWarehouse || fromWarehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Source warehouse not found');
  }

  if (!toWarehouse || toWarehouse.branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Destination warehouse not found');
  }

  // Check branch access
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    if (fromWarehouse.branchId !== req.user!.branchId || toWarehouse.branchId !== req.user!.branchId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied to one or both warehouses');
    }
  }

  // Get source stock level
  const fromStockLevel = await prisma.warehouseStock.findUnique({
    where: {
      productId_warehouseId: {
        productId,
        warehouseId: fromWarehouseId,
      },
    },
  });

  if (!fromStockLevel || Number(fromStockLevel.quantityOnHand) < quantity) {
    throw new AppError(400, 'INSUFFICIENT_STOCK', `Insufficient stock in source warehouse. Available: ${fromStockLevel ? Number(fromStockLevel.quantityOnHand) : 0}`);
  }

  // Get or create destination stock level
  let toStockLevel = await prisma.warehouseStock.findUnique({
    where: {
      productId_warehouseId: {
        productId,
        warehouseId: toWarehouseId,
      },
    },
  });

  if (!toStockLevel) {
    toStockLevel = await prisma.warehouseStock.create({
      data: {
        productId,
        warehouseId: toWarehouseId,
        quantityOnHand: 0,
        quantityReserved: 0,
      },
    });
  }

  // Create both movements and update stock levels in transaction
  const movements = await prisma.$transaction(async (tx) => {
    // Out movement
    const outMovement = await tx.stockMovement.create({
      data: {
        productId,
        warehouseId: fromWarehouseId,
        movementType: 'TRANSFER',
        quantity,
        unitCost: unitCost || product.costPrice,
        referenceDocument,
        notes: notes ? `${notes} (Transfer out)` : 'Transfer out',
      },
    });

    // In movement
    const inMovement = await tx.stockMovement.create({
      data: {
        productId,
        warehouseId: toWarehouseId,
        movementType: 'TRANSFER',
        quantity,
        unitCost: unitCost || product.costPrice,
        referenceDocument,
        notes: notes ? `${notes} (Transfer in)` : 'Transfer in',
      },
    });

    // Update stock levels
    await tx.warehouseStock.update({
      where: { id: fromStockLevel.id },
      data: { quantityOnHand: { decrement: quantity } },
    });

    await tx.warehouseStock.update({
      where: { id: toStockLevel!.id },
      data: { quantityOnHand: { increment: quantity } },
    });

    return { outMovement, inMovement };
  });

  res.status(201).json({ data: movements });
}));

// GET /api/inventory/stock-levels (Current stock across all warehouses)
router.get('/stock-levels', authenticateToken, validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  lowStock: z.coerce.boolean().optional(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, productId, warehouseId, lowStock } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    product: { organizationId: req.user!.organizationId },
  };

  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (lowStock) {
    where.quantityOnHand = { lte: prisma.warehouseStock.fields.productId }; // This needs raw query
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'INVENTORY_MANAGER', 'PROCUREMENT_OFFICER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.warehouse = { branchId: req.user!.branchId };
  }

  const [stockLevels, total] = await Promise.all([
    prisma.warehouseStock.findMany({
      where,
      skip,
      take: limit,
      orderBy: { quantityOnHand: 'asc' },
      include: {
        product: { select: { id: true, sku: true, name: true, reorderLevel: true, costPrice: true, sellingPrice: true } },
        warehouse: { select: { id: true, name: true, code: true, branch: { select: { id: true, name: true } } } },
      },
    }),
    prisma.warehouseStock.count({ where }),
  ]);

  res.json({
    data: stockLevels,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

export default router;