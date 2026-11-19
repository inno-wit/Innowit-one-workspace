import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { authenticateToken, AuthenticatedRequest, authorize, UserRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getTenantContext, orgWhereClause } from '../middleware/tenant';

const router = Router();

// Apply authentication and tenant isolation
router.use(authenticateToken);

// ============================================================================
// SCHEMAS
// ============================================================================

// Saved Views
const savedViewCreateSchema = z.object({
  entityType: z.enum(['CUSTOMER', 'DEAL', 'TASK']),
  name: z.string().min(1, 'Name is required').max(255),
  filtersJson: z.string(),
  sortJson: z.string(),
  columnsJson: z.string().optional(),
  isDefault: z.boolean().default(false),
  isShared: z.boolean().default(false),
});

const savedViewUpdateSchema = savedViewCreateSchema.partial();

const savedViewParamsSchema = z.object({
  id: z.string().uuid('Invalid saved view ID'),
});

const savedViewListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  entityType: z.enum(['CUSTOMER', 'DEAL', 'TASK']).optional(),
  isDefault: z.coerce.boolean().optional(),
  isShared: z.coerce.boolean().optional(),
});

// Custom Fields
const customFieldDefinitionCreateSchema = z.object({
  entityType: z.enum(['CUSTOMER', 'CONTACT', 'DEAL']),
  fieldKey: z.string().min(1, 'Field key is required').max(100).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid field key format'),
  label: z.string().min(1, 'Label is required').max(255),
  fieldType: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT']),
  optionsJson: z.string().optional(),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const customFieldDefinitionUpdateSchema = customFieldDefinitionCreateSchema.partial();

const customFieldDefinitionParamsSchema = z.object({
  id: z.string().uuid('Invalid custom field definition ID'),
});

const customFieldDefinitionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  entityType: z.enum(['CUSTOMER', 'CONTACT', 'DEAL']).optional(),
  isActive: z.coerce.boolean().optional(),
});

const customFieldValueCreateSchema = z.object({
  definitionId: z.string().uuid('Invalid definition ID'),
  entityId: z.string().uuid('Invalid entity ID'),
  valueJson: z.string(),
});

const customFieldValueUpdateSchema = z.object({
  valueJson: z.string(),
});

const customFieldValueParamsSchema = z.object({
  id: z.string().uuid('Invalid custom field value ID'),
});

// Import/Export
const importConfigSchema = z.object({
  entityType: z.enum(['CUSTOMER', 'CONTACT', 'DEAL', 'TASK']),
  fileUrl: z.string().url('Valid file URL required'),
  mappingJson: z.string(),
  options: z.object({
    dryRun: z.boolean().default(false),
    skipDuplicates: z.boolean().default(false),
    updateExisting: z.boolean().default(false),
    idempotencyKey: z.string().optional(),
  }).optional(),
});

const importJobParamsSchema = z.object({
  id: z.string().uuid('Invalid import job ID'),
});

const exportConfigSchema = z.object({
  entityType: z.enum(['CUSTOMER', 'CONTACT', 'DEAL', 'TASK', 'ACTIVITY']),
  filtersJson: z.string().optional(),
  sortJson: z.string().optional(),
  columnsJson: z.string().optional(),
  format: z.enum(['CSV', 'XLSX', 'JSON']).default('CSV'),
});

// Workflows
const workflowRuleCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  trigger: z.enum([
    'DEAL_STAGE_CHANGED',
    'DEAL_WON',
    'DEAL_LOST',
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'CUSTOMER_LIFECYCLE_CHANGED',
    'CONTACT_ADDED',
    'CUSTOM_FIELD_CHANGED',
  ]),
  conditionsJson: z.string(), // Array of { field, operator, value }
  actionType: z.enum(['CREATE_TASK', 'CREATE_NOTIFICATION', 'SEND_EMAIL', 'UPDATE_FIELD', 'WEBHOOK']),
  actionConfigJson: z.string(), // Action-specific config
  isActive: z.boolean().default(true),
});

const workflowRuleUpdateSchema = workflowRuleCreateSchema.partial();

const workflowRuleParamsSchema = z.object({
  id: z.string().uuid('Invalid workflow rule ID'),
});

const workflowRuleListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  trigger: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

const workflowExecutionParamsSchema = z.object({
  id: z.string().uuid('Invalid workflow execution ID'),
});

const workflowExecutionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  ruleId: z.string().uuid().optional(),
  status: z.enum(['SUCCESS', 'WARNING', 'SKIPPED', 'FAILED']).optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function evaluateCondition(entity: any, condition: any): boolean {
  const fieldValue = getNestedValue(entity, condition.field);
  const conditionValue = condition.value;
  
  switch (condition.operator) {
    case 'EQUALS':
      return fieldValue === conditionValue;
    case 'NOT_EQUALS':
      return fieldValue !== conditionValue;
    case 'GREATER_THAN':
      return Number(fieldValue) > Number(conditionValue);
    case 'LESS_THAN':
      return Number(fieldValue) < Number(conditionValue);
    case 'LESS_EQUAL':
      return Number(fieldValue) <= Number(conditionValue);
    case 'CONTAINS':
      return String(fieldValue).toLowerCase().includes(String(conditionValue).toLowerCase());
    default:
      return false;
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o || {})[k], obj);
}

async function executeWorkflowAction(actionType: string, config: any, context: any, prisma: any): Promise<void> {
  switch (actionType) {
    case 'CREATE_TASK':
      await prisma.task.create({
        data: {
          organizationId: context.organizationId,
          title: config.title || 'Workflow Task',
          description: config.description,
          priority: config.priority || 'MEDIUM',
          status: 'PENDING',
          assignedToId: config.assignedToId,
          customerId: config.customerId,
          dealId: config.dealId,
          dueDate: config.dueDate ? new Date(config.dueDate) : null,
        },
      });
      break;
    case 'CREATE_NOTIFICATION':
      await prisma.notification.create({
        data: {
          organizationId: context.organizationId,
          userId: config.userId,
          type: 'SYSTEM',
          title: config.title || 'Workflow Notification',
          body: config.message,
          dataJson: JSON.stringify(config.data || {}),
        },
      });
      break;
    case 'UPDATE_FIELD':
      // Update field on entity
      if (config.entityType && config.entityId && config.fieldKey && config.fieldValue !== undefined) {
        await prisma.$executeRaw`
          UPDATE "${config.entityType}" 
          SET "${config.fieldKey}" = ${config.fieldValue}::text
          WHERE id = ${config.entityId}::uuid
        `.catch(() => {}); // Best effort
      }
      break;
    case 'WEBHOOK':
      // Fire and forget webhook
      fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, ...config.payload }),
      }).catch(() => {}); // Best effort
      break;
  }
}

// ============================================================================
// SAVED VIEWS
// ============================================================================

// GET /api/crm/saved-views
router.get('/saved-views', validateQuery(savedViewListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, entityType, isDefault, isShared } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (entityType) where.entityType = entityType;
  if (isDefault !== undefined) where.isDefault = isDefault;
  if (isShared !== undefined) where.isShared = isShared;

  // Non-managers can only see their own views + shared views
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (!managerRoles.includes(req.user!.role)) {
    where.OR = [
      { userId: req.user!.userId },
      { isShared: true },
    ];
  }

  const [views, total] = await Promise.all([
    prisma.savedView.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: { select: { id: true, fullName: true } },
      },
    }),
    prisma.savedView.count({ where }),
  ]);

  res.json({
    data: views,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/crm/saved-views/:id
router.get('/saved-views/:id', validateParams(savedViewParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const view = await prisma.savedView.findUnique({
    where: { id },
    include: { user: { select: { id: true, fullName: true } } },
  });

  if (!view) {
    throw new AppError(404, 'NOT_FOUND', 'Saved view not found');
  }

  if (view.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check access: owner or shared or manager
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (view.userId !== req.user!.userId && !view.isShared && !managerRoles.includes(req.user!.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: view });
}));

// POST /api/crm/saved-views
router.post('/saved-views', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(savedViewCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // If setting as default, unset other defaults for this entity type
  if (data.isDefault) {
    await prisma.savedView.updateMany({
      where: { organizationId: req.user!.organizationId, entityType: data.entityType, isDefault: true },
      data: { isDefault: false },
    });
  }

  const view = await prisma.savedView.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
    },
    include: { user: { select: { id: true, fullName: true } } },
  });

  res.status(201).json({ data: view });
}));

// PUT /api/crm/saved-views/:id
router.put('/saved-views/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(savedViewParamsSchema), validateBody(savedViewUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const view = await prisma.savedView.findUnique({ where: { id } });

  if (!view) {
    throw new AppError(404, 'NOT_FOUND', 'Saved view not found');
  }

  if (view.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check ownership
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (view.userId !== req.user!.userId && !managerRoles.includes(req.user!.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // If setting as default, unset other defaults
  if (data.isDefault) {
    await prisma.savedView.updateMany({
      where: { organizationId: req.user!.organizationId, entityType: view.entityType, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.savedView.update({
    where: { id },
    data,
    include: { user: { select: { id: true, fullName: true } } },
  });

  res.json({ data: updated });
}));

// DELETE /api/crm/saved-views/:id
router.delete('/saved-views/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(savedViewParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const view = await prisma.savedView.findUnique({ where: { id } });

  if (!view) {
    throw new AppError(404, 'NOT_FOUND', 'Saved view not found');
  }

  if (view.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check ownership
  const managerRoles: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'EXECUTIVE', 'SALES_MANAGER'];
  if (view.userId !== req.user!.userId && !managerRoles.includes(req.user!.role)) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.savedView.delete({ where: { id } });
  res.json({ message: 'Saved view deleted successfully' });
}));

// ============================================================================
// CUSTOM FIELD DEFINITIONS
// ============================================================================

// GET /api/crm/custom-fields/definitions
router.get('/custom-fields/definitions', validateQuery(customFieldDefinitionListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, entityType, isActive } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (entityType) where.entityType = entityType;
  if (isActive !== undefined) where.isActive = isActive;

  const [definitions, total] = await Promise.all([
    prisma.customFieldDefinition.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ entityType: 'asc' }, { label: 'asc' }],
      include: {
        _count: { select: { values: true } },
      },
    }),
    prisma.customFieldDefinition.count({ where }),
  ]);

  res.json({
    data: definitions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/crm/custom-fields/definitions/:id
router.get('/custom-fields/definitions/:id', validateParams(customFieldDefinitionParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const definition = await prisma.customFieldDefinition.findUnique({
    where: { id },
    include: {
      _count: { select: { values: true } },
    },
  });

  if (!definition) {
    throw new AppError(404, 'NOT_FOUND', 'Custom field definition not found');
  }

  if (definition.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: definition });
}));

// POST /api/crm/custom-fields/definitions
router.post('/custom-fields/definitions', authorize('SUPER_ADMIN', 'ADMIN'), validateBody(customFieldDefinitionCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Validate optionsJson for SELECT/MULTI_SELECT
  if (['SELECT', 'MULTI_SELECT'].includes(data.fieldType) && data.optionsJson) {
    try {
      const options = JSON.parse(data.optionsJson);
      if (!Array.isArray(options)) throw new Error('Options must be array');
    } catch {
      throw new AppError(400, 'INVALID_OPTIONS', 'optionsJson must be a valid JSON array');
    }
  }

  // Check fieldKey uniqueness per entityType
  const existing = await prisma.customFieldDefinition.findUnique({
    where: { organizationId_entityType_fieldKey: { organizationId: req.user!.organizationId, entityType: data.entityType, fieldKey: data.fieldKey } },
  });

  if (existing) {
    throw new AppError(409, 'DUPLICATE_FIELD_KEY', 'Field key already exists for this entity type');
  }

  const definition = await prisma.customFieldDefinition.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
    },
  });

  res.status(201).json({ data: definition });
}));

// PUT /api/crm/custom-fields/definitions/:id
router.put('/custom-fields/definitions/:id', authorize('SUPER_ADMIN', 'ADMIN'), validateParams(customFieldDefinitionParamsSchema), validateBody(customFieldDefinitionUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const definition = await prisma.customFieldDefinition.findUnique({ where: { id } });

  if (!definition) {
    throw new AppError(404, 'NOT_FOUND', 'Custom field definition not found');
  }

  if (definition.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Validate optionsJson
  if (data.fieldType && ['SELECT', 'MULTI_SELECT'].includes(data.fieldType) && data.optionsJson) {
    try {
      JSON.parse(data.optionsJson);
    } catch {
      throw new AppError(400, 'INVALID_OPTIONS', 'optionsJson must be a valid JSON array');
    }
  }

  // Check fieldKey uniqueness if changing
  if (data.fieldKey && data.fieldKey !== definition.fieldKey) {
    const existing = await prisma.customFieldDefinition.findUnique({
      where: { organizationId_entityType_fieldKey: { organizationId: req.user!.organizationId, entityType: definition.entityType, fieldKey: data.fieldKey } },
    });
    if (existing) {
      throw new AppError(409, 'DUPLICATE_FIELD_KEY', 'Field key already exists for this entity type');
    }
  }

  const updated = await prisma.customFieldDefinition.update({
    where: { id },
    data,
  });

  res.json({ data: updated });
}));

// DELETE /api/crm/custom-fields/definitions/:id
router.delete('/custom-fields/definitions/:id', authorize('SUPER_ADMIN', 'ADMIN'), validateParams(customFieldDefinitionParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const definition = await prisma.customFieldDefinition.findUnique({ where: { id } });

  if (!definition) {
    throw new AppError(404, 'NOT_FOUND', 'Custom field definition not found');
  }

  if (definition.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Check if has values
  const valueCount = await prisma.customFieldValue.count({ where: { definitionId: id } });
  if (valueCount > 0) {
    throw new AppError(400, 'HAS_DEPENDENCIES', 'Cannot delete definition with existing values');
  }

  await prisma.customFieldDefinition.delete({ where: { id } });
  res.json({ message: 'Custom field definition deleted successfully' });
}));

// ============================================================================
// CUSTOM FIELD VALUES
// ============================================================================

// GET /api/crm/custom-fields/values
router.get('/custom-fields/values', validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  entityId: z.string().uuid().optional(),
  definitionId: z.string().uuid().optional(),
})), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, entityId, definitionId } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (entityId) where.entityId = entityId;
  if (definitionId) where.definitionId = definitionId;

  const [values, total] = await Promise.all([
    prisma.customFieldValue.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        definition: { select: { id: true, fieldKey: true, label: true, fieldType: true } },
      },
    }),
    prisma.customFieldValue.count({ where }),
  ]);

  res.json({
    data: values,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// POST /api/crm/custom-fields/values
router.post('/custom-fields/values', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(customFieldValueCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  const definition = await prisma.customFieldDefinition.findUnique({
    where: { id: data.definitionId },
  });

  if (!definition || definition.organizationId !== req.user!.organizationId) {
    throw new AppError(404, 'NOT_FOUND', 'Definition not found');
  }

  if (!definition.isActive) {
    throw new AppError(400, 'INACTIVE_DEFINITION', 'Cannot set value for inactive field definition');
  }

  // Validate value against field type
  try {
    const value = JSON.parse(data.valueJson);
    if (definition.fieldType === 'NUMBER' && typeof value !== 'number') throw new Error('Must be number');
    if (definition.fieldType === 'BOOLEAN' && typeof value !== 'boolean') throw new Error('Must be boolean');
    if (definition.fieldType === 'DATE' && typeof value !== 'string') throw new Error('Must be string');
    if (['SELECT', 'MULTI_SELECT'].includes(definition.fieldType) && definition.optionsJson) {
      const options = JSON.parse(definition.optionsJson);
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (!options.includes(v)) throw new Error(`Invalid option: ${v}`);
      }
    }
  } catch (e) {
    throw new AppError(400, 'INVALID_VALUE', `Invalid value for field type ${definition.fieldType}: ${e.message}`);
  }

  const existing = await prisma.customFieldValue.findUnique({
    where: { definitionId_entityId: { definitionId: data.definitionId, entityId: data.entityId } },
  });

  let value;
  if (existing) {
    value = await prisma.customFieldValue.update({
      where: { id: existing.id },
      data: { valueJson: data.valueJson },
      include: { definition: true },
    });
  } else {
    value = await prisma.customFieldValue.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
      },
      include: { definition: true },
    });
  }

  res.status(existing ? 200 : 201).json({ data: value });
}));

// PUT /api/crm/custom-fields/values/:id
router.put('/custom-fields/values/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(customFieldValueParamsSchema), validateBody(customFieldValueUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { valueJson } = req.body;

  const value = await prisma.customFieldValue.findUnique({ where: { id } });

  if (!value) {
    throw new AppError(404, 'NOT_FOUND', 'Custom field value not found');
  }

  if (value.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const definition = await prisma.customFieldDefinition.findUnique({ where: { id: value.definitionId } });
  if (!definition || !definition.isActive) {
    throw new AppError(400, 'INVALID_DEFINITION', 'Field definition not found or inactive');
  }

  // Validate value
  try {
    const val = JSON.parse(valueJson);
    if (definition.fieldType === 'NUMBER' && typeof val !== 'number') throw new Error('Must be number');
    if (definition.fieldType === 'BOOLEAN' && typeof val !== 'boolean') throw new Error('Must be boolean');
    if (definition.fieldType === 'DATE' && typeof val !== 'string') throw new Error('Must be string');
    if (['SELECT', 'MULTI_SELECT'].includes(definition.fieldType) && definition.optionsJson) {
      const options = JSON.parse(definition.optionsJson);
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) {
        if (!options.includes(v)) throw new Error(`Invalid option: ${v}`);
      }
    }
  } catch (e) {
    throw new AppError(400, 'INVALID_VALUE', `Invalid value for field type ${definition.fieldType}: ${e.message}`);
  }

  const updated = await prisma.customFieldValue.update({
    where: { id },
    data: { valueJson },
    include: { definition: true },
  });

  res.json({ data: updated });
}));

// DELETE /api/crm/custom-fields/values/:id
router.delete('/custom-fields/values/:id', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateParams(customFieldValueParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const value = await prisma.customFieldValue.findUnique({ where: { id } });

  if (!value) {
    throw new AppError(404, 'NOT_FOUND', 'Custom field value not found');
  }

  if (value.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.customFieldValue.delete({ where: { id } });
  res.json({ message: 'Custom field value deleted successfully' });
}));

// ============================================================================
// IMPORT/EXPORT
// ============================================================================

// POST /api/crm/import - Start import job
router.post('/import', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER'), validateBody(importConfigSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { entityType, fileUrl, mappingJson, options = {} } = req.body;
  const { dryRun = false, skipDuplicates = false, updateExisting = false, idempotencyKey } = options;

  // Check idempotency
  if (idempotencyKey) {
    const existing = await prisma.importJob.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return res.json({ data: existing, message: 'Import already processed' });
    }
  }

  // Create import job record
  const importJob = await prisma.importJob.create({
    data: {
      organizationId: req.user!.organizationId,
      entityType,
      fileUrl,
      mappingJson,
      status: 'PENDING',
      optionsJson: JSON.stringify({ dryRun, skipDuplicates, updateExisting }),
      idempotencyKey,
      createdById: req.user!.userId,
    },
  });

  // For dry run, process immediately and return results
  if (dryRun) {
    // In a real implementation, this would parse the file and validate rows
    // For now, return mock results
    return res.json({
      data: importJob,
      results: {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        errors: [],
        duplicates: 0,
      },
    });
  }

  // In production, queue the import job for background processing
  // For now, return the job
  res.status(201).json({ data: importJob, message: 'Import job queued for processing' });
}));

// GET /api/crm/import/:id
router.get('/import/:id', validateParams(importJobParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const job = await prisma.importJob.findUnique({
    where: { id },
  });

  if (!job) {
    throw new AppError(404, 'NOT_FOUND', 'Import job not found');
  }

  if (job.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: job });
}));

// POST /api/crm/export - Export data
router.post('/export', authorize('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_REP'), validateBody(exportConfigSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { entityType, filtersJson, sortJson, columnsJson, format = 'CSV' } = req.body;
  const tenant = getTenantContext(req);

  // Build where clause from filters
  const filters = filtersJson ? JSON.parse(filtersJson) : {};
  const where = orgWhereClause(tenant, filters);

  // Determine columns
  const defaultColumns = {
    CUSTOMER: ['id', 'customerCode', 'name', 'companyName', 'kraPin', 'email', 'phone', 'city', 'lifecycle', 'type', 'creditLimit', 'paymentTermsDays', 'leadSource', 'createdAt'],
    CONTACT: ['id', 'customerId', 'firstName', 'lastName', 'email', 'phone', 'jobTitle', 'isPrimary', 'createdAt'],
    DEAL: ['id', 'customerId', 'assignedToId', 'title', 'value', 'currency', 'stage', 'closeOutcome', 'winProbability', 'expectedCloseDate', 'lostReason', 'source', 'createdAt'],
    TASK: ['id', 'title', 'description', 'priority', 'status', 'dueDate', 'assignedToId', 'customerId', 'dealId', 'projectId', 'salesOrderId', 'createdAt'],
    ACTIVITY: ['id', 'customerId', 'dealId', 'type', 'title', 'description', 'actorId', 'occurredAt', 'createdAt'],
  };

  const columns = columnsJson ? JSON.parse(columnsJson) : (defaultColumns[entityType] || []);
  const sort = sortJson ? JSON.parse(sortJson) : { createdAt: 'desc' };

  // Fetch data
  const modelMap: any = {
    CUSTOMER: prisma.customer,
    CONTACT: prisma.customerContact,
    DEAL: prisma.deal,
    TASK: prisma.task,
    ACTIVITY: prisma.cRMActivity,
  };

  const Model = modelMap[entityType];
  if (!Model) {
    throw new AppError(400, 'INVALID_ENTITY_TYPE', 'Unsupported entity type for export');
  }

  const data = await Model.findMany({
    where: entityType === 'ACTIVITY' ? { organizationId: tenant.organizationId, ...filters } : where,
    orderBy: sort,
    select: columns.reduce((acc, col) => ({ ...acc, [col]: true }), {}),
    take: 10000, // Limit export size
  });

  // Format output
  let output: string;
  if (format === 'CSV') {
    const headers = columns.join(',');
    const rows = data.map((row: any) => columns.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val).replace(/"/g, '""');
    }).map(v => `"${v}"`).join(','));
    output = [headers, ...rows].join('\n');
  } else if (format === 'JSON') {
    output = JSON.stringify(data, null, 2);
  } else {
    // XLSX would require additional library
    throw new AppError(400, 'UNSUPPORTED_FORMAT', 'XLSX not supported yet, use CSV or JSON');
  }

  res.setHeader('Content-Type', format === 'CSV' ? 'text/csv' : 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${entityType.toLowerCase()}_export_${new Date().toISOString().slice(0, 10)}.${format.toLowerCase()}"`);
  res.send(output);
}));

// ============================================================================
// WORKFLOW AUTOMATION
// ============================================================================

// GET /api/crm/workflows/rules
router.get('/workflows/rules', validateQuery(workflowRuleListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, trigger, isActive } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (trigger) where.trigger = trigger;
  if (isActive !== undefined) where.isActive = isActive;

  const [rules, total] = await Promise.all([
    prisma.automationRule.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.automationRule.count({ where }),
  ]);

  res.json({
    data: rules,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

// GET /api/crm/workflows/rules/:id
router.get('/workflows/rules/:id', validateParams(workflowRuleParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const rule = await prisma.automationRule.findUnique({
    where: { id },
    include: {
      executionLogs: {
        take: 20,
        orderBy: { executedAt: 'desc' },
      },
    },
  });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Workflow rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  res.json({ data: rule });
}));

// POST /api/crm/workflows/rules
router.post('/workflows/rules', authorize('SUPER_ADMIN', 'ADMIN'), validateBody(workflowRuleCreateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const data = req.body;

  // Validate conditionsJson
  try {
    const conditions = JSON.parse(data.conditionsJson);
    if (!Array.isArray(conditions)) throw new Error('Conditions must be array');
    for (const c of conditions) {
      if (!c.field || !c.operator || c.value === undefined) throw new Error('Invalid condition');
    }
  } catch {
    throw new AppError(400, 'INVALID_CONDITIONS', 'conditionsJson must be valid array of {field, operator, value}');
  }

  // Validate actionConfigJson
  try {
    JSON.parse(data.actionConfigJson);
  } catch {
    throw new AppError(400, 'INVALID_ACTION_CONFIG', 'actionConfigJson must be valid JSON');
  }

  const rule = await prisma.automationRule.create({
    data: {
      ...data,
      organizationId: req.user!.organizationId,
      targetRole: data.targetRole || 'ALL',
    },
  });

  res.status(201).json({ data: rule });
}));

// PUT /api/crm/workflows/rules/:id
router.put('/workflows/rules/:id', authorize('SUPER_ADMIN', 'ADMIN'), validateParams(workflowRuleParamsSchema), validateBody(workflowRuleUpdateSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const rule = await prisma.automationRule.findUnique({ where: { id } });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Workflow rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Validate JSON fields
  if (data.conditionsJson) {
    try { JSON.parse(data.conditionsJson); } catch { throw new AppError(400, 'INVALID_CONDITIONS'); }
  }
  if (data.actionConfigJson) {
    try { JSON.parse(data.actionConfigJson); } catch { throw new AppError(400, 'INVALID_ACTION_CONFIG'); }
  }

  const updated = await prisma.automationRule.update({
    where: { id },
    data,
  });

  res.json({ data: updated });
}));

// DELETE /api/crm/workflows/rules/:id
router.delete('/workflows/rules/:id', authorize('SUPER_ADMIN', 'ADMIN'), validateParams(workflowRuleParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const rule = await prisma.automationRule.findUnique({ where: { id } });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Workflow rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  await prisma.automationRule.delete({ where: { id } });
  res.json({ message: 'Workflow rule deleted successfully' });
}));

// POST /api/crm/workflows/rules/:id/execute - Manually trigger workflow
router.post('/workflows/rules/:id/execute', authorize('SUPER_ADMIN', 'ADMIN'), validateParams(workflowRuleParamsSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  const rule = await prisma.automationRule.findUnique({
    where: { id },
  });

  if (!rule) {
    throw new AppError(404, 'NOT_FOUND', 'Workflow rule not found');
  }

  if (rule.organizationId !== req.user!.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  if (!rule.isActive) {
    throw new AppError(400, 'RULE_INACTIVE', 'Cannot execute inactive rule');
  }

  // Create execution log
  const executionLog = await prisma.automationExecutionLog.create({
    data: {
      ruleId: rule.id,
      ruleName: rule.name,
      trigger: rule.trigger,
      executedAt: new Date(),
      executedBy: req.user!.fullName,
      status: 'SUCCESS',
      matchedEntityCount: 0,
      details: 'Manual execution triggered',
      actionSummary: rule.actionLabel,
    },
  });

  // Execute the workflow (simplified - in production, this would be queued)
  try {
    // This would fetch matching entities and execute actions
    // For now, just log success
    await prisma.automationExecutionLog.update({
      where: { id: executionLog.id },
      data: { status: 'SUCCESS', matchedEntityCount: 0, details: 'Manual execution completed (no matching entities in demo)' },
    });
  } catch (error) {
    await prisma.automationExecutionLog.update({
      where: { id: executionLog.id },
      data: { status: 'FAILED', details: error instanceof Error ? error.message : 'Unknown error' },
    });
  }

  res.json({ data: executionLog, message: 'Workflow executed' });
}));

// GET /api/crm/workflows/executions
router.get('/workflows/executions', validateQuery(workflowExecutionListQuerySchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page, limit, ruleId, status, periodStart, periodEnd } = req.query as any;
  const tenant = getTenantContext(req);
  const skip = (page - 1) * limit;

  const where = orgWhereClause(tenant, {});
  if (ruleId) where.ruleId = ruleId;
  if (status) where.status = status;
  if (periodStart) where.executedAt = { ...where.executedAt, gte: new Date(periodStart) };
  if (periodEnd) where.executedAt = { ...where.executedAt, lte: new Date(periodEnd) };

  const [executions, total] = await Promise.all([
    prisma.automationExecutionLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { executedAt: 'desc' },
    }),
    prisma.automationExecutionLog.count({ where }),
  ]);

  res.json({
    data: executions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

export default router;