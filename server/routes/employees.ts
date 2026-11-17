import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createEmployeeSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  departmentId: z.string().uuid('Invalid department ID'),
  employeeCode: z.string().min(1, 'Employee code is required').max(20),
  nationalId: z.string().optional(),
  kraPin: z.string().optional(),
  nssfNumber: z.string().optional(),
  nhifNumber: z.string().optional(),
  basicSalary: z.number().nonnegative('Basic salary must be non-negative'),
  hireDate: z.string().datetime(),
  isActive: z.boolean().default(true),
});

const updateEmployeeSchema = createEmployeeSchema.partial().omit({ userId: true });

const employeeParamsSchema = z.object({
  id: z.string().uuid('Invalid employee ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
});

// GET /api/employees
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'EXECUTIVE'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, departmentId, isActive } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    user: { organizationId: req.user!.organizationId },
  };

  if (departmentId) where.departmentId = departmentId;
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where.OR = [
      { employeeCode: { contains: search, mode: 'insensitive' } },
      { user: { fullName: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { nationalId: { contains: search, mode: 'insensitive' } },
      { kraPin: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true, isActive: true, role: true } },
        department: { select: { id: true, name: true } },
        _count: { select: { payslips: true } },
      },
    }),
    prisma.employee.count({ where }),
  ]);

  res.json({
    data: employees,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/employees/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'EXECUTIVE'), validateParams(employeeParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, isActive: true, role: true, branch: { select: { id: true, name: true } } } },
      department: { select: { id: true, name: true } },
      payslips: {
        include: {
          payrollRun: { select: { id: true, month: true, year: true } },
        },
        orderBy: { payrollRun: { year: 'desc' } },
        take: 12,
      },
    },
  });

  if (!employee) {
    throw new AppError(404, 'NOT_FOUND', 'Employee not found');
  }

  if (employee.user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: employee });
}));

// POST /api/employees
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateBody(createEmployeeSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify user
  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  if (user.employee) {
    throw new AppError(409, 'USER_HAS_EMPLOYEE', 'User already has an employee record');
  }

  // Verify department
  const department = await prisma.department.findUnique({
    where: { id: data.departmentId },
  });

  if (!department) {
    throw new AppError(404, 'NOT_FOUND', 'Department not found');
  }

  // Check employee code uniqueness
  const existingCode = await prisma.employee.findUnique({
    where: { employeeCode: data.employeeCode },
  });

  if (existingCode) {
    throw new AppError(409, 'DUPLICATE_EMPLOYEE_CODE', 'Employee code already exists');
  }

  // Check national ID uniqueness if provided
  if (data.nationalId) {
    const existingId = await prisma.employee.findUnique({
      where: { nationalId: data.nationalId },
    });

    if (existingId) {
      throw new AppError(409, 'DUPLICATE_NATIONAL_ID', 'National ID already exists');
    }
  }

  const employee = await prisma.employee.create({
    data: {
      ...data,
      hireDate: new Date(data.hireDate),
    },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      department: { select: { id: true, name: true } },
    },
  });

  res.status(201).json({ data: employee });
}));

// PUT /api/employees/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateParams(employeeParamsSchema), validateBody(updateEmployeeSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { user: true },
  });

  if (!employee) {
    throw new AppError(404, 'NOT_FOUND', 'Employee not found');
  }

  if (employee.user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Verify department if changing
  if (data.departmentId && data.departmentId !== employee.departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: data.departmentId },
    });

    if (!department) {
      throw new AppError(404, 'NOT_FOUND', 'Department not found');
    }
  }

  // Check employee code uniqueness if changing
  if (data.employeeCode && data.employeeCode !== employee.employeeCode) {
    const existing = await prisma.employee.findUnique({
      where: { employeeCode: data.employeeCode },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_EMPLOYEE_CODE', 'Employee code already exists');
    }
  }

  // Check national ID uniqueness if changing
  if (data.nationalId && data.nationalId !== employee.nationalId) {
    const existing = await prisma.employee.findUnique({
      where: { nationalId: data.nationalId },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_NATIONAL_ID', 'National ID already exists');
    }
  }

  const updatedEmployee = await prisma.employee.update({
    where: { id },
    data: {
      ...data,
      hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
    },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      department: { select: { id: true, name: true } },
    },
  });

  res.json({ data: updatedEmployee });
}));

// DELETE /api/employees/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'), validateParams(employeeParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { _count: { select: { payslips: true } }, user: true },
  });

  if (!employee) {
    throw new AppError(404, 'NOT_FOUND', 'Employee not found');
  }

  if (employee.user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (employee._count.payslips > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete employee with payslip history');
  }

  await prisma.employee.delete({ where: { id } });
  res.json({ message: 'Employee deleted successfully' });
}));

export default router;