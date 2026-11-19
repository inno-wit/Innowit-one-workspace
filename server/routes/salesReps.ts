import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getTenantContext, orgWhereClause } from '../middleware/tenant';

const router = Router();

// Apply authentication and tenant isolation
router.use(authenticateToken);

// ============================================================================
// SCHEMAS
// ============================================================================

const quotaCreateSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
  metric: z.enum(['REVENUE', 'DEALS_WON', 'WEIGHTED_PIPELINE']),
  targetValue: z.number().nonnegative('Target value must be non-negative'),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).default('KES'),
});

const quotaUpdateSchema = quotaCreateSchema.partial();

const quotaParamsSchema = z.object({
  id: z.string().uuid('Invalid quota ID'),
});

const quotaListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  userId: z.string().uuid().optional(),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  metric: z.enum(['REVENUE', 'DEALS_WON', 'WEIGHTED_PIPELINE']).optional(),
  isActive: z.coerce.boolean().optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

const commissionRuleCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional().nullable(),
  isActive: z.boolean().default(true),
  basis: z.enum(['DEAL_VALUE', 'COLLECTED_AMOUNT']),
  rateType: z.enum(['FLAT', 'TIERED']),
  rateValue: z.number().nonnegative('Rate value must be non-negative'),
  tierJson: z.string().optional(),
  eligibleDealStages: z.array(z.string()).default([]),
  excludedDealSources: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
});

const commissionRuleUpdateSchema = commissionRuleCreateSchema.partial();

const commissionRuleParamsSchema = z.object({
  id: z.string().uuid('Invalid commission rule ID'),
});

const commissionRuleListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isActive: z.coerce.boolean().optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
});

const commissionRecordParamsSchema = z.object({
  id: z.string().uuid('Invalid commission record ID'),
});

const commissionRecordListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  ruleId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'PAID', 'CANCELLED']).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

const commissionApproveSchema = z.object({
  commissionRecordIds: z.array(z.string().uuid()).min(1),
});

const salesRepPerformanceQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
});

// ============================================================================
// SALES REP PERFORMANCE
// ============================================================================

// GET /api/sales-reps/performance - Get sales rep performance metrics
router.get('/performance', validateQuery(salesRepPerformanceQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, userId } = req.query as any;
  const tenant = getTenantContext(req);

  // Build where clause for deals
  const dealWhere: any = {
    customer: { organizationId: tenant.organizationId },
  };

  // Non-managers can only see their own performance
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    dealWhere.assignedToId = req.user!.userId;
  } else if (userId) {
    dealWhere.assignedToId = userId;
  }

  // Date filtering on deal closedAt (for won/lost) or expectedCloseDate (for pipeline)
  if (periodStart || periodEnd) {
    const dateFilter: any = {};
    if (periodStart) dateFilter.gte = new Date(periodStart);
    if (periodEnd) dateFilter.lte = new Date(periodEnd);
    
    // Filter by expectedCloseDate for open deals, closedAt for closed deals
    dealWhere.OR = [
      { stage: { not: 'CLOSED' }, expectedCloseDate: dateFilter },
      { stage: 'CLOSED', closedAt: dateFilter },
    ];
  }

  // Get all relevant deals
  const deals = await prisma.deal.findMany({
    where: dealWhere,
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  // Aggregate by sales rep
  const repPerformance = new Map<string, {
    id: string;
    name: string;
    email: string;
    role: string;
    totalDeals: number;
    openDeals: number;
    wonDeals: number;
    lostDeals: number;
    totalPipelineValue: number;
    weightedPipelineValue: number;
    wonRevenue: number;
    lostValue: number;
    avgWinProbability: number;
    avgDealSize: number;
  }>();

  for (const deal of deals) {
    const repId = deal.assignedToId;
    if (!repPerformance.has(repId)) {
      repPerformance.set(repId, {
        id: repId,
        name: deal.assignedTo?.fullName || 'Unknown',
        email: deal.assignedTo?.email || '',
        role: deal.assignedTo?.role || '',
        totalDeals: 0,
        openDeals: 0,
        wonDeals: 0,
        lostDeals: 0,
        totalPipelineValue: 0,
        weightedPipelineValue: 0,
        wonRevenue: 0,
        lostValue: 0,
        avgWinProbability: 0,
        avgDealSize: 0,
      });
    }

    const perf = repPerformance.get(repId)!;
    perf.totalDeals++;

    if (deal.stage === 'CLOSED') {
      if (deal.closeOutcome === 'WON') {
        perf.wonDeals++;
        perf.wonRevenue += Number(deal.value);
      } else if (deal.closeOutcome === 'LOST') {
        perf.lostDeals++;
        perf.lostValue += Number(deal.value);
      }
    } else {
      perf.openDeals++;
      perf.totalPipelineValue += Number(deal.value);
      perf.weightedPipelineValue += Number(deal.value) * (deal.winProbability || 0) / 100;
    }
  }

  // Calculate averages and win rates
  const result = Array.from(repPerformance.values()).map(perf => ({
    ...perf,
    winRate: perf.totalDeals > 0 ? Math.round((perf.wonDeals / perf.totalDeals) * 100) : 0,
    avgWinProbability: perf.totalDeals > 0 ? Math.round(perf.avgWinProbability / perf.totalDeals) : 0,
    avgDealSize: perf.totalDeals > 0 ? Math.round(perf.avgDealSize / perf.totalDeals) : 0,
  }));

  res.json({ data: result });
}));

// GET /api/sales-reps - List eligible sales reps (users with sales roles)
router.get('/', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const tenant = getTenantContext(req);

  const where = orgWhereClause(tenant, {});
  where.role = { in: ['SALES_MANAGER', 'SALES_REP'] };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      avatarUrl: true,
      branchId: true,
      assignedDeals: {
        where: { stage: { not: 'CLOSED' } },
        select: { id: true, value: true, winProbability: true, stage: true },
      },
    },
  });

  const reps = users.map(u => {
    const activeDeals = u.assignedDeals || [];
    const pipelineValue = activeDeals.reduce((sum, d) => sum + Number(d.value), 0);
    const weightedPipeline = activeDeals.reduce((sum, d) => sum + Number(d.value) * (d.winProbability || 0) / 100, 0);

    return {
      id: u.id,
      name: u.fullName,
      email: u.email,
      role: u.role,
      avatar: u.avatarUrl || u.fullName.slice(0, 2).toUpperCase(),
      branchId: u.branchId,
      activeDealsCount: activeDeals.length,
      pipelineValue,
      weightedPipelineValue: weightedPipeline,
    };
  });

  res.json({ data: reps });
}));

// ============================================================================
// QUOTA ENDPOINTS
// ============================================================================

// GET /api/sales-reps/quotas
router.get('/quotas', validateQuery(quotaListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, userId, periodType, metric, isActive, periodStart, periodEnd } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});

  if (userId) where.userId = userId;
  if (periodType) where.periodType = periodType;
  if (metric) where.metric = metric;
  if (isActive !== undefined) where.isActive = isActive;
  if (periodStart) where.periodStart = { gte: new Date(periodStart) };
  if (periodEnd) where.periodEnd = { lte: new Date(periodEnd) };

  // Non-managers can only see their own quotas
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    where.userId = req.user!.userId;
  }

  const [quotas, total] = await Promise.all([
    prisma.salesRepQuota.findMany({
      where,
      skip,
      take: limit,
      orderBy: { periodStart: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    }),
    prisma.salesRepQuota.count({ where }),
  ]);

  // Calculate attainment for each quota
  const quotasWithAttainment = await Promise.all(quotas.map(async (quota) => {
    let attained = 0;
    
    if (quota.metric === 'REVENUE') {
      const deals = await prisma.deal.findMany({
        where: {
          assignedToId: quota.userId,
          stage: 'CLOSED',
          closeOutcome: 'WON',
          closedAt: { gte: quota.periodStart, lte: quota.periodEnd },
        },
      });
      attained = deals.reduce((sum, d) => sum + Number(d.value), 0);
    } else if (quota.metric === 'DEALS_WON') {
      attained = await prisma.deal.count({
        where: {
          assignedToId: quota.userId,
          stage: 'CLOSED',
          closeOutcome: 'WON',
          closedAt: { gte: quota.periodStart, lte: quota.periodEnd },
        },
      });
    } else if (quota.metric === 'WEIGHTED_PIPELINE') {
      const deals = await prisma.deal.findMany({
        where: {
          assignedToId: quota.userId,
          stage: { not: 'CLOSED' },
          expectedCloseDate: { gte: quota.periodStart, lte: quota.periodEnd },
        },
      });
      attained = deals.reduce((sum, d) => sum + Number(d.value) * (d.winProbability || 0) / 100, 0);
    }

    const attainmentPct = quota.targetValue > 0 ? (attained / Number(quota.targetValue)) * 100 : 0;

    return {
      ...quota,
      attainedValue: attained,
      attainmentPct: Math.round(attainmentPct * 100) / 100,
    };
  }));

  res.json({
    data: quotasWithAttainment,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/sales-reps/quotas/:id
router.get('/quotas/:id', validateParams(quotaParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const quota = await prisma.salesRepQuota.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  if (!quota) {
    throw new AppError(404, 'NOT_FOUND', 'Quota not found');
  }

  // Verify organization access
  if (quota.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: quota });
}));

// POST /api/sales-reps/quotas
router.post('/quotas', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateBody(quotaCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify user exists and belongs to organization
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  // Verify user has sales role
  if (!['SALES_MANAGER', 'SALES_REP'].includes(user.role)) {
    throw new AppError(400, 'INVALID_ROLE', 'User must have SALES_MANAGER or SALES_REP role');
  }

  // Check for overlapping quotas
  const existing = await prisma.salesRepQuota.findFirst({
    where: {
      organizationId: req.user!.organizationId,
      userId: data.userId,
      periodType: data.periodType,
      metric: data.metric,
      periodStart: { lte: new Date(data.periodEnd) },
      periodEnd: { gte: new Date(data.periodStart) },
    },
  });

  if (existing) {
    throw new AppError(409, 'OVERLAPPING_QUOTA', 'Overlapping quota exists for this user, period, and metric');
  }

  const quota = await prisma.salesRepQuota.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      periodStart: new Date(data.periodStart),
      periodEnd: new Date(data.periodEnd),
    },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  res.status(201).json({ data: quota });
}));

// PUT /api/sales-reps/quotas/:id
router.put('/quotas/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(quotaParamsSchema), validateBody(quotaUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const quota = await prisma.salesRepQuota.findUnique({
    where: { id },
  });

  if (!quota) {
    throw new AppError(404, 'NOT_FOUND', 'Quota not found');
  }

  if (quota.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const updateData: any = { ...data };
  if (data.periodStart) updateData.periodStart = new Date(data.periodStart);
  if (data.periodEnd) updateData.periodEnd = new Date(data.periodEnd);

  const updatedQuota = await prisma.salesRepQuota.update({
    where: { id },
    data: updateData,
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  res.json({ data: updatedQuota });
}));

// DELETE /api/sales-reps/quotas/:id
router.delete('/quotas/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(quotaParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const quota = await prisma.salesRepQuota.findUnique({
    where: { id },
  });

  if (!quota) {
    throw new AppError(404, 'NOT_FOUND', 'Quota not found');
  }

  if (quota.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.salesRepQuota.delete({ where: { id } });
  res.json({ message: 'Quota deleted successfully' });
}));

// ============================================================================
// COMMISSION RULE ENDPOINTS
// ============================================================================

// GET /api/sales-reps/commission-rules
router.get('/commission-rules', validateQuery(commissionRuleListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, isActive, effectiveFrom, effectiveTo } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (isActive !== undefined) where.isActive = isActive;
  if (effectiveFrom) where.effectiveFrom = { gte: new Date(effectiveFrom) };
  if (effectiveTo) where.effectiveTo = { lte: new Date(effectiveTo) };

  const [rules, total] = await Promise.all([
    prisma.commissionRule.findMany({
      where,
      skip,
      take: limit,
      orderBy: { effectiveFrom: 'desc' },
    }),
    prisma.commissionRule.count({ where }),
  ]);

  res.json({
    data: rules,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/sales-reps/commission-rules/:id
router.get('/commission-rules/:id', validateParams(commissionRuleParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const rule = await prisma.commissionRule.findUnique({
    where: { id },
    include: {
      commissionRecords: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          deal: { select: { id: true, title: true, value: true } },
          user: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Commission rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: rule });
}));

// POST /api/sales-reps/commission-rules
router.post('/commission-rules', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateBody(commissionRuleCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const rule = await prisma.commissionRule.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
    },
  });

  res.status(201).json({ data: rule });
}));

// PUT /api/sales-reps/commission-rules/:id
router.put('/commission-rules/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(commissionRuleParamsSchema), validateBody(commissionRuleUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const rule = await prisma.commissionRule.findUnique({
    where: { id },
  });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Commission rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const updateData: any = { ...data };
  if (data.effectiveFrom) updateData.effectiveFrom = new Date(data.effectiveFrom);
  if (data.effectiveTo) updateData.effectiveTo = new Date(data.effectiveTo);
  else if (data.effectiveTo === null) updateData.effectiveTo = null;

  const updatedRule = await prisma.commissionRule.update({
    where: { id },
    data: updateData,
  });

  res.json({ data: updatedRule });
}));

// DELETE /api/sales-reps/commission-rules/:id
router.delete('/commission-rules/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(commissionRuleParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const rule = await prisma.commissionRule.findUnique({
    where: { id },
  });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Commission rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check if rule has commission records
  const recordCount = await prisma.commissionRecord.count({ where: { ruleId: id } });
  if (recordCount > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete rule with existing commission records');
  }

  await prisma.commissionRule.delete({ where: { id } });
  res.json({ message: 'Commission rule deleted successfully' });
}));

// ============================================================================
// COMMISSION RECORD ENDPOINTS
// ============================================================================

// GET /api/sales-reps/commission-records
router.get('/commission-records', validateQuery(commissionRecordListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, ruleId, dealId, userId, status, periodStart, periodEnd } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (ruleId) where.ruleId = ruleId;
  if (dealId) where.dealId = dealId;
  if (userId) where.userId = userId;
  if (status) where.status = status;
  if (periodStart) where.createdAt = { ...where.createdAt, gte: new Date(periodStart) };
  if (periodEnd) where.createdAt = { ...where.createdAt, lte: new Date(periodEnd) };

  // Non-managers can only see their own commissions
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    where.userId = req.user!.userId;
  }

  const [records, total] = await Promise.all([
    prisma.commissionRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        rule: { select: { id: true, name: true, rateType: true, rateValue: true } },
        deal: { select: { id: true, title: true, value: true, stage: true, closeOutcome: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.commissionRecord.count({ where }),
  ]);

  res.json({
    data: records,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/sales-reps/commission-records/:id
router.get('/commission-records/:id', validateParams(commissionRecordParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const record = await prisma.commissionRecord.findUnique({
    where: { id },
    include: {
      rule: true,
      deal: { include: { customer: { select: { id: true, name: true } } } },
      user: { select: { id: true, fullName: true, email: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
  });

  if (!record) {
    throw new AppError(404, 'NOT_FOUND', 'Commission record not found');
  }

  if (record.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role) && record.userId !== req.user!.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: record });
}));

// POST /api/sales-reps/commission-records/calculate - Calculate commission for a won deal
router.post('/commission-records/calculate', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateBody(z.object({
  dealId: z.string().uuid(),
  ruleId: z.string().uuid().optional(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { dealId, ruleId } = req.body;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { customer: true, assignedTo: true },
  });

  if (!deal) {
    throw new AppError(404, 'NOT_FOUND', 'Deal not found');
  }

  if (deal.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (deal.stage !== 'CLOSED' || deal.closeOutcome !== 'WON') {
    throw new AppError(400, 'DEAL_NOT_WON', 'Can only calculate commission for Closed Won deals');
  }

  // Find applicable rule
  let rule: any;
  if (ruleId) {
    rule = await prisma.commissionRule.findUnique({ where: { id: ruleId } });
    if (!rule || rule.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Commission rule not found');
    }
  } else {
    // Find first matching active rule
    const rules = await prisma.commissionRule.findMany({
      where: {
        organizationId: req.user!.organizationId,
        isActive: true,
        effectiveFrom: { lte: deal.closedAt || new Date() },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: deal.closedAt || new Date() } },
        ],
        eligibleDealStages: { has: deal.stage },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    rule = rules.find(r => {
      if (r.excludedDealSources?.includes(deal.source || '')) return false;
      return true;
    });

    if (!rule) {
      throw new AppError(404, 'NO_APPLICABLE_RULE', 'No applicable commission rule found for this deal');
    }
  }

  // Calculate commission
  let basisAmount = 0;
  if (rule.basis === 'DEAL_VALUE') {
    basisAmount = Number(deal.value);
  } else if (rule.basis === 'COLLECTED_AMOUNT') {
    // Would need to check payments - for now use deal value
    basisAmount = Number(deal.value);
  }

  let commissionAmount = 0;
  let rateApplied = Number(rule.rateValue);

  if (rule.rateType === 'FLAT') {
    commissionAmount = basisAmount * rateApplied / 100;
  } else if (rule.rateType === 'TIERED' && rule.tierJson) {
    try {
      const tiers = JSON.parse(rule.tierJson);
      for (const tier of tiers) {
        if (basisAmount >= tier.min && (tier.max === null || basisAmount <= tier.max)) {
          rateApplied = tier.rate;
          commissionAmount = basisAmount * tier.rate / 100;
          break;
        }
      }
    } catch {
      commissionAmount = basisAmount * rateApplied / 100;
    }
  }

  // Check for existing commission record (idempotency)
  const calculationKey = `comm_${dealId}_${rule.id}_${rule.effectiveFrom.getTime()}`;
  const existing = await prisma.commissionRecord.findUnique({
    where: { calculationKey },
  });

  if (existing) {
    return res.json({ data: existing, message: 'Commission already calculated for this deal and rule' });
  }

  const commissionRecord = await prisma.$transaction(async (tx) => {
    const record = await tx.commissionRecord.create({
      data: {
        organizationId: req.user!.organizationId,
        ruleId: rule.id,
        dealId: deal.id,
        userId: deal.assignedToId,
        amount: commissionAmount,
        currency: deal.currency,
        basisAmount,
        rateApplied,
        status: rule.requiresApproval ? 'PENDING' : 'APPROVED',
        calculationKey,
        approvedAt: rule.requiresApproval ? null : new Date(),
        approvedById: rule.requiresApproval ? null : req.user!.userId,
      },
      include: {
        rule: { select: { id: true, name: true, rateType: true, rateValue: true } },
        deal: { select: { id: true, title: true, value: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    // Create activity log
    await tx.cRMActivity.create({
      data: {
        organizationId: req.user!.organizationId,
        customerId: deal.customerId,
        dealId: deal.id,
        type: 'NOTE',
        title: 'Commission Calculated',
        description: `Commission of ${deal.currency} ${commissionAmount.toLocaleString()} calculated for deal "${deal.title}" for ${deal.assignedTo?.fullName}.`,
        actorId: req.user!.userId,
        occurredAt: new Date(),
      },
    });

    return record;
  });

  res.status(201).json({ data: commissionRecord, message: 'Commission calculated successfully' });
}));

// POST /api/sales-reps/commission-records/approve - Bulk approve commissions
router.post('/commission-records/approve', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateBody(commissionApproveSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { commissionRecordIds } = req.body;

  const records = await prisma.commissionRecord.findMany({
    where: {
      id: { in: commissionRecordIds },
      organizationId: req.user!.organizationId,
      status: 'PENDING',
    },
  });

  if (records.length !== commissionRecordIds.length) {
    throw new AppError(400, 'INVALID_RECORDS', 'Some commission records not found, not pending, or access denied');
  }

  const updated = await prisma.commissionRecord.updateMany({
    where: { id: { in: commissionRecordIds } },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedById: req.user!.userId,
    },
  });

  res.json({ data: { approved: updated.count }, message: `${updated.count} commission records approved` });
}));

export default router;