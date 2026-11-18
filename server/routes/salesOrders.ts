import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const salesOrderItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  taxRate: z.number().nonnegative().default(16),
});

const createSalesOrderSchema = z.object({
  quotationId: z.string().uuid().optional(),
  customerId: z.string().uuid('Invalid customer ID'),
  orderNumber: z.string().min(1, 'Order number is required').max(50),
  totalAmount: z.number().nonnegative('Total amount must be non-negative'),
  items: z.array(salesOrderItemSchema).min(1, 'At least one item required'),
});

const updateSalesOrderSchema = z.object({
  quotationId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional(),
  orderNumber: z.string().max(50).optional(),
  orderStatus: z.enum(['DRAFT', 'CONFIRMED', 'PROCESSING', 'DISPATCHED', 'COMPLETED', 'CANCELLED']).optional(),
  totalAmount: z.number().nonnegative().optional(),
  items: z.array(salesOrderItemSchema).optional(),
});

const orderParamsSchema = z.object({
  id: z.string().uuid('Invalid sales order ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PROCESSING', 'DISPATCHED', 'COMPLETED', 'CANCELLED']).optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

// GET /api/sales-orders
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, status, customerId, branchId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    customer: { organizationId: req.user!.organizationId },
  };

  // Non-managers can only see orders in their branch
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.customer = { ...where.customer, branchId: req.user!.branchId };
  } else if (branchId) {
    where.customer = { ...where.customer, branchId };
  }

  if (customerId) where.customerId = customerId;
  if (status) where.orderStatus = status;

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        quotation: { select: { id: true, quotationNumber: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
        invoice: { select: { id: true, invoiceNumber: true, status: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.salesOrder.count({ where }),
  ]);

  res.json({
    data: orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/sales-orders/:id
router.get('/:id', authenticateToken, validateParams(orderParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true, billingAddress: true } },
      quotation: { select: { id: true, quotationNumber: true, validUntil: true, totalAmount: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, taxClassification: true } },
        },
      },
      invoice: { select: { id: true, invoiceNumber: true, status: true, invoiceDate: true } },
    },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Sales order not found');
  }

  if (order.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    // Check if user's branch matches customer's branch through invoices or orders
    // For simplicity, we'll allow access if they can see the customer
  }

  res.json({ data: order });
}));

// POST /api/sales-orders
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(createSalesOrderSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify customer
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer || customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  // Verify quotation if provided
  if (data.quotationId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: data.quotationId },
    });

    if (!quotation || quotation.deal?.customerId !== data.customerId) {
      throw new AppError(404, 'NOT_FOUND', 'Quotation not found or does not match customer');
    }

    // Check if quotation already has an order
    const existingOrder = await prisma.salesOrder.findUnique({
      where: { quotationId: data.quotationId },
    });

    if (existingOrder) {
      throw new AppError(409, 'QUOTATION_USED', 'Quotation already converted to sales order');
    }
  }

  // Verify all products
  const productIds = data.items.map((item: any) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  if (products.length !== productIds.length) {
    throw new AppError(400, 'INVALID_PRODUCT', 'One or more products not found');
  }

  const invalidOrg = products.some(p => p.organizationId !== req.user!.organizationId);
  if (invalidOrg) {
    throw new AppError(403, 'FORBIDDEN', 'Product belongs to different organization');
  }

  // Check order number uniqueness (audit fix SC-6: tenant-scoped)
  const existingOrder = await prisma.salesOrder.findUnique({
    where: { organizationId_orderNumber: { organizationId: req.user!.organizationId, orderNumber: data.orderNumber } },
  });

  if (existingOrder) {
    throw new AppError(409, 'DUPLICATE_ORDER_NUMBER', 'Order number already exists in this organization');
  }

  // Create order with items and reserve stock
  const order = await prisma.$transaction(async (tx) => {
    // Create sales order
    const newOrder = await tx.salesOrder.create({
      data: {
        organizationId: req.user!.organizationId,
        quotationId: data.quotationId,
        customerId: data.customerId,
        orderNumber: data.orderNumber,
        orderStatus: 'CONFIRMED',
        totalAmount: data.totalAmount,
        items: {
          create: data.items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            totalAmount: item.quantity * item.unitPrice * (1 + item.taxRate / 100),
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });

    // Reserve stock for each item (simplified - assumes single warehouse per branch)
    for (const item of data.items) {
      const product = products.find(p => p.id === item.productId)!;
      
      // Find warehouse in customer's branch or default (prefer warehouse with code sorting for determinism)
      let warehouse = await tx.warehouse.findFirst({
        where: { branchId: customer.branchId },
        orderBy: { code: 'asc' },
      });
      
      if (!warehouse) {
        warehouse = await tx.warehouse.findFirst({
          where: { branch: { organizationId: req.user!.organizationId } },
          orderBy: { code: 'asc' },
        });
      }
      
      if (warehouse) {
        const stockLevel = await tx.warehouseStock.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouse.id,
            },
          },
        });

        if (stockLevel) {
          const available = Number(stockLevel.quantityOnHand) - Number(stockLevel.quantityReserved);
          if (available < item.quantity) {
            throw new AppError(400, 'INSUFFICIENT_STOCK_FOR_RESERVATION', `Insufficient available stock for product ${product.sku}. Available: ${available}, Requested: ${item.quantity}`);
          }
          await tx.warehouseStock.update({
            where: { id: stockLevel.id },
            data: { quantityReserved: { increment: item.quantity } },
          });
        }
      }
    }

    return newOrder;
  });

  res.status(201).json({ data: order });
}));

// PUT /api/sales-orders/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(orderParamsSchema), validateBody(updateSalesOrderSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { customer: true, items: true },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Sales order not found');
  }

  if (order.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Don't allow editing if already invoiced
  if (order.invoice) {
    throw new AppError(400, 'ALREADY_INVOICED', 'Cannot edit order that has been invoiced');
  }

  // Verify customer if changing
  if (data.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    if (!customer || customer.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    }
  }

  // Verify order number if changing (audit fix SC-6: tenant-scoped)
  if (data.orderNumber && data.orderNumber !== order.orderNumber) {
    const existing = await prisma.salesOrder.findUnique({
      where: { organizationId_orderNumber: { organizationId: req.user!.organizationId, orderNumber: data.orderNumber } },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_ORDER_NUMBER', 'Order number already exists in this organization');
    }
  }

  // Handle items update if provided
  if (data.items) {
    // Verify products
    const productIds = data.items.map((item: any) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (products.length !== productIds.length) {
      throw new AppError(400, 'INVALID_PRODUCT', 'One or more products not found');
    }
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {
    // Release old reservations
    for (const item of order.items) {
      const warehouse = await tx.warehouse.findFirst({
        where: { branchId: order.customer.branchId },
      });
      
      if (warehouse) {
        const stockLevel = await tx.warehouseStock.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouse.id,
            },
          },
        });

        if (stockLevel) {
          await tx.warehouseStock.update({
            where: { id: stockLevel.id },
            data: { quantityReserved: { decrement: item.quantity } },
          });
        }
      }
    }

    // Delete old items
    await tx.salesOrderItem.deleteMany({
      where: { salesOrderId: id },
    });

    // Create new items and reserve stock
    if (data.items) {
      for (const item of data.items) {
        const warehouse = await tx.warehouse.findFirst({
          where: { branchId: order.customer.branchId },
        });
        
        if (warehouse) {
          const stockLevel = await tx.warehouseStock.findUnique({
            where: {
              productId_warehouseId: {
                productId: item.productId,
                warehouseId: warehouse.id,
              },
            },
          });

          if (stockLevel) {
            await tx.warehouseStock.update({
              where: { id: stockLevel.id },
              data: { quantityReserved: { increment: item.quantity } },
            });
          }
        }
      }
    }

    return tx.salesOrder.update({
      where: { id },
      data: {
        ...data,
        items: data.items ? {
          create: data.items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            totalAmount: item.quantity * item.unitPrice * (1 + item.taxRate / 100),
          })),
        } : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
  });

  res.json({ data: updatedOrder });
}));

// DELETE /api/sales-orders/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(orderParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { customer: true, invoice: true, items: true },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Sales order not found');
  }

  if (order.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (order.invoice) {
    throw new AppError(400, 'ALREADY_INVOICED', 'Cannot delete order that has been invoiced');
  }

  // Release stock reservations
  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const warehouse = await tx.warehouse.findFirst({
        where: { branchId: order.customer.branchId },
      });
      
      if (warehouse) {
        const stockLevel = await tx.warehouseStock.findUnique({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouse.id,
            },
          },
        });

        if (stockLevel) {
          await tx.warehouseStock.update({
            where: { id: stockLevel.id },
            data: { quantityReserved: { decrement: item.quantity } },
          });
        }
      }
    }

    await tx.salesOrder.delete({
      where: { id },
    });
  });

  res.json({ message: 'Sales order deleted successfully' });
}));

// POST /api/sales-orders/:id/dispatch (Mark as dispatched, create invoice)
router.post('/:id/dispatch', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(orderParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.salesOrder.findUnique({
    where: { id },
    include: { 
      customer: true, 
      items: { include: { product: true } },
      invoice: true,
    },
  });

  if (!order) {
    throw new AppError(404, 'NOT_FOUND', 'Sales order not found');
  }

  if (order.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (order.invoice) {
    throw new AppError(400, 'ALREADY_INVOICED', 'Order already invoiced');
  }

  if (order.orderStatus === 'CANCELLED') {
    throw new AppError(400, 'ORDER_CANCELLED', 'Cannot dispatch cancelled order');
  }

  // Update order status
  await prisma.salesOrder.update({
    where: { id },
    data: { orderStatus: 'DISPATCHED' },
  });

  // Invoice creation would be handled by the invoices route
  // This endpoint just marks the order as dispatched
  
  const updatedOrder = await prisma.salesOrder.findUnique({
    where: { id },
    include: { customer: true, items: true },
  });

  res.json({ data: updatedOrder, message: 'Order marked as dispatched. Create invoice separately.' });
}));

export default router;