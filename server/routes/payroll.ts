import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createPayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
});

const payslipSchema = z.object({
  employeeId: z.string().uuid(),
  basicSalary: z.number().nonnegative(),
  allowances: z.number().nonnegative().default(0),
  grossPay: z.number().nonnegative(),
  payeTax: z.number().nonnegative(),
  nssfDeduction: z.number().nonnegative(),
  nhifDeduction: z.number().nonnegative(),
  housingLevy: z.number().nonnegative(),
  netPay: z.number().nonnegative(),
});

const createPayslipsSchema = z.object({
  payslips: z.array(payslipSchema).min(1),
});

const payrollParamsSchema = z.object({
  id: z.string().uuid('Invalid payroll run ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  year: z.coerce.number().int().optional(),
  isApproved: z.coerce.boolean().optional(),
});

// GET /api/payroll
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER', 'EXECUTIVE'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, year, isApproved } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (year) where.year = year;
  if (isApproved !== undefined) where.isApproved = isApproved;

  const [runs, total] = await Promise.all([
    prisma.payrollRun.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { payslips: true } },
      },
    }),
    prisma.payrollRun.count({ where }),
  ]);

  res.json({
    data: runs,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/payroll/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER', 'EXECUTIVE'), validateParams(payrollParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      payslips: {
        include: {
          employee: {
            include: {
              user: { select: { id: true, fullName: true, email: true } },
              department: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new AppError(404, 'NOT_FOUND', 'Payroll run not found');
  }

  res.json({ data: run });
}));

// POST /api/payroll (Create payroll run)
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER'), validateBody(createPayrollRunSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { month, year } = req.body;

  // Check if payroll run already exists for this month/year
  const existing = await prisma.payrollRun.findUnique({
    where: { month_year: { month, year } },
  });

  if (existing) {
    throw new AppError(409, 'PAYROLL_EXISTS', `Payroll run for ${month}/${year} already exists`);
  }

  const run = await prisma.payrollRun.create({
    data: { month, year },
  });

  res.status(201).json({ data: run });
}));

// POST /api/payroll/:id/payslips (Bulk create payslips)
router.post('/:id/payslips', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER'), validateParams(payrollParamsSchema), validateBody(createPayslipsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { payslips } = req.body;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
  });

  if (!run) {
    throw new AppError(404, 'NOT_FOUND', 'Payroll run not found');
  }

  if (run.isApproved) {
    throw new AppError(400, 'ALREADY_APPROVED', 'Cannot add payslips to approved payroll run');
  }

  // Verify all employees belong to organization
  const employeeIds = payslips.map((p: any) => p.employeeId);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    include: { user: true },
  });

  if (employees.length !== employeeIds.length) {
    throw new AppError(400, 'INVALID_EMPLOYEE', 'One or more employees not found');
  }

  const invalidOrg = employees.some(e => e.user.organizationId !== req.user!.organizationId);
  if (invalidOrg) {
    throw new AppError(403, 'FORBIDDEN', 'Employee belongs to different organization');
  }

  // Check for duplicates
  const existingPayslips = await prisma.payslip.findMany({
    where: { payrollRunId: id, employeeId: { in: employeeIds } },
  });

  if (existingPayslips.length > 0) {
    throw new AppError(409, 'DUPLICATE_PAYSLIP', 'Some employees already have payslips for this run');
  }

  // Calculate totals
  let totalGross = 0;
  let totalTax = 0;
  let totalNet = 0;

  const payslipData = payslips.map((p: any) => {
    totalGross += p.grossPay;
    totalTax += p.payeTax;
    totalNet += p.netPay;
    return {
      ...p,
      payrollRunId: id,
    };
  });

  const result = await prisma.$transaction(async (tx) => {
    // Create payslips
    await tx.payslip.createMany({
      data: payslipData,
    });

    // Update payroll run totals
    const updatedRun = await tx.payrollRun.update({
      where: { id },
      data: {
        totalGross,
        totalTax,
        totalNet,
      },
    });

    return updatedRun;
  });

  res.status(201).json({ data: result, message: `${payslips.length} payslips created` });
}));

// POST /api/payroll/:id/approve
router.post('/:id/approve', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER'), validateParams(payrollParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { payslips: true },
  });

  if (!run) {
    throw new AppError(404, 'NOT_FOUND', 'Payroll run not found');
  }

  if (run.isApproved) {
    throw new AppError(400, 'ALREADY_APPROVED', 'Payroll run already approved');
  }

  if (run.payslips.length === 0) {
    throw new AppError(400, 'NO_PAYSLIPS', 'Cannot approve payroll run without payslips');
  }

  // Get accounts for journal entry
  const accounts = await prisma.account.findMany({
    where: { 
      organizationId: req.user!.organizationId,
      isActive: true,
    },
  });

  const wagesAccount = accounts.find(a => a.accountNumber === '5000') || accounts.find(a => a.type === 'EXPENSE');
  const taxAccount = accounts.find(a => a.accountNumber === '2300') || accounts.find(a => a.type === 'LIABILITY');
  const nssfAccount = accounts.find(a => a.accountNumber === '2310') || accounts.find(a => a.type === 'LIABILITY');
  const nhifAccount = accounts.find(a => a.accountNumber === '2320') || accounts.find(a => a.type === 'LIABILITY');
  const housingAccount = accounts.find(a => a.accountNumber === '2330') || accounts.find(a => a.type === 'LIABILITY');
  const bankAccount = accounts.find(a => a.accountNumber === '1000') || accounts.find(a => a.type === 'ASSET');

  if (!wagesAccount || !taxAccount || !nssfAccount || !nhifAccount || !housingAccount || !bankAccount) {
    throw new AppError(400, 'MISSING_ACCOUNTS', 'Required payroll accounts not configured');
  }

  const updatedRun = await prisma.$transaction(async (tx) => {
    // Create journal entry
    const entryNumber = `JE-PR-${run.year}-${String(run.month).padStart(2, '0')}`;
    
    const journalEntry = await tx.journalEntry.create({
      data: {
        organizationId: req.user!.organizationId,
        entryNumber,
        postingDate: new Date(run.year, run.month - 1, 1),
        sourceModule: 'PAYROLL',
        sourceId: run.id,
        description: `Payroll ${run.month}/${run.year}`,
        lines: {
          create: [
            {
              accountId: wagesAccount.id,
              description: 'Wages & Salaries',
              debit: run.totalGross,
              credit: 0,
            },
            {
              accountId: taxAccount.id,
              description: 'PAYE Tax Payable',
              debit: 0,
              credit: run.totalTax,
            },
            {
              accountId: nssfAccount.id,
              description: 'NSSF Payable',
              debit: 0,
              credit: run.payslips.reduce((sum, p) => sum + Number(p.nssfDeduction), 0),
            },
            {
              accountId: nhifAccount.id,
              description: 'NHIF Payable',
              debit: 0,
              credit: run.payslips.reduce((sum, p) => sum + Number(p.nhifDeduction), 0),
            },
            {
              accountId: housingAccount.id,
              description: 'Housing Levy Payable',
              debit: 0,
              credit: run.payslips.reduce((sum, p) => sum + Number(p.housingLevy), 0),
            },
            {
              accountId: bankAccount.id,
              description: 'Net Pay - Bank Transfer',
              debit: 0,
              credit: run.totalNet,
            },
          ],
        },
      },
    });

    // Update balances
    await tx.account.update({
      where: { id: wagesAccount.id },
      data: { currentBalance: { increment: run.totalGross } },
    });
    await tx.account.update({
      where: { id: taxAccount.id },
      data: { currentBalance: { increment: -run.totalTax } },
    });
    await tx.account.update({
      where: { id: nssfAccount.id },
      data: { currentBalance: { increment: -run.payslips.reduce((sum, p) => sum + Number(p.nssfDeduction), 0) } },
    });
    await tx.account.update({
      where: { id: nhifAccount.id },
      data: { currentBalance: { increment: -run.payslips.reduce((sum, p) => sum + Number(p.nhifDeduction), 0) } },
    });
    await tx.account.update({
      where: { id: housingAccount.id },
      data: { currentBalance: { increment: -run.payslips.reduce((sum, p) => sum + Number(p.housingLevy), 0) } },
    });
    await tx.account.update({
      where: { id: bankAccount.id },
      data: { currentBalance: { increment: -run.totalNet } },
    });

    // Mark as approved and posted to GL
    return tx.payrollRun.update({
      where: { id },
      data: { 
        isApproved: true,
        postedToGl: true,
      },
    });
  });

  res.json({ data: updatedRun, message: 'Payroll run approved and posted to General Ledger' });
}));

// GET /api/payroll/:id/payslip/:employeeId
router.get('/:id/payslip/:employeeId', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_MANAGER', 'EXECUTIVE'), validateParams(z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, employeeId } = req.params;

  const payslip = await prisma.payslip.findUnique({
    where: {
      payrollRunId_employeeId: {
        payrollRunId: id,
        employeeId,
      },
    },
    include: {
      employee: {
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          department: { select: { id: true, name: true } },
        },
      },
      payrollRun: { select: { id: true, month: true, year: true, isApproved: true } },
    },
  });

  if (!payslip) {
    throw new AppError(404, 'NOT_FOUND', 'Payslip not found');
  }

  if (payslip.employee.user.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: payslip });
}));

export default router;