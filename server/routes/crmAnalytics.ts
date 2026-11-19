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

const analyticsQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  dateRange: z.enum(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'YTD', 'CUSTOM']).optional(),
  branchId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).optional(),
});

const pipelineQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  branchId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  stage: z.enum(['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED']).optional(),
  currency: z.enum(['KES', 'USD', 'EUR', 'GBP']).optional(),
});

const repPerformanceQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  branchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDateRange(range: string, customStart?: string, customEnd?: string): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start = new Date(now);

  switch (range) {
    case 'TODAY':
      start.setHours(0, 0, 0, 0);
      break;
    case 'WEEK':
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case 'MONTH':
      start.setMonth(now.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'QUARTER':
      start.setMonth(now.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
      break;
    case 'YTD':
      start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'CUSTOM':
      if (customStart) start = new Date(customStart);
      if (customEnd) end.setTime(new Date(customEnd).getTime());
      break;
  }

  return { start, end };
}

function calculateCurrencyRates(deals: any[], baseCurrency: string): Map<string, number> {
  // For now, return 1:1 rates. In production, integrate with exchange rate API
  const rates = new Map<string, number>();
  for (const deal of deals) {
    if (deal.currency !== baseCurrency && !rates.has(deal.currency)) {
      rates.set(deal.currency, 1);
    }
  }
  rates.set(baseCurrency, 1);
  return rates;
}

// ============================================================================
// CRM DASHBOARD METRICS
// ============================================================================

// GET /api/crm/analytics/dashboard - Main dashboard metrics
router.get('/dashboard', validateQuery(analyticsQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, dateRange, branchId, ownerId, currency = 'KES' } = req.query as any;
  const tenant = getTenantContext(req);

  const { start, end } = dateRange ? getDateRange(dateRange, periodStart, periodEnd) : getDateRange('MONTH', periodStart, periodEnd);

  const where: any = {
    customer: { organizationId: tenant.organizationId },
  };

  // Apply branch filter
  if (branchId) {
    where.customer = { ...where.customer, branchId };
  } else if (!['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'].includes(req.user!.role) && tenant.branchId) {
    where.customer = { ...where.customer, branchId: tenant.branchId };
  }

  // Apply owner filter
  if (ownerId) where.assignedToId = ownerId;

  // Get all deals for the period
  const deals = await prisma.deal.findMany({
    where: {
      ...where,
      OR: [
        { stage: { not: 'CLOSED' }, expectedCloseDate: { gte: start, lte: end } },
        { stage: 'CLOSED', closedAt: { gte: start, lte: end } },
      ],
    },
    include: {
      customer: { select: { id: true, name: true, branchId: true } },
      assignedTo: { select: { id: true, fullName: true } },
    },
  });

  // Categorize deals
  const openDeals = deals.filter(d => d.stage !== 'CLOSED');
  const closedDeals = deals.filter(d => d.stage === 'CLOSED');
  const wonDeals = closedDeals.filter(d => d.closeOutcome === 'WON');
  const lostDeals = closedDeals.filter(d => d.closeOutcome === 'LOST');

  // Calculate metrics
  const totalPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value), 0);
  const weightedPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value) * (d.winProbability || 0) / 100, 0);
  const wonRevenue = wonDeals.reduce((sum, d) => sum + Number(d.value), 0);
  const lostValue = lostDeals.reduce((sum, d) => sum + Number(d.value), 0);

  // Deal counts by stage
  const dealsByStage = {
    NEW_LEAD: deals.filter(d => d.stage === 'NEW_LEAD').length,
    CONTACTED: deals.filter(d => d.stage === 'CONTACTED').length,
    QUALIFIED: deals.filter(d => d.stage === 'QUALIFIED').length,
    PROPOSAL: deals.filter(d => d.stage === 'PROPOSAL').length,
    NEGOTIATION: deals.filter(d => d.stage === 'NEGOTIATION').length,
    CLOSED: closedDeals.length,
  };

  // Win rate
  const totalDecided = wonDeals.length + lostDeals.length;
  const winRate = totalDecided > 0 ? (wonDeals.length / totalDecided) * 100 : 0;

  // Average deal size
  const avgDealSize = deals.length > 0 ? deals.reduce((sum, d) => sum + Number(d.value), 0) / deals.length : 0;

  // Average sales cycle (for won deals)
  let avgSalesCycleDays = 0;
  if (wonDeals.length > 0) {
    const totalDays = wonDeals.reduce((sum, d) => {
      const created = new Date(d.createdAt).getTime();
      const closed = d.closedAt ? new Date(d.closedAt).getTime() : new Date(d.updatedAt).getTime();
      return sum + (closed - created) / (1000 * 60 * 60 * 24);
    }, 0);
    avgSalesCycleDays = Math.round(totalDays / wonDeals.length);
  }

  // New leads in period
  const newLeads = deals.filter(d => 
    d.stage === 'NEW_LEAD' || (d.stage !== 'CLOSED' && new Date(d.createdAt) >= start)
  ).length;

  // Conversion velocity (leads to qualified)
  const qualifiedDeals = deals.filter(d => 
    ['QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED'].includes(d.stage) && 
    new Date(d.createdAt) >= start
  ).length;
  const conversionVelocity = newLeads > 0 ? (qualifiedDeals / newLeads) * 100 : 0;

  res.json({
    data: {
      period: { start: start.toISOString(), end: end.toISOString() },
      currency,
      metrics: {
        // Pipeline metrics
        totalPipelineValue: Math.round(totalPipelineValue),
        weightedPipelineValue: Math.round(weightedPipelineValue),
        wonRevenue: Math.round(wonRevenue),
        lostValue: Math.round(lostValue),
        
        // Deal counts
        totalDeals: deals.length,
        openDeals: openDeals.length,
        wonDeals: wonDeals.length,
        lostDeals: lostDeals.length,
        newLeads,
        
        // Stage breakdown
        dealsByStage,
        
        // Rates
        winRate: Math.round(winRate * 100) / 100,
        conversionVelocity: Math.round(conversionVelocity * 100) / 100,
        
        // Averages
        avgDealSize: Math.round(avgDealSize),
        avgSalesCycleDays,
        
        // CAC (if marketing spend data available)
        cac: {
          value: null,
          status: 'NOT_CONFIGURED',
          message: 'Marketing spend attribution not configured',
        },
      },
    },
  });
}));

// ============================================================================
// PIPELINE ANALYTICS
// ============================================================================

// GET /api/crm/analytics/pipeline - Detailed pipeline analysis
router.get('/pipeline', validateQuery(pipelineQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, branchId, ownerId, stage, currency = 'KES' } = req.query as any;
  const tenant = getTenantContext(req);

  const where: any = {
    customer: { organizationId: tenant.organizationId },
  };

  if (branchId) where.customer = { ...where.customer, branchId };
  else if (!['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'].includes(req.user!.role) && tenant.branchId) {
    where.customer = { ...where.customer, branchId: tenant.branchId };
  }
  if (ownerId) where.assignedToId = ownerId;
  if (stage) where.stage = stage;

  const deals = await prisma.deal.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, branchId: true } },
      assignedTo: { select: { id: true, fullName: true } },
    },
  });

  // Group by stage
  const stages = ['NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED'] as const;
  const stageLabels = {
    NEW_LEAD: 'New Lead',
    CONTACTED: 'Contacted',
    QUALIFIED: 'Qualified',
    PROPOSAL: 'Proposal',
    NEGOTIATION: 'Negotiation',
    CLOSED: 'Closed',
  };
  const defaultProbs = {
    NEW_LEAD: 20,
    CONTACTED: 40,
    QUALIFIED: 60,
    PROPOSAL: 75,
    NEGOTIATION: 90,
    CLOSED: 100,
  };

  const pipelineByStage = stages.map(stageKey => {
    const stageDeals = deals.filter(d => d.stage === stageKey);
    const isClosed = stageKey === 'CLOSED';
    const wonDeals = isClosed ? stageDeals.filter(d => d.closeOutcome === 'WON') : [];
    const lostDeals = isClosed ? stageDeals.filter(d => d.closeOutcome === 'LOST') : [];
    
    const value = stageDeals.reduce((sum, d) => sum + Number(d.value), 0);
    const weightedValue = isClosed ? wonDeals.reduce((sum, d) => sum + Number(d.value), 0) : 
      stageDeals.reduce((sum, d) => sum + Number(d.value) * (d.winProbability || defaultProbs[stageKey]) / 100, 0);

    return {
      stage: stageKey,
      label: stageLabels[stageKey],
      count: stageDeals.length,
      value: Math.round(value),
      weightedValue: Math.round(weightedValue),
      probability: defaultProbs[stageKey],
      wonCount: wonDeals.length,
      lostCount: lostDeals.length,
      avgWinProbability: stageDeals.length > 0 ? Math.round(stageDeals.reduce((sum, d) => sum + (d.winProbability || 0), 0) / stageDeals.length) : defaultProbs[stageKey],
      avgDealSize: stageDeals.length > 0 ? Math.round(value / stageDeals.length) : 0,
    };
  });

  // Expected closes by month
  const openDeals = deals.filter(d => d.stage !== 'CLOSED');
  const expectedCloses = new Map<string, { count: number; value: number }>();
  
  for (const deal of openDeals) {
    if (deal.expectedCloseDate) {
      const monthKey = new Date(deal.expectedCloseDate).toISOString().slice(0, 7); // YYYY-MM
      const existing = expectedCloses.get(monthKey) || { count: 0, value: 0 };
      existing.count++;
      existing.value += Number(deal.value);
      expectedCloses.set(monthKey, existing);
    }
  }

  const expectedClosesArray = Array.from(expectedCloses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      expectedCount: data.count,
      expectedValue: Math.round(data.value),
    }));

  // Aging analysis
  const now = new Date();
  const aging = {
    under30: { count: 0, value: 0 },
    '30-60': { count: 0, value: 0 },
    '60-90': { count: 0, value: 0 },
    '90+': { count: 0, value: 0 },
  };

  for (const deal of openDeals) {
    if (deal.expectedCloseDate) {
      const daysUntilClose = Math.ceil((new Date(deal.expectedCloseDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilClose <= 30) {
        aging.under30.count++;
        aging.under30.value += Number(deal.value);
      } else if (daysUntilClose <= 60) {
        aging['30-60'].count++;
        aging['30-60'].value += Number(deal.value);
      } else if (daysUntilClose <= 90) {
        aging['60-90'].count++;
        aging['60-90'].value += Number(deal.value);
      } else {
        aging['90+'].count++;
        aging['90+'].value += Number(deal.value);
      }
    }
  }

  // Currency breakdown
  const currencyBreakdown = new Map<string, { count: number; value: number; weightedValue: number }>();
  for (const deal of deals) {
    const existing = currencyBreakdown.get(deal.currency) || { count: 0, value: 0, weightedValue: 0 };
    existing.count++;
    existing.value += Number(deal.value);
    if (deal.stage !== 'CLOSED') {
      existing.weightedValue += Number(deal.value) * (deal.winProbability || 0) / 100;
    } else if (deal.closeOutcome === 'WON') {
      existing.weightedValue += Number(deal.value);
    }
    currencyBreakdown.set(deal.currency, existing);
  }

  const currencyArray = Array.from(currencyBreakdown.entries()).map(([currency, data]) => ({
    currency,
    count: data.count,
    value: Math.round(data.value),
    weightedValue: Math.round(data.weightedValue),
  }));

  res.json({
    data: {
      pipelineByStage,
      expectedCloses: expectedClosesArray,
      aging: {
        under30: { count: aging.under30.count, value: Math.round(aging.under30.value) },
        '30-60': { count: aging['30-60'].count, value: Math.round(aging['30-60'].value) },
        '60-90': { count: aging['60-90'].count, value: Math.round(aging['60-90'].value) },
        '90+': { count: aging['90+'].count, value: Math.round(aging['90+'].value) },
      },
      currencyBreakdown: currencyArray,
      totalDeals: deals.length,
      totalValue: Math.round(deals.reduce((sum, d) => sum + Number(d.value), 0)),
    },
  });
}));

// ============================================================================
// REP PERFORMANCE ANALYTICS
// ============================================================================

// GET /api/crm/analytics/rep-performance - Sales rep performance metrics
router.get('/rep-performance', validateQuery(repPerformanceQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, branchId, userId } = req.query as any;
  const tenant = getTenantContext(req);

  const where: any = {
    customer: { organizationId: tenant.organizationId },
  };

  if (branchId) where.customer = { ...where.customer, branchId };
  if (userId) where.assignedToId = userId;
  else if (!['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'].includes(req.user!.role)) {
    where.assignedToId = req.user!.userId;
  }

  const deals = await prisma.deal.findMany({
    where: {
      ...where,
      OR: periodStart || periodEnd ? [
        { stage: { not: 'CLOSED' }, expectedCloseDate: { 
          ...(periodStart && { gte: new Date(periodStart) }),
          ...(periodEnd && { lte: new Date(periodEnd) }),
        }},
        { stage: 'CLOSED', closedAt: { 
          ...(periodStart && { gte: new Date(periodStart) }),
          ...(periodEnd && { lte: new Date(periodEnd) }),
        }},
      ] : undefined,
    },
    include: {
      assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  // Aggregate by rep
  const repMap = new Map<string, {
    id: string;
    name: string;
    email: string;
    role: string;
    deals: typeof deals;
  }>();

  for (const deal of deals) {
    const repId = deal.assignedToId;
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        id: repId,
        name: deal.assignedTo?.fullName || 'Unknown',
        email: deal.assignedTo?.email || '',
        role: deal.assignedTo?.role || '',
        deals: [],
      });
    }
    repMap.get(repId)!.deals.push(deal);
  }

  const repPerformance = Array.from(repMap.values()).map(rep => {
    const openDeals = rep.deals.filter(d => d.stage !== 'CLOSED');
    const closedDeals = rep.deals.filter(d => d.stage === 'CLOSED');
    const wonDeals = closedDeals.filter(d => d.closeOutcome === 'WON');
    const lostDeals = closedDeals.filter(d => d.closeOutcome === 'LOST');

    const totalPipeline = openDeals.reduce((sum, d) => sum + Number(d.value), 0);
    const weightedPipeline = openDeals.reduce((sum, d) => sum + Number(d.value) * (d.winProbability || 0) / 100, 0);
    const wonRevenue = wonDeals.reduce((sum, d) => sum + Number(d.value), 0);
    const lostValue = lostDeals.reduce((sum, d) => sum + Number(d.value), 0);

    const totalDecided = wonDeals.length + lostDeals.length;
    const winRate = totalDecided > 0 ? (wonDeals.length / totalDecided) * 100 : 0;

    // Average sales cycle for won deals
    let avgSalesCycle = 0;
    if (wonDeals.length > 0) {
      const totalDays = wonDeals.reduce((sum, d) => {
        const created = new Date(d.createdAt).getTime();
        const closed = d.closedAt ? new Date(d.closedAt).getTime() : new Date(d.updatedAt).getTime();
        return sum + (closed - created) / (1000 * 60 * 60 * 24);
      }, 0);
      avgSalesCycle = Math.round(totalDays / wonDeals.length);
    }

    // Quota attainment (if quota exists)
    let quotaAttainment = null;
    // Could fetch quota and calculate here

    return {
      id: rep.id,
      name: rep.name,
      email: rep.email,
      role: rep.role,
      metrics: {
        totalDeals: rep.deals.length,
        openDeals: openDeals.length,
        wonDeals: wonDeals.length,
        lostDeals: lostDeals.length,
        totalPipelineValue: Math.round(totalPipeline),
        weightedPipelineValue: Math.round(weightedPipeline),
        wonRevenue: Math.round(wonRevenue),
        lostValue: Math.round(lostValue),
        winRate: Math.round(winRate * 100) / 100,
        avgDealSize: rep.deals.length > 0 ? Math.round(rep.deals.reduce((sum, d) => sum + Number(d.value), 0) / rep.deals.length) : 0,
        avgSalesCycle,
        quotaAttainment,
      },
    };
  });

  res.json({
    data: repPerformance,
  });
}));

// ============================================================================
// CUSTOMER ANALYTICS
// ============================================================================

// GET /api/crm/analytics/customers - Customer metrics
router.get('/customers', validateQuery(analyticsQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, dateRange, branchId, currency = 'KES' } = req.query as any;
  const tenant = getTenantContext(req);

  const { start, end } = dateRange ? getDateRange(dateRange, periodStart, periodEnd) : getDateRange('MONTH', periodStart, periodEnd);

  const where: any = {
    organizationId: tenant.organizationId,
  };

  if (branchId) where.branchId = branchId;
  else if (!['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'].includes(req.user!.role) && tenant.branchId) {
    where.branchId = tenant.branchId;
  }

  const customers = await prisma.customer.findMany({
    where,
    include: {
      deals: {
        where: {
          OR: [
            { stage: { not: 'CLOSED' }, expectedCloseDate: { gte: start, lte: end } },
            { stage: 'CLOSED', closedAt: { gte: start, lte: end } },
          ],
        },
        include: { assignedTo: { select: { id: true, fullName: true } } },
      },
      invoices: {
        where: { invoiceDate: { gte: start, lte: end } },
      },
    },
  });

  const activeCustomers = customers.filter(c => c.lifecycle === 'ACTIVE');
  const leadCustomers = customers.filter(c => c.lifecycle === 'LEAD');
  const inactiveCustomers = customers.filter(c => c.lifecycle === 'INACTIVE');

  const newCustomers = customers.filter(c => new Date(c.createdAt) >= start);
  const churnedCustomers = customers.filter(c => c.lifecycle === 'INACTIVE' && c.updatedAt && new Date(c.updatedAt) >= start);

  // Customer metrics
  const totalRevenue = customers.reduce((sum, c) => sum + c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0), 0);
  const avgRevenuePerCustomer = customers.length > 0 ? totalRevenue / customers.length : 0;

  // Top customers by revenue
  const topCustomers = customers
    .map(c => ({
      id: c.id,
      name: c.name,
      customerCode: c.customerCode,
      lifecycle: c.lifecycle,
      dealCount: c.deals.length,
      totalRevenue: Math.round(c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0)),
      pipelineValue: Math.round(c.deals.filter(d => d.stage !== 'CLOSED').reduce((s, d) => s + Number(d.value), 0)),
      weightedPipeline: Math.round(c.deals.filter(d => d.stage !== 'CLOSED').reduce((s, d) => s + Number(d.value) * (d.winProbability || 0) / 100, 0)),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10);

  // Revenue by lifecycle
  const revenueByLifecycle = {
    LEAD: Math.round(leadCustomers.reduce((sum, c) => sum + c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0), 0)),
    ACTIVE: Math.round(activeCustomers.reduce((sum, c) => sum + c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0), 0)),
    INACTIVE: Math.round(inactiveCustomers.reduce((sum, c) => sum + c.invoices.reduce((s, i) => s + Number(i.totalAmount), 0), 0)),
  };

  res.json({
    data: {
      period: { start: start.toISOString(), end: end.toISOString() },
      currency,
      summary: {
        totalCustomers: customers.length,
        activeCustomers: activeCustomers.length,
        leadCustomers: leadCustomers.length,
        inactiveCustomers: inactiveCustomers.length,
        newCustomers: newCustomers.length,
        churnedCustomers: churnedCustomers.length,
        totalRevenue: Math.round(totalRevenue),
        avgRevenuePerCustomer: Math.round(avgRevenuePerCustomer),
      },
      revenueByLifecycle,
      topCustomers,
    },
  });
}));

// ============================================================================
// ACTIVITY ANALYTICS
// ============================================================================

// GET /api/crm/analytics/activities - Activity metrics
router.get('/activities', validateQuery(analyticsQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { periodStart, periodEnd, dateRange, branchId } = req.query as any;
  const tenant = getTenantContext(req);

  const { start, end } = dateRange ? getDateRange(dateRange, periodStart, periodEnd) : getDateRange('MONTH', periodStart, periodEnd);

  const where: any = {
    organizationId: tenant.organizationId,
    occurredAt: { gte: start, lte: end },
  };

  // Apply branch filter through customer
  if (branchId) {
    const customerIds = await prisma.customer.findMany({
      where: { branchId },
      select: { id: true },
    });
    where.customerId = { in: customerIds.map(c => c.id) };
  } else if (!['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'].includes(req.user!.role) && tenant.branchId) {
    const customerIds = await prisma.customer.findMany({
      where: { branchId: tenant.branchId },
      select: { id: true },
    });
    where.customerId = { in: customerIds.map(c => c.id) };
  }

  const activities = await prisma.cRMActivity.findMany({
    where,
    include: {
      actor: { select: { id: true, fullName: true } },
      deal: { select: { id: true, title: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  // Activity breakdown by type
  const typeBreakdown = new Map<string, number>();
  for (const act of activities) {
    typeBreakdown.set(act.type, (typeBreakdown.get(act.type) || 0) + 1);
  }

  // Activities by user
  const userBreakdown = new Map<string, { name: string; count: number }>();
  for (const act of activities) {
    const key = act.actorId;
    const existing = userBreakdown.get(key) || { name: act.actor?.fullName || 'Unknown', count: 0 };
    existing.count++;
    userBreakdown.set(key, existing);
  }

  // Activities by day
  const dailyBreakdown = new Map<string, number>();
  for (const act of activities) {
    const dayKey = new Date(act.occurredAt).toISOString().slice(0, 10);
    dailyBreakdown.set(dayKey, (dailyBreakdown.get(dayKey) || 0) + 1);
  }

  res.json({
    data: {
      period: { start: start.toISOString(), end: end.toISOString() },
      totalActivities: activities.length,
      typeBreakdown: Array.from(typeBreakdown.entries()).map(([type, count]) => ({ type, count })),
      userBreakdown: Array.from(userBreakdown.entries()).map(([userId, data]) => ({ userId, ...data })).sort((a, b) => b.count - a.count),
      dailyBreakdown: Array.from(dailyBreakdown.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    },
  });
}));

export default router;