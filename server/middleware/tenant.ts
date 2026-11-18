import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { AuthenticatedRequest, UserRole } from './auth';
import { AppError } from './errorHandler';

/**
 * Centralized tenant isolation enforcement.
 * 
 * Replaces the no-op requireOrganizationAccess with proper enforcement of:
 * - Organization ownership on all resources
 * - Branch-level access control
 * - Nested resource ownership verification
 * - Protection against manipulated IDs
 * - Protection against client-supplied organizationId
 * - Cross-organization read, create, update, delete prevention
 */

// Roles that can access data across branches within their organization
export const CROSS_BRANCH_ROLES: UserRole[] = [
  'SUPER_ADMIN', 
  'ADMIN', 
  'EXECUTIVE', 
  'FINANCE_MANAGER', 
  'ACCOUNTANT'
];

// Roles that can manage organization-level settings
export const ORG_ADMIN_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'ADMIN'
];

export interface TenantContext {
  organizationId: string;
  branchId: string | null;
  userRole: UserRole;
  canAccessAllBranches: boolean;
  isOrgAdmin: boolean;
}

/**
 * Extract tenant context from authenticated request
 */
export function getTenantContext(req: AuthenticatedRequest): TenantContext {
  if (!req.user) {
    throw new Error('Authentication required');
  }

  return {
    organizationId: req.user.organizationId,
    branchId: req.user.branchId ?? null,
    userRole: req.user.role,
    canAccessAllBranches: CROSS_BRANCH_ROLES.includes(req.user.role),
    isOrgAdmin: ORG_ADMIN_ROLES.includes(req.user.role),
  };
}

/**
 * Middleware that enforces organization-scoped access on all subsequent route handlers.
 * This replaces the no-op requireOrganizationAccess.
 * 
 * Usage: router.use(enforceTenantIsolation)
 * Then in route handlers, use getTenantContext(req) to get the scoped context.
 */
export function enforceTenantIsolation(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  // Attach tenant context to request for downstream use
  (req as any).tenant = getTenantContext(req);
  
  next();
}

/**
 * Verify that a resource belongs to the user's organization.
 * Throws AppError if not found or access denied.
 */
export async function verifyOrgOwnership<T extends { organizationId: string }>(
  req: AuthenticatedRequest,
  resource: T | null,
  resourceName: string = 'Resource'
): Promise<T> {
  const tenant = getTenantContext(req);
  
  if (!resource) {
    throw new AppError(404, 'NOT_FOUND', `${resourceName} not found`);
  }
  
  if (resource.organizationId !== tenant.organizationId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }
  
  return resource;
}

/**
 * Verify branch access for resources that have a branchId.
 * Users with cross-branch roles can access any branch in their org.
 * Other users can only access their assigned branch.
 */
export async function verifyBranchAccess<T extends { branchId: string; organizationId: string }>(
  req: AuthenticatedRequest,
  resource: T | null,
  resourceName: string = 'Resource'
): Promise<T> {
  const tenant = getTenantContext(req);
  
  const verified = await verifyOrgOwnership(req, resource, resourceName);
  
  if (!tenant.canAccessAllBranches && tenant.branchId && verified.branchId !== tenant.branchId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied to this branch');
  }
  
  return verified;
}

/**
 * Build a Prisma where clause that enforces organization scoping.
 * Use this for list queries to ensure tenant isolation at the database level.
 */
export function orgWhereClause(tenant: TenantContext, additionalWhere: Record<string, any> = {}): Record<string, any> {
  return {
    organizationId: tenant.organizationId,
    ...additionalWhere,
  };
}

/**
 * Build a Prisma where clause that enforces both organization and branch scoping.
 */
export function branchWhereClause(tenant: TenantContext, additionalWhere: Record<string, any> = {}): Record<string, any> {
  const where: Record<string, any> = {
    organizationId: tenant.organizationId,
    ...additionalWhere,
  };
  
  if (!tenant.canAccessAllBranches && tenant.branchId) {
    where.branchId = tenant.branchId;
  }
  
  return where;
}

/**
 * Verify that a nested resource (e.g., invoice item, order item) belongs to the user's organization
 * by checking its parent resource's organizationId.
 */
export async function verifyNestedResourceOwnership(
  req: AuthenticatedRequest,
  parentResource: { organizationId: string } | null,
  resourceName: string = 'Parent resource'
): Promise<void> {
  await verifyOrgOwnership(req, parentResource, resourceName);
}

/**
 * Sanitize create input to prevent client-supplied organizationId.
 * Always overrides any client-provided organizationId with the authenticated user's organizationId.
 */
export function sanitizeCreateInput<T extends Record<string, any>>(
  req: AuthenticatedRequest,
  input: T
): T & { organizationId: string } {
  const tenant = getTenantContext(req);
  
  // Remove any client-supplied organizationId
  const { organizationId: _ignored, ...sanitized } = input;
  
  return {
    ...sanitized,
    organizationId: tenant.organizationId,
  } as T & { organizationId: string };
}

/**
 * Sanitize update input to prevent client-supplied organizationId changes.
 * Removes organizationId from update payload entirely.
 */
export function sanitizeUpdateInput<T extends Record<string, any>>(
  input: T
): Omit<T, 'organizationId'> {
  // Remove any client-supplied organizationId
  const { organizationId: _ignored, ...sanitized } = input;
  
  return sanitized;
}

/**
 * Middleware factory for verifying ownership of a specific resource by ID.
 * Usage: router.get('/:id', verifyResourceOwnership('SalesInvoice', prisma.salesInvoice), handler)
 */
export function verifyResourceOwnership<TModel extends { organizationId: string }>(
  modelName: string,
  findUnique: (id: string) => Promise<TModel | null>
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({ error: 'Resource ID required', code: 'MISSING_ID' });
        return;
      }
      
      const resource = await findUnique(id);
      await verifyOrgOwnership(req, resource, modelName);
      
      // Attach verified resource to request for downstream use
      (req as any).verifiedResource = resource;
      next();
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
      } else {
        next(error);
      }
    }
  };
}

/**
 * Middleware factory for verifying branch access on a specific resource by ID.
 */
export function verifyResourceBranchAccess<TModel extends { organizationId: string; branchId: string }>(
  modelName: string,
  findUnique: (id: string) => Promise<TModel | null>
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({ error: 'Resource ID required', code: 'MISSING_ID' });
        return;
      }
      
      const resource = await findUnique(id);
      await verifyBranchAccess(req, resource, modelName);
      
      (req as any).verifiedResource = resource;
      next();
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
      } else {
        next(error);
      }
    }
  };
}

/**
 * Middleware to verify access to a nested resource via its parent.
 * Usage: router.get('/invoices/:invoiceId/items/:id', verifyNestedAccess('SalesInvoice', 'invoiceId', prisma.salesInvoice), handler)
 */
export function verifyNestedAccess<TParent extends { organizationId: string }>(
  parentModelName: string,
  parentIdParam: string,
  findParent: (id: string) => Promise<TParent | null>
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parentId = req.params[parentIdParam];
      
      if (!parentId) {
        res.status(400).json({ error: `${parentIdParam} required`, code: 'MISSING_PARENT_ID' });
        return;
      }
      
      const parent = await findParent(parentId);
      await verifyOrgOwnership(req, parent, parentModelName);
      
      (req as any).verifiedParent = parent;
      next();
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
      } else {
        next(error);
      }
    }
  };
}

export default {
  enforceTenantIsolation,
  getTenantContext,
  verifyOrgOwnership,
  verifyBranchAccess,
  orgWhereClause,
  branchWhereClause,
  verifyNestedResourceOwnership,
  sanitizeCreateInput,
  sanitizeUpdateInput,
  verifyResourceOwnership,
  verifyResourceBranchAccess,
  verifyNestedAccess,
  CROSS_BRANCH_ROLES,
  ORG_ADMIN_ROLES,
};