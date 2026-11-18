import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { prisma } from './prisma';
import { initializeRealtimeGateway } from './services/realtime/RealtimeGateway';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || 'localhost';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3002';

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Disable for development
}));

// CORS configuration
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Request logging (development)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// Health check endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: '1.0.0',
  });
});

// Readiness check endpoint (verifies DB connection)
app.get('/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: process.env.NODE_ENV === 'production' ? undefined : (error as Error).message,
    });
  }
});

// API routes (protected)
const apiRouter = express.Router();

// NOTE (audit fix AUTH-0): the previous blanket `apiRouter.use(authenticateToken)`
// sat BEFORE the route mounts, including `/auth`, which made `POST /auth/login`
// and `POST /auth/refresh` unreachable (they demanded a Bearer token to log in).
// Authentication is enforced per-endpoint by every route chain
// (`authenticateToken` / `authorize`), and `/auth/logout` is intentionally
// token-optional. Do not re-add a router-level auth gate above the mounts.
// (The `authenticateToken` import was removed with it — every route imports it
// from middleware/auth directly.)

// Import and mount route handlers
import authRoutes from './routes/auth';
import organizationRoutes from './routes/organizations';
import userRoutes from './routes/users';
import branchRoutes from './routes/branches';
import customerRoutes from './routes/customers';
import dealRoutes from './routes/deals';
import taskRoutes from './routes/tasks';
import accountRoutes from './routes/accounts';
import journalRoutes from './routes/journal';
import productRoutes from './routes/products';
import warehouseRoutes from './routes/warehouses';
import inventoryRoutes from './routes/inventory';
import salesOrderRoutes from './routes/salesOrders';
import quotationRoutes from './routes/quotations';
import invoiceRoutes from './routes/invoices';
import paymentRoutes from './routes/payments';
import creditNoteRoutes from './routes/creditNotes';
import etimsRoutes from './routes/etims';
import supplierRoutes from './routes/suppliers';
import purchaseOrderRoutes from './routes/purchaseOrders';
import departmentRoutes from './routes/departments';
import employeeRoutes from './routes/employees';
import payrollRoutes from './routes/payroll';
import channelRoutes from './routes/channels';
import messageRoutes from './routes/messages';
import conversationRoutes from './routes/conversations';
import notificationRoutes from './routes/notifications';
import attachmentRoutes from './routes/attachments';
import meetingRoutes from './routes/meetings';
import auditRoutes from './routes/audit';
import importWizardRoutes from './routes/importWizard';

apiRouter.use('/auth', authRoutes);
apiRouter.use('/organizations', organizationRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/branches', branchRoutes);
apiRouter.use('/customers', customerRoutes);
apiRouter.use('/deals', dealRoutes);
apiRouter.use('/tasks', taskRoutes);
apiRouter.use('/accounts', accountRoutes);
apiRouter.use('/journal', journalRoutes);
apiRouter.use('/products', productRoutes);
apiRouter.use('/warehouses', warehouseRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/sales-orders', salesOrderRoutes);
apiRouter.use('/quotations', quotationRoutes);
apiRouter.use('/invoices', invoiceRoutes);
apiRouter.use('/payments', paymentRoutes);
apiRouter.use('/credit-notes', creditNoteRoutes);
apiRouter.use('/etims', etimsRoutes);
apiRouter.use('/suppliers', supplierRoutes);
apiRouter.use('/purchase-orders', purchaseOrderRoutes);
apiRouter.use('/departments', departmentRoutes);
apiRouter.use('/employees', employeeRoutes);
apiRouter.use('/payroll', payrollRoutes);
apiRouter.use('/channels', channelRoutes);
apiRouter.use('/messages', messageRoutes);
apiRouter.use('/conversations', conversationRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/attachments', attachmentRoutes);
apiRouter.use('/meetings', meetingRoutes);
apiRouter.use('/audit', auditRoutes);
apiRouter.use('/import-wizard', importWizardRoutes);

app.use('/api', apiRouter);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const realtimeGateway = initializeRealtimeGateway(httpServer);
console.log('🔌 Socket.IO server initialized');

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  realtimeGateway.getIO().close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`🚀 Innowit One API server running on http://${HOST}:${PORT}`);
  console.log(`   Health: http://${HOST}:${PORT}/health`);
  console.log(`   Ready:  http://${HOST}:${PORT}/ready`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
});

export default app;