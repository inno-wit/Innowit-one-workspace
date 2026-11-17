import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

const createCustomerSchema = z.object({
  customerCode: z.string().min(1, 'Customer code is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  companyName: z.string().max(255).optional(),
  kraPin: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  billingAddress: z.string().optional(),
  creditLimit: z.number().nonnegative().default(0),
  paymentTermsDays: z.number().int().nonnegative().default(30),
});

const updateCustomerSchema = createCustomerSchema.partial();

const customerParamsSchema = z.object({
  id: z.string().uuid('Invalid customer ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  hasKraPin: z.coerce.boolean().optional(),
});

// GET /api/customers
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, hasKraPin } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    organizationId: req.user!.organizationId,
  };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { customerCode: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
      { kraPin: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (hasKraPin !== undefined) {
    if (hasKraPin) {
      where.kraPin = { not: null };
    } else {
      where.kraPin = null;
    }
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { deals: true, salesOrders: true, invoices: true, tasks: true },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({
    data: customers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/customers/:id
router.get('/:id', authenticateToken, validateParams(customerParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      contacts: true,
      deals: {
        include: {
          assignedTo: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      salesOrders: {
        orderBy: { createdAt: 'desc' },
      },
      invoices: {
        orderBy: { invoiceDate: 'desc' },
      },
      tasks: {
        include: {
          assignedTo: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      _count: {
        select: { deals: true, salesOrders: true, invoices: true, tasks: true },
      },
    },
  });

  if (!customer) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  if (customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: customer });
}));

// POST /api/customers
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(createCustomerSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if customer code already exists in organization
  const existing = await prisma.customer.findUnique({
    where: { customerCode: data.customerCode },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_CUSTOMER_CODE', 'Customer code already exists');
  }

  const customer = await prisma.customer.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      creditLimit: data.creditLimit || 0,
      paymentTermsDays: data.paymentTermsDays || 30,
    },
    include: {
      _count: {
        select: { deals: true, salesOrders: true, invoices: true, tasks: true },
      },
    },
  });

  res.status(201).json({ data: customer });
}));

// PUT /api/customers/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(customerParamsSchema), validateBody(updateCustomerSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const customer = await prisma.customer.findUnique({
    where: { id },
  });

  if (!customer) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  if (customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check customer code uniqueness if changing
  if (data.customerCode && data.customerCode !== customer.customerCode) {
    const existing = await prisma.customer.findUnique({
      where: { customerCode: data.customerCode },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_CUSTOMER_CODE', 'Customer code already exists');
    }
  }

  const updatedCustomer = await prisma.customer.update({
    where: { id },
    data,
    include: {
      _count: {
        select: { deals: true, salesOrders: true, invoices: true, tasks: true },
      },
    },
  });

  res.json({ data: updatedCustomer });
}));

// DELETE /api/customers/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(customerParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: {
        select: { deals: true, salesOrders: true, invoices: true, tasks: true },
      },
    },
  });

  if (!customer) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  if (customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (customer._count.deals > 0 || customer._count.salesOrders > 0 || customer._count.invoices > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete customer with existing deals, orders, or invoices');
  }

  await prisma.customer.delete({
    where: { id },
  });

  res.json({ message: 'Customer deleted successfully' });
}));

// Customer Contacts
const contactParamsSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  contactId: z.string().uuid('Invalid contact ID'),
});

const createContactSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
});

const updateContactSchema = createContactSchema.partial();

// GET /api/customers/:customerId/contacts
router.get('/:customerId/contacts', authenticateToken, validateParams(z.object({ customerId: z.string().uuid() })), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { customerId } = req.params;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer || customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const contacts = await prisma.customerContact.findMany({
    where: { customerId },
    orderBy: { firstName: 'asc' },
  });

  res.json({ data: contacts });
}));

// POST /api/customers/:customerId/contacts
router.post('/:customerId/contacts', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(z.object({ customerId: z.string().uuid() })), validateBody(createContactSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { customerId } = req.params;
  const data = req.body;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer || customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  const contact = await prisma.customerContact.create({
    data: {
      ...data,
      customerId,
    },
  });

  res.status(201).json({ data: contact });
}));

// PUT /api/customers/:customerId/contacts/:contactId
router.put('/:customerId/contacts/:contactId', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(contactParamsSchema), validateBody(updateContactSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { contactId } = req.params;
  const data = req.body;

  const contact = await prisma.customerContact.findUnique({
    where: { id: contactId },
    include: { customer: true },
  });

  if (!contact || contact.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Contact not found');
  }

  const updatedContact = await prisma.customerContact.update({
    where: { id: contactId },
    data,
  });

  res.json({ data: updatedContact });
}));

// DELETE /api/customers/:customerId/contacts/:contactId
router.delete('/:customerId/contacts/:contactId', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateParams(contactParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { contactId } = req.params;

  const contact = await prisma.customerContact.findUnique({
    where: { id: contactId },
    include: { customer: true },
  });

  if (!contact || contact.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Contact not found');
  }

  await prisma.customerContact.delete({
    where: { id: contactId },
  });

  res.json({ message: 'Contact deleted successfully' });
}));

export default router;