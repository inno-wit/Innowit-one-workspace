import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { decrypt, encrypt } from '../utils/encryption';

const router = Router();

const createEtimsConfigSchema = z.object({
  mode: z.enum(['OSCU', 'VSCU']).default('OSCU'),
  environment: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  taxpayerPin: z.string().min(1, 'Taxpayer PIN is required'),
  branchCode: z.string().default('00'),
  deviceSerial: z.string().optional(),
  clientSecret: z.string().min(1, 'Client secret is required'),
  apiUrl: z.string().url('Invalid API URL'),
});

const updateEtimsConfigSchema = createEtimsConfigSchema.partial();

const etimsParamsSchema = z.object({
  id: z.string().uuid('Invalid eTIMS config ID'),
});

const transmissionQueueParamsSchema = z.object({
  id: z.string().uuid('Invalid queue ID'),
});

const listQueueSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'IN_FLIGHT', 'ACCEPTED', 'REJECTED', 'RETRY_SCHEDULED', 'CANCELLED']).optional(),
  invoiceId: z.string().uuid().optional(),
});

// GET /api/etims/config
router.get('/config', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const configs = await prisma.etimsConfiguration.findMany({
    where: { organizationId: req.user!.organizationId },
    orderBy: { createdAt: 'desc' },
  });

  // Don't return decrypted secrets
  const safeConfigs = configs.map(config => ({
    ...config,
    clientSecretEnc: '[ENCRYPTED]',
  }));

  res.json({ data: safeConfigs });
}));

// GET /api/etims/config/:id
router.get('/config/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(etimsParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const config = await prisma.etimsConfiguration.findUnique({
    where: { id },
  });

  if (!config) {
    throw new AppError(404, 'NOT_FOUND', 'eTIMS configuration not found');
  }

  if (config.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ 
    data: {
      ...config,
      clientSecretEnc: '[ENCRYPTED]',
    } 
  });
}));

// POST /api/etims/config
router.post('/config', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateBody(createEtimsConfigSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Check if config already exists for this org/environment
  const existing = await prisma.etimsConfiguration.findUnique({
    where: {
      organizationId_environment: {
        organizationId: req.user!.organizationId,
        environment: data.environment,
      },
    },
  });

  if (existing) {
    throw new AppError(409, 'CONFIG_EXISTS', `eTIMS configuration for ${data.environment} already exists`);
  }

  // Encrypt client secret (audit fix ETIMS-5: `require` is not defined in the
  // ESM-compiled route — use a top-level import; also stop spreading the raw
  // `clientSecret` field into the Prisma payload, which has no such column).
  const clientSecretEnc = encrypt(data.clientSecret);

  const config = await prisma.etimsConfiguration.create({
    data: {
      mode: data.mode,
      environment: data.environment,
      taxpayerPin: data.taxpayerPin,
      branchCode: data.branchCode,
      deviceSerial: data.deviceSerial,
      apiUrl: data.apiUrl,
      clientSecretEnc,
      organizationId: req.user!.organizationId,
    },
  });

  res.status(201).json({ 
    data: { ...config, clientSecretEnc: '[ENCRYPTED]' },
    message: 'eTIMS configuration created successfully' 
  });
}));

// PUT /api/etims/config/:id
router.put('/config/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(etimsParamsSchema), validateBody(updateEtimsConfigSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const config = await prisma.etimsConfiguration.findUnique({
    where: { id },
  });

  if (!config) {
    throw new AppError(404, 'NOT_FOUND', 'eTIMS configuration not found');
  }

  if (config.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const updateData: any = {
    mode: data.mode,
    environment: data.environment,
    taxpayerPin: data.taxpayerPin,
    branchCode: data.branchCode,
    deviceSerial: data.deviceSerial,
    apiUrl: data.apiUrl,
  };
  Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);

  if (data.clientSecret) {
    // audit fix ETIMS-5: import-based encrypt instead of CJS require
    updateData.clientSecretEnc = encrypt(data.clientSecret);
  }

  const updatedConfig = await prisma.etimsConfiguration.update({
    where: { id },
    data: updateData,
  });

  res.json({ 
    data: { ...updatedConfig, clientSecretEnc: '[ENCRYPTED]' },
    message: 'eTIMS configuration updated successfully' 
  });
}));

// POST /api/etims/config/:id/test (Test connection)
router.post('/config/:id/test', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(etimsParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const config = await prisma.etimsConfiguration.findUnique({
    where: { id },
  });

  if (!config) {
    throw new AppError(404, 'NOT_FOUND', 'eTIMS configuration not found');
  }

  if (config.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Decrypt client secret
  const clientSecret = decrypt(config.clientSecretEnc);

  // Test connection to eTIMS API (simplified)
  try {
    const response = await fetch(`${config.apiUrl}/ping`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${clientSecret}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      await prisma.etimsConfiguration.update({
        where: { id },
        data: { isCertified: true },
      });
      res.json({ success: true, message: 'Connection test successful' });
    } else {
      res.json({ success: false, message: `Connection failed: ${response.status}` });
    }
  } catch (error) {
    res.json({ success: false, message: `Connection error: ${(error as Error).message}` });
  }
}));

// GET /api/etims/queue
router.get('/queue', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateQuery(listQueueSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, status, invoiceId } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    salesInvoice: { customer: { organizationId: req.user!.organizationId } },
  };

  if (status) where.status = status;
  if (invoiceId) where.salesInvoiceId = invoiceId;

  const [queue, total] = await Promise.all([
    prisma.etimsTransmissionQueue.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        salesInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            customer: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.etimsTransmissionQueue.count({ where }),
  ]);

  res.json({
    data: queue,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/etims/queue/:id
router.get('/queue/:id', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateParams(transmissionQueueParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const queueItem = await prisma.etimsTransmissionQueue.findUnique({
    where: { id },
    include: {
      salesInvoice: {
        include: {
          customer: { select: { id: true, name: true, customerCode: true, kraPin: true } },
          branch: { select: { id: true, name: true } },
          items: { include: { product: true } },
        },
      },
    },
  });

  if (!queueItem) {
    throw new AppError(404, 'NOT_FOUND', 'Queue item not found');
  }

  if (queueItem.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: queueItem });
}));

// POST /api/etims/queue/:id/retry
router.post('/queue/:id/retry', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(transmissionQueueParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const queueItem = await prisma.etimsTransmissionQueue.findUnique({
    where: { id },
    include: { salesInvoice: { include: { customer: true } } },
  });

  if (!queueItem) {
    throw new AppError(404, 'NOT_FOUND', 'Queue item not found');
  }

  if (queueItem.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Reset for retry
  await prisma.etimsTransmissionQueue.update({
    where: { id },
    data: {
      status: 'PENDING',
      nextRetryAt: new Date(),
      lastError: null,
    },
  });

  res.json({ message: 'Queue item reset for retry' });
}));

// POST /api/etims/queue/:id/cancel
router.post('/queue/:id/cancel', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'), validateParams(transmissionQueueParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const queueItem = await prisma.etimsTransmissionQueue.findUnique({
    where: { id },
    include: { salesInvoice: { include: { customer: true } } },
  });

  if (!queueItem) {
    throw new AppError(404, 'NOT_FOUND', 'Queue item not found');
  }

  if (queueItem.salesInvoice.customer.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.etimsTransmissionQueue.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  res.json({ message: 'Queue item cancelled' });
}));

// GET /api/etims/invoices (eTIMS submitted invoices)
router.get('/invoices', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, search } = req.query as any;
  const skip = (page - 1) * limit;

  const where: any = {
    salesInvoice: { customer: { organizationId: req.user!.organizationId } },
  };

  if (search) {
    where.OR = [
      { kraControlNumber: { contains: search, mode: 'insensitive' } },
      { salesInvoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [etimsInvoices, total] = await Promise.all([
    prisma.etimsInvoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { submissionDate: 'desc' },
      include: {
        salesInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            totalAmount: true,
            customer: { select: { id: true, name: true, customerCode: true } },
          },
        },
      },
    }),
    prisma.etimsInvoice.count({ where }),
  ]);

  res.json({
    data: etimsInvoices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}));

// GET /api/etims/stats
router.get('/stats', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const [pending, inFlight, accepted, rejected, retryScheduled, cancelled] = await Promise.all([
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'PENDING',
      },
    }),
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'IN_FLIGHT',
      },
    }),
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'ACCEPTED',
      },
    }),
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'REJECTED',
      },
    }),
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'RETRY_SCHEDULED',
      },
    }),
    prisma.etimsTransmissionQueue.count({
      where: { 
        salesInvoice: { customer: { organizationId: req.user!.organizationId } },
        status: 'CANCELLED',
      },
    }),
  ]);

  const totalInvoices = await prisma.etimsInvoice.count({
    where: { salesInvoice: { customer: { organizationId: req.user!.organizationId } } },
  });

  res.json({
    data: {
      queue: {
        pending,
        inFlight,
        accepted,
        rejected,
        retryScheduled,
        cancelled,
        total: pending + inFlight + accepted + rejected + retryScheduled + cancelled,
      },
      totalEtimsInvoices: totalInvoices,
    },
  });
}));

export default router;