import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createDepartmentSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
});

const updateDepartmentSchema = createDepartmentSchema.partial();

const departmentParamsSchema = z.object({
  id: z.string().uuid('Invalid department ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().optional(),
});

// GET /api/departments
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'EXECUTIVE'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const [departments, total] = await Promise.all([
    prisma.department.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { employees: true } },
      },
    }),
    prisma.department.count({ where }),
  ]);

  res.json({
    data: departments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/departments/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'EXECUTIVE'), validateParams(departmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const department = await prisma.department.findUnique({
    where: { id },
    include: {
      employees: {
        include: {
          user: { select: { id: true, fullName: true, email: true, isActive: true } },
        },
      },
      _count: { select: { employees: true } },
    },
  });

  if (!department) {
    throw new AppError(404, 'NOT_FOUND', 'Department not found');
  }

  res.json({ data: department });
}));

// POST /api/departments
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateBody(createDepartmentSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const department = await prisma.department.create({
    data: {
      ...req.body,
      organizationId: req.user!.organizationId,
    },
  });

  res.status(201).json({ data: department });
}));

// PUT /api/departments/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateParams(departmentParamsSchema), validateBody(updateDepartmentSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const department = await prisma.department.update({
    where: { id },
    data: req.body,
    include: {
      _count: { select: { employees: true } },
    },
  });

  res.json({ data: department });
}));

// DELETE /api/departments/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateParams(departmentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const department = await prisma.department.findUnique({
    where: { id },
    include: { _count: { select: { employees: true } } },
  });

  if (!department) {
    throw new AppError(404, 'NOT_FOUND', 'Department not found');
  }

  if (department._count.employees > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete department with employees');
  }

  await prisma.department.delete({ where: { id } });
  res.json({ message: 'Department deleted successfully' });
}));

export default router;