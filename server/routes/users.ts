import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required').max(255),
  role: z.nativeEnum(UserRole).default(UserRole.EMPLOYEE),
  branchId: z.string().uuid().optional(),
  avatarUrl: z.string().url().optional(),
});

const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
});

const userParamsSchema = z.object({
  id: z.string().uuid('Invalid user ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  role: z.nativeEnum(UserRole).optional(),
  branchId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

// GET /api/users
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, role, branchId, isActive } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'ADMIN') {
    where.branchId = req.user!.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { fullName: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        avatarUrl: true,
        branchId: true,
        createdAt: true,
        updatedAt: true,
        branch: { select: { id: true, name: true } },
        employee: { select: { id: true, employeeCode: true, department: { select: { id: true, name: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    data: users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/users/:id
router.get('/:id', authenticateToken, validateParams(userParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      avatarUrl: true,
      branchId: true,
      createdAt: true,
      updatedAt: true,
      organizationId: true,
      branch: { select: { id: true, name: true } },
      employee: { 
        select: { 
          id: true, 
          employeeCode: true, 
          department: { select: { id: true, name: true } },
          basicSalary: true,
          hireDate: true,
        } 
      },
    },
  });

  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  // Check organization access
  if (user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check branch access for non-admin roles
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'HR_MANAGER'];
  if (!crossBranchRoles.includes(req.user!.role) && user.branchId !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: user });
}));

// POST /api/users
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateBody(createUserSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if email already exists in organization
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_EMAIL', 'Email already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      ...data,
      passwordHash,
      organizationId: req.user!.organizationId,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      avatarUrl: true,
      branchId: true,
      createdAt: true,
    },
  });

  res.status(201).json({ data: user });
}));

// PUT /api/users/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateParams(userParamsSchema), validateBody(updateUserSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  if (existingUser.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const updateData: any = { ...data };
  
  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, 12);
    delete updateData.password;
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      avatarUrl: true,
      branchId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ data: user });
}));

// DELETE /api/users/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(userParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  if (user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Prevent self-deletion
  if (user.id === req.user!.userId) {
    throw new AppError(400, 'SELF_DELETE', 'Cannot delete your own account');
  }

  await prisma.user.delete({
    where: { id },
  });

  res.json({ message: 'User deleted successfully' });
}));

export default router;