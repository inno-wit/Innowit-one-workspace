import { Request, Response, NextFunction } from 'express';
import { prisma } from '../prisma';
import { verifyAccessToken, extractTokenFromHeader, JWTPayload, requireRole, UserRole } from '../utils/auth';
import { CROSS_BRANCH_ROLES, getTenantContext } from './tenant';

export { UserRole, CROSS_BRANCH_ROLES };

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  tenant?: ReturnType<typeof getTenantContext>;
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractTokenFromHeader(req.headers.authorization);
  
  if (!token) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  const payload = verifyAccessToken(token);
  
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    return;
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, isActive: true, organizationId: true, branchId: true },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ error: 'User not found or inactive', code: 'USER_INACTIVE' });
    return;
  }

  // Verify organization/branch match (tenant isolation)
  if (user.organizationId !== payload.organizationId) {
    res.status(403).json({ error: 'Organization mismatch', code: 'ORG_MISMATCH' });
    return;
  }

  if (user.branchId !== payload.branchId) {
    res.status(403).json({ error: 'Branch mismatch', code: 'BRANCH_MISMATCH' });
    return;
  }

  req.user = payload;
  next();
}

export function authorize(...allowedRoles: UserRole[]) {
  const checkRole = requireRole(...allowedRoles);
  
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
      return;
    }

    if (!checkRole(req.user.role)) {
      res.status(403).json({ 
        error: 'Insufficient permissions', 
        code: 'FORBIDDEN',
        required: allowedRoles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
}

// DEPRECATED: requireOrganizationAccess was a no-op. Use enforceTenantIsolation from middleware/tenant instead.
// export function requireOrganizationAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void { ... }

export function requireBranchAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  
  // Users can only access their branch's data unless they have cross-branch roles
  if (!CROSS_BRANCH_ROLES.includes(req.user.role) && req.user.branchId) {
    // Add branchId to query params for downstream use
    (req as any).enforcedBranchId = req.user.branchId;
  }
  
  next();
}

export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractTokenFromHeader(req.headers.authorization);
  
  if (!token) {
    next();
    return;
  }

  const payload = verifyAccessToken(token);
  
  if (payload) {
    req.user = payload;
  }
  
  next();
}