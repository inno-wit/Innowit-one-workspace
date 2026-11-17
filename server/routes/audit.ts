import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const auditParamsSchema = z.object({
  id: z.string().uuid('Invalid audit log ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// GET /api/audit
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, userId, action, entityType, entityId, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    user: { organizationId: req.user!.organizationId },
  };

  if (userId) where.userId = userId;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (fromDate || toDate) {
    where.timestamp = {};
    if (fromDate) where.timestamp.gte = new Date(fromDate);
    if (toDate) where.timestamp.lte = new Date(toDate);
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/audit/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'), validateParams(auditParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, role: true } },
    },
  });

  if (!log) {
    throw new AppError(404, 'NOT_FOUND', 'Audit log not found');
  }

  if (log.user?.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: log });
}));

// GET /api/audit/entity/:entityType/:entityId (Audit trail for specific entity)
router.get('/entity/:entityType/:entityId', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'), validateParams(z.object({
  entityType: z.string(),
  entityId: z.string().uuid(),
})), validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { entityType, entityId } = req.params;
  const { page, limit } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    entityType,
    entityId,
    user: { organizationId: req.user!.organizationId },
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({
    data: logs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/audit/stats
router.get('/stats', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const [totalLogs, byAction, byEntityType, recentActivity] = await Promise.all([
    prisma.auditLog.count({
      where: { user: { organizationId: req.user!.organizationId } },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { user: { organizationId: req.user!.organizationId } },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    }),
    prisma.auditLog.groupBy({
      by: ['entityType'],
      where: { user: { organizationId: req.user!.organizationId } },
      _count: { entityType: true },
      orderBy: { _count: { entityType: 'desc' } },
      take: 10,
    }),
    prisma.auditLog.findMany({
      where: { user: { organizationId: req.user!.organizationId } },
      orderBy: { timestamp: 'desc' },
      take: 20,
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
  ]);

  res.json({
    data: {
      totalLogs,
      byAction: byAction.map(a => ({ action: a.action, count: a._count.action })),
      byEntityType: byEntityType.map(e => ({ entityType: e.entityType, count: e._count.entityType })),
      recentActivity,
    },
  });
}));

export default router;