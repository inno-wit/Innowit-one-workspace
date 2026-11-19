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
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED']).default('NEW_LEAD'),
  closeOutcome: z.enum(['WON', 'LOST']).optional(),
  winProbability: z.number().int().min(0).max(100).default(20),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  lostReason: z.string().optional(),
  lostNotes: z.string().optional(),
  source: z.string().optional(),
});

const updateDealSchema = createDealSchema.partial();

const dealParamsSchema = z.object({
  id: z.string().uuid('Invalid deal ID'),
});

const DEFAULT_STAGE_PROBABILITIES: Record<string, number> = {
  NEW_LEAD: 20,
  CONTACTED: 40,
  QUALIFIED: 60,
  PROPOSAL: 75,
  NEGOTIATION: 90,
  CLOSED: 0,
};

const stageTransitionSchema = z.object({
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED']),
  closeOutcome: z.enum(['WON', 'LOST']).optional(),
  lostReason: z.string().optional(),
  lostNotes: z.string().optional(),
  reason: z.string().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  version: z.number().int().optional(),
  finalAmount: z.number().nonnegative().optional(),
  generateQuotation: z.boolean().optional(),
}).refine(data => {
  if (data.stage === 'CLOSED' && !data.closeOutcome) {
    return false;
  }
  return true;
}, { message: 'closeOutcome (WON or LOST) is required when stage is CLOSED', path: ['closeOutcome'] })
.refine(data => {
  if (data.stage === 'CLOSED' && data.closeOutcome === 'LOST' && !data.lostReason) {
    return false;
  }
  return true;
}, { message: 'lostReason is required when deal outcome is LOST', path: ['lostReason'] });

const reopenDealSchema = z.object({
  reason: z.string().min(1, 'Reason for reopening deal is required'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED']).optional(),
  closeOutcome: z.enum(['WON', 'LOST']).optional(),
  assignedToId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

// GET /api/deals
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, stage, closeOutcome, assignedToId, customerId, branchId } = req.query as any;
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
  if (closeOutcome) where.closeOutcome = closeOutcome;
  if (branchId) where.customer = { ...where.customer, branchId };

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
        _count: { select: { tasks: true, quotations: true, stageHistory: true } },
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
      organizationId: req.user!.organizationId,
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

// POST /api/deals/:id/stage (Stage transition with audit history & optimistic locking)
router.post('/:id/stage', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(dealParamsSchema), validateBody(stageTransitionSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, organizationId: true } },
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

  // Optimistic concurrency check
  if (data.version !== undefined && deal.version !== data.version) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Deal was modified by another user. Please refresh and try again.');
  }

  // Cannot move out of CLOSED without explicit reopen flow
  if (deal.stage === 'CLOSED' && data.stage !== 'CLOSED') {
    throw new AppError(400, 'DEAL_CLOSED', 'Closed deal cannot be moved back to an open stage without reopening. Use /reopen.');
  }

  let probability = data.probability;
  if (probability === undefined) {
    if (data.stage === 'CLOSED') {
      probability = data.closeOutcome === 'WON' ? 100 : 0;
    } else {
      probability = DEFAULT_STAGE_PROBABILITIES[data.stage] ?? deal.winProbability;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatePayload: any = {
      stage: data.stage,
      winProbability: probability,
      version: { increment: 1 },
    };

    if (data.stage === 'CLOSED') {
      updatePayload.closeOutcome = data.closeOutcome;
      updatePayload.closedAt = deal.closedAt || new Date();
      if (data.closeOutcome === 'LOST') {
        updatePayload.lostReason = data.lostReason;
        updatePayload.lostNotes = data.lostNotes || null;
      } else {
        updatePayload.lostReason = null;
        updatePayload.lostNotes = null;
      }
      if (data.finalAmount !== undefined) {
        updatePayload.value = data.finalAmount;
      }
    } else {
      updatePayload.closeOutcome = null;
      updatePayload.closedAt = null;
      updatePayload.lostReason = null;
      updatePayload.lostNotes = null;
    }

    // Atomic optimistic concurrency update
    if (data.version !== undefined) {
      const updateResult = await tx.deal.updateMany({
        where: { id, version: data.version },
        data: updatePayload,
      });
      if (updateResult.count === 0) {
        throw new AppError(409, 'VERSION_CONFLICT', 'Deal was modified by another user. Please refresh and try again.');
      }
    } else {
      await tx.deal.update({
        where: { id },
        data: updatePayload,
      });
    }

    const updated = await tx.deal.findUniqueOrThrow({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
      },
    });

    // Record stage transition audit in DealStageHistory
    await tx.dealStageHistory.create({
      data: {
        organizationId: req.user!.organizationId,
        dealId: deal.id,
        fromStage: deal.stage,
        toStage: data.stage,
        closeOutcome: data.stage === 'CLOSED' ? data.closeOutcome : null,
        winProbability: probability,
        changedById: req.user!.userId,
        reason: data.reason || data.lostReason || null,
      },
    });

    // Record CRM Activity
    const actType = data.stage === 'CLOSED'
      ? (data.closeOutcome === 'WON' ? 'DEAL_WON' : 'DEAL_LOST')
      : 'STAGE_CHANGE';
    const summary = data.stage === 'CLOSED'
      ? (data.closeOutcome === 'WON'
          ? `Deal won! Amount: KES ${Number(updated.value).toLocaleString()}`
          : `Deal lost. Reason: ${data.lostReason}`)
      : `Deal stage changed from ${deal.stage} to ${data.stage}`;

    await tx.cRMActivity.create({
      data: {
        organizationId: req.user!.organizationId,
        customerId: deal.customerId,
        dealId: deal.id,
        type: actType,
        title: actType === 'DEAL_WON' ? 'Deal Won' : (actType === 'DEAL_LOST' ? 'Deal Lost' : 'Deal Stage Change'),
        description: summary,
        metadataJson: JSON.stringify({
          fromStage: deal.stage,
          toStage: data.stage,
          closeOutcome: data.closeOutcome,
          reason: data.reason || data.lostReason,
        }),
        actorId: req.user!.userId,
      },
    });

    return updated;
  });

  res.json({ data: result });
}));

// POST /api/deals/:id/reopen (Reopen a closed deal with explicit reason)
router.post('/:id/reopen', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(dealParamsSchema), validateBody(reopenDealSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: { customer: { select: { organizationId: true } } },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (deal.stage !== 'CLOSED') {
    throw new AppError(400, 'INVALID_STATE', 'Only closed deals can be reopened');
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.deal.update({
      where: { id },
      data: {
        stage: 'NEGOTIATION',
        closeOutcome: null,
        closedAt: null,
        winProbability: 50,
        reopenedAt: new Date(),
        reopenedById: req.user!.userId,
        reopenReason: reason,
        version: { increment: 1 },
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
      },
    });

    await tx.dealStageHistory.create({
      data: {
        organizationId: req.user!.organizationId,
        dealId: deal.id,
        fromStage: 'CLOSED',
        toStage: 'NEGOTIATION',
        closeOutcome: null,
        winProbability: 50,
        changedById: req.user!.userId,
        reason: `Reopened: ${reason}`,
      },
    });

    await tx.cRMActivity.create({
      data: {
        organizationId: req.user!.organizationId,
        customerId: deal.customerId,
        dealId: deal.id,
        type: 'DEAL_REOPENED',
        title: 'Deal Reopened',
        description: `Deal reopened to NEGOTIATION. Reason: ${reason}`,
        metadataJson: JSON.stringify({ reason }),
        actorId: req.user!.userId,
      },
    });

    return updated;
  });

  res.json({ data: result });
}));

// GET /api/deals/:id/stage-history
router.get('/:id/stage-history', authenticateToken, validateParams(dealParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const deal = await prisma.deal.findUnique({
    where: { id },
    include: { customer: { select: { organizationId: true } } },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const history = await prisma.dealStageHistory.findMany({
    where: { dealId: id },
    orderBy: { createdAt: 'asc' },
    include: {
      changedBy: { select: { id: true, fullName: true, email: true } },
    },
  });

  res.json({ data: history });
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