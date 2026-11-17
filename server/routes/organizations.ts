import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createOrgSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required').max(255),
  tradeName: z.string().max(255).optional(),
  kraPin: z.string().min(1, 'KRA PIN is required').max(50),
  vatNumber: z.string().max(50).optional(),
});

const updateOrgSchema = createOrgSchema.partial();

const orgParamsSchema = z.object({
  id: z.string().uuid('Invalid organization ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

// GET /api/organizations
router.get('/', authenticateToken, authorize('SUPER_ADMIN'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  const where = search ? {
    OR: [
      { legalName: { contains: search, mode: 'insensitive' as const } },
      { tradeName: { contains: search, mode: 'insensitive' as const } },
      { kraPin: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {};

  const [organizations, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { branches: true, users: true },
        },
      },
    }),
    prisma.organization.count({ where }),
  ]);

  res.json({
    data: organizations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/organizations/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN'), validateParams(orgParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      branches: true,
      users: {
        include: {
          branch: true,
          employee: true,
        },
      },
      etimsConfigs: true,
      _count: {
        select: { branches: true, users: true },
      },
    },
  });

  if (!organization) {
    throw new AppError(404, 'NOT_FOUND', 'Organization not found');
  }

  res.json({ data: organization });
}));

// POST /api/organizations
router.post('/', authenticateToken, authorize('SUPER_ADMIN'), validateBody(createOrgSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const organization = await prisma.organization.create({
    data,
    include: {
      _count: {
        select: { branches: true, users: true },
      },
    },
  });

  res.status(201).json({ data: organization });
}));

// PUT /api/organizations/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN'), validateParams(orgParamsSchema), validateBody(updateOrgSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const organization = await prisma.organization.update({
    where: { id },
    data,
    include: {
      _count: {
        select: { branches: true, users: true },
      },
    },
  });

  res.json({ data: organization });
}));

// DELETE /api/organizations/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN'), validateParams(orgParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  await prisma.organization.delete({
    where: { id },
  });

  res.json({ message: 'Organization deleted successfully' });
}));

export default router;