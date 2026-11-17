import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const quotationItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  taxRate: z.number().nonnegative().default(16),
});

const createQuotationSchema = z.object({
  dealId: z.string().uuid().optional(),
  quotationNumber: z.string().min(1, 'Quotation number is required').max(50),
  validUntil: z.string().datetime(),
  totalAmount: z.number().nonnegative('Total amount must be non-negative'),
  items: z.array(quotationItemSchema).min(1, 'At least one item required'),
});

const updateQuotationSchema = createQuotationSchema.partial();

const quotationParamsSchema = z.object({
  id: z.string().uuid('Invalid quotation ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  dealId: z.string().uuid().optional(),
});

// GET /api/quotations
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, dealId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    deal: { customer: { organizationId: req.user!.organizationId } },
  };

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.deal = { ...where.deal, assignedToId: req.user!.userId };
  }

  if (dealId) where.dealId = dealId;

  if (search) {
    where.OR = [
      { quotationNumber: { contains: search, mode: 'insensitive' } },
      { deal: { title: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [quotations, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        deal: { 
          select: { 
            id: true, 
            title: true, 
            stage: true,
            customer: { select: { id: true, name: true, customerCode: true } }
          } 
        },
        salesOrder: { select: { id: true, orderNumber: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    }),
    prisma.quotation.count({ where }),
  ]);

  res.json({
    data: quotations,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/quotations/:id
router.get('/:id', authenticateToken, validateParams(quotationParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      deal: { 
        include: { 
          customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true } } 
        } 
      },
      salesOrder: { select: { id: true, orderNumber: true, orderStatus: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, taxClassification: true } },
        },
      },
    },
  });

  if (!quotation) {
    throw new AppError(404, 'NOT_FOUND', 'Quotation not found');
  }

  if (quotation.deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && quotation.deal.assignedToId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: quotation });
}));

// POST /api/quotations
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(createQuotationSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify deal if provided
  if (data.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: data.dealId },
      include: { customer: true },
    });

    if (!deal || deal.customer.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Deal not found');
    }

    const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
    if (!crossBranchRoles.includes(req.user!.role) && deal.assignedToId !== req.user!.userId) {
      throw new AppError(403, 'FORBIDDEN', 'Access denied');
    }
  }

  // Verify products
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

  // Check quotation number uniqueness
  const existing = await prisma.quotation.findUnique({
    where: { quotationNumber: data.quotationNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_QUOTATION_NUMBER', 'Quotation number already exists');
  }

  const quotation = await prisma.quotation.create({
    data: {
      ...data,
      validUntil: new Date(data.validUntil),
      items: {
        create: data.items.map((item: any) => ({
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
        })),
      },
    },
    include: {
      deal: { select: { id: true, title: true, customer: { select: { id: true, name: true } } } },
      items: {
        include: { product: { select: { id: true, sku: true, name: true } } },
      },
    },
  });

  res.status(201).json({ data: quotation });
}));

// PUT /api/quotations/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(quotationParamsSchema), validateBody(updateQuotationSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { deal: { include: { customer: true } }, items: true },
  });

  if (!quotation) {
    throw new AppError(404, 'NOT_FOUND', 'Quotation not found');
  }

  if (quotation.deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'FINANCE_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && quotation.deal.assignedToId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Don't allow editing if converted to sales order
  if (quotation.salesOrder) {
    throw new AppError(400, 'ALREADY_CONVERTED', 'Cannot edit quotation converted to sales order');
  }

  // Verify products if items changing
  if (data.items) {
    const productIds = data.items.map((item: any) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (products.length !== productIds.length) {
      throw new AppError(400, 'INVALID_PRODUCT', 'One or more products not found');
    }
  }

  // Check quotation number if changing
  if (data.quotationNumber && data.quotationNumber !== quotation.quotationNumber) {
    const existing = await prisma.quotation.findUnique({
      where: { quotationNumber: data.quotationNumber },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_QUOTATION_NUMBER', 'Quotation number already exists');
    }
  }

  const updatedQuotation = await prisma.$transaction(async (tx) => {
    if (data.items) {
      await tx.quotationItem.deleteMany({
        where: { quotationId: id },
      });

      await tx.quotationItem.createMany({
        data: data.items.map((item: any) => ({
          quotationId: id,
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
        })),
      });
    }

    return tx.quotation.update({
      where: { id },
      data: {
        ...data,
        validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
      },
      include: {
        deal: { select: { id: true, title: true, customer: { select: { id: true, name: true } } } },
        items: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
      },
    });
  });

  res.json({ data: updatedQuotation });
}));

// POST /api/quotations/:id/convert-to-order
router.post('/:id/convert-to-order', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(quotationParamsSchema), validateBody(z.object({
  orderNumber: z.string().min(1).max(50),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { orderNumber } = req.body;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { deal: { include: { customer: true } }, items: { include: { product: true } } },
  });

  if (!quotation) {
    throw new AppError(404, 'NOT_FOUND', 'Quotation not found');
  }

  if (quotation.deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (quotation.salesOrder) {
    throw new AppError(400, 'ALREADY_CONVERTED', 'Quotation already converted to sales order');
  }

  // Check order number uniqueness
  const existing = await prisma.salesOrder.findUnique({
    where: { orderNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_ORDER_NUMBER', 'Order number already exists');
  }

  const order = await prisma.salesOrder.create({
    data: {
      quotationId: id,
      customerId: quotation.deal.customerId,
      orderNumber,
      orderStatus: 'CONFIRMED',
      totalAmount: quotation.totalAmount,
      items: {
        create: quotation.items.map(item => ({
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
        include: { product: { select: { id: true, sku: true, name: true } } },
      },
    },
  });

  res.status(201).json({ data: order, message: 'Sales order created from quotation' });
}));

// DELETE /api/quotations/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(quotationParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { deal: { include: { customer: true } }, salesOrder: true },
  });

  if (!quotation) {
    throw new AppError(404, 'NOT_FOUND', 'Quotation not found');
  }

  if (quotation.deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (quotation.salesOrder) {
    throw new AppError(400, 'ALREADY_CONVERTED', 'Cannot delete quotation converted to sales order');
  }

  await prisma.quotation.delete({ where: { id } });
  res.json({ message: 'Quotation deleted successfully' });
}));

export default router;