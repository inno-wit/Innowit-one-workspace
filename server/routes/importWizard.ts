import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { createImportWizard, LocalStorageData, ImportMappingReport } from '../utils/importWizard';

const router = Router();

const analyzeSchema = z.object({
  localStorageData: z.record(z.any()),
  dryRun: z.boolean().default(true),
});

const executeSchema = z.object({
  localStorageData: z.record(z.any()),
  conflictResolutions: z.record(z.enum(['SKIP', 'UPDATE', 'CREATE_NEW'])),
  dryRun: z.boolean().default(false),
});

const importIdParamsSchema = z.object({
  importId: z.string().uuid('Invalid import ID'),
});

// POST /api/import-wizard/analyze
router.post('/analyze', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateBody(analyzeSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { localStorageData, dryRun } = req.body;

  const { wizard, report } = await createImportWizard(
    req.user!.organizationId,
    req.user!.userId,
    localStorageData as LocalStorageData,
    dryRun
  );

  res.json({ 
    data: report,
    importId: wizard['importId'],
    message: 'Analysis complete. Review conflicts and warnings before executing import.' 
  });
}));

// POST /api/import-wizard/execute
router.post('/execute', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateBody(executeSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { localStorageData, conflictResolutions, dryRun } = req.body;

  const { wizard } = await createImportWizard(
    req.user!.organizationId,
    req.user!.userId,
    localStorageData as LocalStorageData,
    dryRun
  );

  const result = await wizard.executeImport(
    localStorageData as LocalStorageData,
    conflictResolutions
  );

  const statusCode = result.success ? 200 : 400;
  res.status(statusCode).json({ 
    data: result,
    message: result.success 
      ? (dryRun ? 'Dry run completed successfully' : 'Import completed successfully') 
      : 'Import completed with errors',
  });
}));

// GET /api/import-wizard/history
router.get('/history', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const imports = await prisma.auditLog.findMany({
    where: {
      organizationId: req.user!.organizationId,
      action: 'LOCALSTORAGE_IMPORT',
      entityType: 'ImportWizard',
    },
    orderBy: { timestamp: 'desc' },
    take: 20,
  });

  res.json({ data: imports });
}));

// GET /api/import-wizard/:importId
router.get('/:importId', authenticateToken, authorize('SUPER_ADMIN', 'ADMIN'), validateParams(importIdParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { importId } = req.params;

  const importLog = await prisma.auditLog.findFirst({
    where: {
      entityType: 'ImportWizard',
      entityId: importId,
      organizationId: req.user!.organizationId,
    },
  });

  if (!importLog) {
    throw new AppError(404, 'NOT_FOUND', 'Import not found');
  }

  const details = importLog.changesJson ? JSON.parse(importLog.changesJson) : {};

  res.json({ data: { ...importLog, details } });
}));

export default router;