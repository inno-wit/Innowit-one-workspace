import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createDealSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  assignedToId: z.string().uuid('Invalid assignee ID'),
  title: z.string().min(1, 'Title is required').max(255),
  value: z.number().nonnegative('Value must be non-negative'),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).default('KES'),
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']).default('NEW_LEAD'),
  winProbability: z.number().int().min(0).max(100).default(20),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  lostReason: z.string().optional(),
});

const updateDealSchema = createDealSchema.partial();

const dealParamsSchema = z.object({
  id: z.string().uuid('Invalid deal ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']).optional(),
  assignedToId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

// GET /api/deals
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, stage, assignedToId, customerId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    customer: { organizationId: req.user!.organizationId },
  };

  // Non-managers can only see their own deals
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    where.assignedToId = req.user!.userId;
  } else if (assignedToId) {
    where.assignedToId = assignedToId;
  }

  if (customerId) where.customerId = customerId;
  if (stage) where.stage = stage;

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        _count: { select: { tasks: true, quotations: true } },
      },
    }),
    prisma.deal.count({ where }),
  ]);

  res.json({
    data: deals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/deals/:id
router.get('/:id', authenticateToken, validateParams(dealParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
      tasks: {
        include: {
          assignedTo: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      quotations: {
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { tasks: true, quotations: true } },
    },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role) && deal.assignedToId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: deal });
}));

// POST /api/deals
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(createDealSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify customer belongs to organization
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer || customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  // Verify assignee belongs to organization
  const assignee = await prisma.user.findUnique({
    where: { id: data.assignedToId },
  });

  if (!assignee || assignee.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Assignee not found');
  }

  const deal = await prisma.deal.create({
    data: {
      ...data,
      expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
    },
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
    },
  });

  res.status(201).json({ data: deal });
}));

// PUT /api/deals/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(dealParamsSchema), validateBody(updateDealSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: { customer: true },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role) && deal.assignedToId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Verify assignee if changing
  if (data.assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: data.assignedToId },
    });

    if (!assignee || assignee.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Assignee not found');
    }
  }

  const updateData: any = { ...data };
  if (data.expectedCloseDate) {
    updateData.expectedCloseDate = new Date(data.expectedCloseDate);
  } else if (data.expectedCloseDate === null) {
    updateData.expectedCloseDate = null;
  }

  const updatedDeal = await prisma.deal.update({
    where: { id },
    data: updateData,
    include: {
      customer: { select: { id: true, name: true, customerCode: true } },
      assignedTo: { select: { id: true, fullName: true, email: true } },
    },
  });

  res.json({ data: updatedDeal });
}));

// DELETE /api/deals/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(dealParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      customer: true,
      _count: { select: { tasks: true, quotations: true } },
    },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (deal._count.tasks > 0 || deal._count.quotations > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete deal with existing tasks or quotations');
  }

  await prisma.deal.delete({
    where: { id },
  });

  res.json({ message: 'Deal deleted successfully' });
}));

export default router;