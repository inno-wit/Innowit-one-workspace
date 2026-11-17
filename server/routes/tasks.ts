import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('PENDING'),
  dueDate: z.string().datetime().optional().nullable(),
  assignedToId: z.string().uuid('Invalid assignee ID'),
  customerId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});

const updateTaskSchema = createTaskSchema.partial();

const taskParamsSchema = z.object({
  id: z.string().uuid('Invalid task ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedToId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  overdue: z.coerce.boolean().optional(),
});

// GET /api/tasks
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, status, priority, assignedToId, customerId, dealId, overdue } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {};

  // Non-managers can only see their own tasks
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'HR_MANAGER', 'PROJECT_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    where.assignedToId = req.user!.userId;
  } else if (assignedToId) {
    where.assignedToId = assignedToId;
  }

  if (customerId) where.customerId = customerId;
  if (dealId) where.dealId = dealId;
  if (status) where.status = status;
  if (priority) where.priority = priority;

  if (overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { not: 'COMPLETED' };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Ensure customer/deal belongs to organization
  if (customerId || dealId) {
    // This is handled by the where clause above
  } else {
    // For general task list, filter by organization through customer or deal
    where.OR = [
      { customer: { organizationId: req.user!.organizationId } },
      { deal: { customer: { organizationId: req.user!.organizationId } } },
    ];
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true } },
        customer: { select: { id: true, name: true, customerCode: true } },
        deal: { select: { id: true, title: true, stage: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  res.json({
    data: tasks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/tasks/:id
router.get('/:id', authenticateToken, validateParams(taskParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true } },
      customer: { select: { id: true, name: true, customerCode: true, email: true, phone: true } },
      deal: { select: { id: true, title: true, stage: true, customer: { select: { id: true, name: true } } } },
    },
  });

  if (!task) {
    throw new AppError(404, 'NOT_FOUND', 'Task not found');
  }

  // Check organization access through customer or deal
  const orgId = task.customer?.organizationId || task.deal?.customer.organizationId;
  if (orgId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'HR_MANAGER', 'PROJECT_MANAGER'];
  if (!managerRoles.includes(req.user!.role) && task.assignedToId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: task });
}));

// POST /api/tasks
router.post('/', authenticateToken, validateBody(createTaskSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify assignee belongs to organization
  const assignee = await prisma.user.findUnique({
    where: { id: data.assignedToId },
  });

  if (!assignee || assignee.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Assignee not found');
  }

  // Verify customer if provided
  if (data.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    if (!customer || customer.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    }
  }

  // Verify deal if provided
  if (data.dealId) {
    const deal = await prisma.deal.findUnique({
      where: { id: data.dealId },
      include: { customer: true },
    });

    if (!deal || deal.customer.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Deal not found');
    }
  }

  const task = await prisma.task.create({
    data: {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
    },
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true } },
      customer: { select: { id: true, name: true, customerCode: true } },
      deal: { select: { id: true, title: true, stage: true } },
    },
  });

  res.status(201).json({ data: task });
}));

// PUT /api/tasks/:id
router.put('/:id', authenticateToken, validateParams(taskParamsSchema), validateBody(updateTaskSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      customer: true,
      deal: { include: { customer: true } },
    },
  });

  if (!task) {
    throw new AppError(404, 'NOT_FOUND', 'Task not found');
  }

  const orgId = task.customer?.organizationId || task.deal?.customer.organizationId;
  if (orgId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER', 'HR_MANAGER', 'PROJECT_MANAGER'];
  if (!managerRoles.includes(req.user!.role) && task.assignedToId !== req.user!.userId) {
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
  if (data.dueDate) {
    updateData.dueDate = new Date(data.dueDate);
  } else if (data.dueDate === null) {
    updateData.dueDate = null;
  }

  const updatedTask = await prisma.task.update({
    where: { id },
    data: updateData,
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true } },
      customer: { select: { id: true, name: true, customerCode: true } },
      deal: { select: { id: true, title: true, stage: true } },
    },
  });

  res.json({ data: updatedTask });
}));

// DELETE /api/tasks/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'HR_MANAGER', 'PROJECT_MANAGER'), validateParams(taskParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      customer: true,
      deal: { include: { customer: true } },
    },
  });

  if (!task) {
    throw new AppError(404, 'NOT_FOUND', 'Task not found');
  }

  const orgId = task.customer?.organizationId || task.deal?.customer.organizationId;
  if (orgId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.task.delete({
    where: { id },
  });

  res.json({ message: 'Task deleted successfully' });
}));

export default router;