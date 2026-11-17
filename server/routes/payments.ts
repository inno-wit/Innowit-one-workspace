import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createPaymentSchema = z.object({
  salesInvoiceId: z.string().uuid('Invalid invoice ID'),
  paymentNumber: z.string().min(1, 'Payment number is required').max(50),
  paymentDate: z.string().datetime(),
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.string().min(1, 'Payment method is required').max(50),
  referenceCode: z.string().optional(),
});

const paymentParamsSchema = z.object({
  id: z.string().uuid('Invalid payment ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  paymentMethod: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// GET /api/payments
router.get('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'), validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, invoiceId, customerId, paymentMethod, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    salesInvoice: { customer: { organizationId: req.user!.organizationId } },
  };

  // Non-finance users can only see payments in their branch
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.salesInvoice = { ...where.salesInvoice, branchId: req.user!.branchId };
  }

  if (invoiceId) where.salesInvoiceId = invoiceId;
  if (customerId) where.salesInvoice = { ...where.salesInvoice, customerId };
  if (paymentMethod) where.paymentMethod = paymentMethod;
  if (fromDate || toDate) {
    where.paymentDate = {};
    if (fromDate) where.paymentDate.gte = new Date(fromDate);
    if (toDate) where.paymentDate.lte = new Date(toDate);
  }

  const [payments, total] = await Promise.all([
    prisma.customerPayment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { paymentDate: 'desc' },
      include: {
        salesInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { id: true, name: true, customerCode: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.customerPayment.count({ where }),
  ]);

  res.json({
    data: payments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/payments/:id
router.get('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER'), validateParams(paymentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const payment = await prisma.customerPayment.findUnique({
    where: { id },
    include: {
      salesInvoice: {
        include: {
          customer: { select: { id: true, name: true, customerCode: true, email: true } },
          branch: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!payment) {
    throw new AppError(404, 'NOT_FOUND', 'Payment not found');
  }

  if (payment.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: payment });
}));

// POST /api/payments
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateBody(createPaymentSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify invoice
  const invoice = await prisma.salesInvoice.findUnique({
    where: { id: data.salesInvoiceId },
    include: { customer: true, payments: true },
  });

  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'];
  if (!crossBranchRoles.includes(req.user!.role) && invoice.branchId !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check payment number uniqueness
  const existing = await prisma.customerPayment.findUnique({
    where: { paymentNumber: data.paymentNumber },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_PAYMENT_NUMBER', 'Payment number already exists');
  }

  // Validate amount doesn't exceed outstanding
  const totalPaid = invoice.paidAmount + invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const outstanding = Number(invoice.totalAmount) - totalPaid;

  if (data.amount > outstanding + 0.01) { // Allow small rounding
    throw new AppError(400, 'AMOUNT_EXCEEDS_OUTSTANDING', `Payment amount exceeds outstanding balance of ${outstanding}`);
  }

  // Create payment and update invoice
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.customerPayment.create({
      data: {
        ...data,
        paymentDate: new Date(data.paymentDate),
      },
      include: {
        salesInvoice: {
          select: { id: true, invoiceNumber: true, customer: { select: { id: true, name: true } } },
        },
      },
    });

    // Update invoice paid amount
    const newPaidAmount = Number(invoice.paidAmount) + data.amount;
    let newStatus = invoice.status;

    if (newPaidAmount >= Number(invoice.totalAmount) - 0.01) {
      newStatus = 'PAID';
    } else if (newPaidAmount > 0) {
      newStatus = 'PARTIALLY_PAID';
    }

    await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: { 
        paidAmount: newPaidAmount,
        status: newStatus,
      },
    });

    // Create journal entry for payment
    const accounts = await tx.account.findMany({
      where: { 
        organizationId: req.user!.organizationId,
        isActive: true,
      },
    });

    const cashAccount = accounts.find(a => a.accountNumber === '1000') || accounts.find(a => a.type === 'ASSET');
    const arAccount = accounts.find(a => a.accountNumber === '1200') || accounts.find(a => a.type === 'ASSET');

    if (cashAccount && arAccount) {
      await tx.journalEntry.create({
        data: {
          organizationId: req.user!.organizationId,
          entryNumber: `JE-PMT-${data.paymentNumber}`,
          postingDate: new Date(data.paymentDate),
          sourceModule: 'CUSTOMER_PAYMENT',
          sourceId: payment.id,
          description: `Payment ${data.paymentNumber} for Invoice ${invoice.invoiceNumber}`,
          lines: {
            create: [
              {
                accountId: cashAccount.id,
                description: `Cash/Bank - ${data.paymentMethod}`,
                debit: data.amount,
                credit: 0,
              },
              {
                accountId: arAccount.id,
                description: `AR - ${invoice.customer.name}`,
                debit: 0,
                credit: data.amount,
              },
            ],
          },
        },
      });

      // Update balances
      await tx.account.update({
        where: { id: cashAccount.id },
        data: { currentBalance: { increment: data.amount } },
      });
      await tx.account.update({
        where: { id: arAccount.id },
        data: { currentBalance: { increment: -data.amount } },
      });
    }

    return payment;
  });

  res.status(201).json({ data: result, message: 'Payment recorded successfully' });
}));

// DELETE /api/payments/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(paymentParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const payment = await prisma.customerPayment.findUnique({
    where: { id },
    include: { 
      salesInvoice: { 
        include: { 
          customer: true,
          payments: true,
        } 
      } 
    },
  });

  if (!payment) {
    throw new AppError(404, 'NOT_FOUND', 'Payment not found');
  }

  if (payment.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Reverse the payment
  await prisma.$transaction(async (tx) => {
    // Update invoice paid amount
    const newPaidAmount = Number(payment.salesInvoice.paidAmount) - Number(payment.amount);
    let newStatus = payment.salesInvoice.status;

    if (newPaidAmount <= 0.01) {
      newStatus = 'POSTED';
    } else if (newPaidAmount < Number(payment.salesInvoice.totalAmount) - 0.01) {
      newStatus = 'PARTIALLY_PAID';
    }

    await tx.salesInvoice.update({
      where: { id: payment.salesInvoiceId },
      data: { 
        paidAmount: Math.max(0, newPaidAmount),
        status: newStatus,
      },
    });

    // Reverse journal entry
    const journalEntry = await tx.journalEntry.findFirst({
      where: { sourceModule: 'CUSTOMER_PAYMENT', sourceId: id },
      include: { lines: true },
    });

    if (journalEntry) {
      for (const line of journalEntry.lines) {
        const balanceChange = line.credit - line.debit;
        await tx.account.update({
          where: { id: line.accountId },
          data: { currentBalance: { increment: balanceChange } },
        });
      }

      await tx.journalEntry.update({
        where: { id: journalEntry.id },
        data: { isReversed: true },
      });
    }

    // Delete payment
    await tx.customerPayment.delete({
      where: { id },
    });
  });

  res.json({ message: 'Payment deleted and reversed successfully' });
}));

export default router;