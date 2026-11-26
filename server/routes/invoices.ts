import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { postSalesInvoice } from '../services/accounting/arService';
import { dec, money, mul } from '../services/accounting/money';

const router = Router();

const invoiceItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  taxClassification: z.enum(['STANDARD_16', 'ZERO_RATED', 'EXEMPT', 'WITHHOLDING']).default('STANDARD_16'),
});

const createInvoiceSchema = z.object({
  branchId: z.string().uuid('Invalid branch ID'),
  customerId: z.string().uuid('Invalid customer ID'),
  salesOrderId: z.string().uuid().optional(),
  invoiceNumber: z.string().min(1, 'Invoice number is required').max(50),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  isSandbox: z.boolean().default(false),
  items: z.array(invoiceItemSchema).min(1, 'At least one item required'),
});

const updateInvoiceSchema = z.object({
  branchId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  invoiceNumber: z.string().max(50).optional(),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional(),
  status: z.enum(['DRAFT', 'VALIDATED', 'POSTED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED']).optional(),
  isSandbox: z.boolean().optional(),
  items: z.array(invoiceItemSchema).optional(),
});

const invoiceParamsSchema = z.object({
  id: z.string().uuid('Invalid invoice ID'),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'VALIDATED', 'POSTED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED']).optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// Tax calculation helper
function calculateTax(amount: number, classification: string): number {
  switch (classification) {
    case 'STANDARD_16': return amount * 0.16;
    case 'ZERO_RATED': return 0;
    case 'EXEMPT': return 0;
    case 'WITHHOLDING': return amount * 0.05; // Example withholding rate
    default: return amount * 0.16;
  }
}

// GET /api/invoices
router.get('/', authenticateToken, validateQuery(listQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search, status, customerId, branchId, fromDate, toDate } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    customer: { organizationId: req.user!.organizationId },
  };

  // Non-managers can only see invoices in their branch
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'];
  if (!crossBranchRoles.includes(req.user!.role)) {
    where.branchId = req.user!.branchId;
  } else if (branchId) {
    where.branchId = branchId;
  }

  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (fromDate || toDate) {
    where.invoiceDate = {};
    if (fromDate) where.invoiceDate.gte = new Date(fromDate);
    if (toDate) where.invoiceDate.lte = new Date(toDate);
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [invoices, total] = await Promise.all([
    prisma.salesInvoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { invoiceDate: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        branch: { select: { id: true, name: true, branchCode: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
        payments: { select: { id: true, amount: true, paymentDate: true, paymentMethod: true } },
        etimsInvoice: { select: { id: true, kraControlNumber: true, ackCode: true } },
        _count: { select: { items: true, payments: true, creditNotes: true } },
      },
    }),
    prisma.salesInvoice.count({ where }),
  ]);

  res.json({
    data: invoices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/invoices/:id
router.get('/:id', authenticateToken, validateParams(invoiceParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, organizationId: true, name: true, customerCode: true, email: true, phone: true, billingAddress: true, kraPin: true } },
      branch: { select: { id: true, name: true, branchCode: true, address: true } },
      salesOrder: { select: { id: true, orderNumber: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, taxClassification: true } },
        },
      },
      payments: { orderBy: { paymentDate: 'desc' } },
      creditNotes: { orderBy: { issuedAt: 'desc' } },
      etimsInvoice: true,
      transmissionJobs: { orderBy: { createdAt: 'desc' } },
    },
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

  res.json({ data: invoice });
}));

// POST /api/invoices
router.post('/', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER', 'SALES_REP'), validateBody(createInvoiceSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Verify branch
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
  });

  if (!branch || branch.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }

  // Check branch access
  const crossBranchRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'FINANCE_MANAGER', 'ACCOUNTANT'];
  if (!crossBranchRoles.includes(req.user!.role) && branch.id !== req.user!.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this branch');
  }

  // Verify customer
  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
  });

  if (!customer || customer.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }

  // Verify sales order if provided
  if (data.salesOrderId) {
    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
      include: { invoice: true },
    });

    if (!salesOrder || salesOrder.customerId !== data.customerId) {
      throw new AppError(404, 'NOT_FOUND', 'Sales order not found or does not match customer');
    }

    if (salesOrder.invoice) {
      throw new AppError(409, 'ORDER_INVOICED', 'Sales order already invoiced');
    }
  }

  // Verify products
  const productIds = data.items.map((item: any) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });

  if (products.length !== productIds.length) {
    throw new AppError(400, 'INVALID_PRODUCT', 'One or more products not found');
  }

  const invalidOrg = products.some(p => p.organizationId !== req.user!.organizationId);
  if (invalidOrg) {
    throw new AppError(403, 'FORBIDDEN', 'Product belongs to different organization');
  }

  // Check invoice number uniqueness (audit fix SC-6: tenant-scoped)
  const existingInvoice = await prisma.salesInvoice.findUnique({
    where: { organizationId_invoiceNumber: { organizationId: req.user!.organizationId, invoiceNumber: data.invoiceNumber } },
  });

  if (existingInvoice) {
    throw new AppError(409, 'DUPLICATE_INVOICE_NUMBER', 'Invoice number already exists in this organization');
  }

  // Calculate totals
  let subtotal = 0;
  let taxAmount = 0;

  const itemsWithCalculations = data.items.map((item: any) => {
    const product = products.find(p => p.id === item.productId)!;
    const lineSubtotal = item.quantity * item.unitPrice;
    const lineTax = calculateTax(lineSubtotal, item.taxClassification);
    subtotal += lineSubtotal;
    taxAmount += lineTax;
    return {
      ...item,
      taxAmount: lineTax,
      lineTotal: lineSubtotal + lineTax,
    };
  });

  const totalAmount = subtotal + taxAmount;

  // Create invoice
  const invoice = await prisma.$transaction(async (tx) => {
    // If from sales order, release stock reservations and create stock movements
    if (data.salesOrderId) {
      const salesOrder = await tx.salesOrder.findUnique({
        where: { id: data.salesOrderId },
        include: { items: true, customer: true },
      });

      if (salesOrder) {
        // Find warehouse
        const warehouse = salesOrder.customer.branchId
          ? await tx.warehouse.findFirst({
              where: { branchId: salesOrder.customer.branchId },
            })
          : null;

        if (warehouse) {
          for (const item of salesOrder.items) {
            const product = products.find((p) => p.id === item.productId);
            if (!product) continue;
            const stockLevel = await tx.warehouseStock.findUnique({
              where: {
                productId_warehouseId: {
                  productId: item.productId,
                  warehouseId: warehouse.id,
                },
              },
            });

            if (stockLevel) {
              // Release reservation and reduce on-hand
              await tx.warehouseStock.update({
                where: { id: stockLevel.id },
                data: {
                  quantityReserved: { decrement: item.quantity },
                  quantityOnHand: { decrement: item.quantity },
                },
              });

              // Create stock movement
              await tx.stockMovement.create({
                data: {
                  productId: item.productId,
                  warehouseId: warehouse.id,
                  movementType: 'ISSUE',
                  quantity: item.quantity,
                  unitCost: product.costPrice,
                  referenceDocument: data.invoiceNumber,
                  notes: `Sale from invoice ${data.invoiceNumber}`,
                },
              });
            }
          }
        }

        // Update sales order status
        await tx.salesOrder.update({
          where: { id: data.salesOrderId },
          data: { orderStatus: 'COMPLETED' },
        });
      }
    }

    // Create invoice with items
    const newInvoice = await tx.salesInvoice.create({
      data: {
        organizationId: req.user!.organizationId,
        branchId: data.branchId,
        customerId: data.customerId,
        salesOrderId: data.salesOrderId,
        invoiceNumber: data.invoiceNumber,
        invoiceDate: new Date(data.invoiceDate),
        dueDate: new Date(data.dueDate),
        isSandbox: data.isSandbox,
        status: 'DRAFT',
        subtotal,
        taxAmount,
        totalAmount,
        items: {
          create: itemsWithCalculations.map((item: any) => ({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxClassification: item.taxClassification,
            taxAmount: item.taxAmount,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        branch: { select: { id: true, name: true, branchCode: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });

    // Create eTIMS transmission queue entry (audit fix ETIMS-2/3: idempotencyKey
    // is now deterministic — the invoice ID itself — so the same invoice can
    // never enqueue twice. The @@unique on idempotencyKey enforces this at DB
    // level. Worker also checks for existing EtimsInvoice before creating.)
    await tx.etimsTransmissionQueue.upsert({
      where: { idempotencyKey: newInvoice.id },
      update: { status: 'PENDING', payloadJson: JSON.stringify({ invoiceId: newInvoice.id }), attemptCount: 0, lastError: null, responseJson: null },
      create: {
        salesInvoiceId: newInvoice.id,
        idempotencyKey: newInvoice.id,
        status: 'PENDING',
        payloadJson: JSON.stringify({ invoiceId: newInvoice.id }),
      },
    });

    return newInvoice;
  });

  res.status(201).json({ data: invoice });
}));

// PUT /api/invoices/:id
router.put('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(invoiceParamsSchema), validateBody(updateInvoiceSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    include: { customer: true, branch: true, items: true },
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

  // Don't allow editing posted/paid invoices
  if (['POSTED', 'PAID', 'PARTIALLY_PAID'].includes(invoice.status)) {
    throw new AppError(400, 'CANNOT_EDIT', 'Cannot edit posted or paid invoices');
  }

  // Verify branch if changing
  if (data.branchId && data.branchId !== invoice.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: data.branchId },
    });

    if (!branch || branch.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Branch not found');
    }
  }

  // Verify customer if changing
  if (data.customerId && data.customerId !== invoice.customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
    });

    if (!customer || customer.organizationId !== req.user!.organizationId) {
      throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    }
  }

  // Verify invoice number if changing (audit fix SC-6: tenant-scoped)
  if (data.invoiceNumber && data.invoiceNumber !== invoice.invoiceNumber) {
    const existing = await prisma.salesInvoice.findUnique({
      where: { organizationId_invoiceNumber: { organizationId: req.user!.organizationId, invoiceNumber: data.invoiceNumber } },
    });

    if (existing) {
      throw new AppError(409, 'DUPLICATE_INVOICE_NUMBER', 'Invoice number already exists in this organization');
    }
  }

  // Recalculate totals if items changed
  let subtotal = invoice.subtotal;
  let taxAmount = invoice.taxAmount;
  let totalAmount = invoice.totalAmount;
  let itemsWithCalculations: any[] = [];

  if (data.items) {
    // Verify products
    const productIds = data.items.map((item: any) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (products.length !== productIds.length) {
      throw new AppError(400, 'INVALID_PRODUCT', 'One or more products not found');
    }

    let nextSubtotal = dec(0);
    let nextTaxAmount = dec(0);
    itemsWithCalculations = data.items.map((item: any) => {
      const lineSubtotal = mul(item.quantity, item.unitPrice);
      const lineTax = dec(calculateTax(Number(lineSubtotal.toFixed(2)), item.taxClassification));
      nextSubtotal = nextSubtotal.plus(lineSubtotal);
      nextTaxAmount = nextTaxAmount.plus(lineTax);
      return {
        ...item,
        taxAmount: money(lineTax),
        lineTotal: money(lineSubtotal.plus(lineTax)),
      };
    });
    subtotal = money(nextSubtotal);
    taxAmount = money(nextTaxAmount);
    totalAmount = money(nextSubtotal.plus(nextTaxAmount));
  }

  const updatedInvoice = await prisma.$transaction(async (tx) => {
    // Update items if provided
    if (data.items) {
      await tx.salesInvoiceItem.deleteMany({
        where: { salesInvoiceId: id },
      });

      await tx.salesInvoiceItem.createMany({
        data: itemsWithCalculations.map((item: any) => ({
          salesInvoiceId: id,
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxClassification: item.taxClassification,
          taxAmount: item.taxAmount,
          lineTotal: item.lineTotal,
        })),
      });
    }

    return tx.salesInvoice.update({
      where: { id },
      data: {
        ...data,
        invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        subtotal,
        taxAmount,
        totalAmount,
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        branch: { select: { id: true, name: true, branchCode: true } },
        items: {
          include: {
            product: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
  });

  res.json({ data: updatedInvoice });
}));

// POST /api/invoices/:id/validate
router.post('/:id/validate', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(invoiceParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    include: { customer: { select: { organizationId: true } } },
  });

  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (invoice.status !== 'DRAFT') {
    throw new AppError(400, 'INVALID_STATUS', 'Only draft invoices can be validated');
  }

  const updatedInvoice = await prisma.salesInvoice.update({
    where: { id },
    data: { status: 'VALIDATED' },
  });

  res.json({ data: updatedInvoice, message: 'Invoice validated successfully' });
}));

// POST /api/invoices/:id/post (Post to GL and queue for eTIMS)
router.post('/:id/post', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(invoiceParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  // Phase 4: the ledger is written by the canonical posting engine, which
  // enforces balance, period locks, tenant scoping, sourceKey idempotency and
  // immutable posted journals. The previous handler picked accounts by hardcoded
  // number, created the journal outside the balance update, and allowed a
  // duplicate entry on every re-post.
  const result = await prisma.$transaction((tx) =>
    postSalesInvoice(tx, {
      organizationId: req.user!.organizationId,
      invoiceId: id,
      userId: req.user!.userId,
      ipAddress: req.ip ?? null,
    })
  );

  // eTIMS is a separate compliance pipeline. Posting to the GL only enqueues a
  // submission: POSTED must never be read as "accepted by KRA".
  await prisma.etimsTransmissionQueue.upsert({
    where: { idempotencyKey: id },
    update: {
      status: 'PENDING',
      payloadJson: JSON.stringify({ invoiceId: id }),
      attemptCount: 0,
      lastError: null,
      responseJson: null,
    },
    create: {
      salesInvoiceId: id,
      idempotencyKey: id,
      status: 'PENDING',
      payloadJson: JSON.stringify({ invoiceId: id }),
    },
  });

  res.json({
    data: result.invoice,
    journalEntry: result.journal,
    meta: { created: result.created, idempotentReplay: !result.created },
    message: 'Invoice posted to the general ledger and queued for eTIMS submission',
  });
}));

// DELETE /api/invoices/:id
router.delete('/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(invoiceParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    include: { 
      customer: true, 
      payments: true, 
      creditNotes: true,
      etimsInvoice: true,
      transmissionJobs: true,
    },
  });

  if (!invoice) {
    throw new AppError(404, 'NOT_FOUND', 'Invoice not found');
  }

  if (invoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // A posted invoice is an accounting record: it is never deleted. Correct it
  // with a credit note, or reverse the journal, and keep both on file.
  if (invoice.postedJournalId || invoice.status === 'POSTED') {
    throw new AppError(
      409,
      'INVOICE_IMMUTABLE',
      'A posted invoice cannot be deleted. Issue a credit note instead.'
    );
  }

  if (invoice.payments.length > 0 || invoice.creditNotes.length > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete invoice with payments or credit notes');
  }

  if (invoice.etimsInvoice) {
    throw new AppError(400, 'ETIMS_SUBMITTED', 'Cannot delete invoice submitted to eTIMS');
  }

  // Delete invoice (cascades to items and transmission jobs)
  await prisma.salesInvoice.delete({
    where: { id },
  });

  res.json({ message: 'Invoice deleted successfully' });
}));

export default router;
