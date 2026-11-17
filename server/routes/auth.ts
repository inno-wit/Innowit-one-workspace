import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { generateAccessToken, generateRefreshToken, storeRefreshToken, validateRefreshToken, revokeRefreshToken, revokeAllUserRefreshTokens, JWTPayload } from '../utils/auth';
import { authenticateToken, AuthenticatedRequest, authorize } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { asyncHandler, AppError } from '../middleware/errorHandler';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// POST /api/auth/login
router.post('/login', validateBody(loginSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      organization: true,
      branch: true,
      employee: true,
    },
  });

  if (!user || !user.isActive) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // Generate tokens
  const payload: JWTPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    branchId: user.branchId,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
  };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(user.id, crypto.randomUUID());
  
  // Store refresh token with 7-day expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await storeRefreshToken(user.id, refreshToken, expiresAt);

  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.legalName,
      branchId: user.branchId,
      branchName: user.branch?.name,
      avatarUrl: user.avatarUrl,
    },
  });
}));

// POST /api/auth/refresh
router.post('/refresh', validateBody(refreshSchema), asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  const validation = await validateRefreshToken(refreshToken);
  if (!validation) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({
    where: { id: validation.userId },
    include: {
      organization: true,
      branch: true,
    },
  });

  if (!user || !user.isActive) {
    throw new AppError(401, 'USER_INACTIVE', 'User not found or inactive');
  }

  // Generate new tokens
  const payload: JWTPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    branchId: user.branchId,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
  };

  const newAccessToken = generateAccessToken(payload);
  const newRefreshToken = generateRefreshToken(user.id, crypto.randomUUID());

  // Revoke old refresh token
  await revokeRefreshToken(refreshToken);

  // Store new refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  await storeRefreshToken(user.id, newRefreshToken, expiresAt);

  // Set new refresh token as httpOnly cookie
  res.cookie('refreshToken', newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    accessToken: newAccessToken,
  });
}));

// POST /api/auth/logout
router.post('/logout', asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;
  
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.json({ message: 'Logged out successfully' });
}));

// POST /api/auth/logout-all
router.post('/logout-all', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  await revokeAllUserRefreshTokens(req.user.userId);

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.json({ message: 'Logged out from all devices' });
}));

// GET /api/auth/me
router.get('/me', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    include: {
      organization: true,
      branch: true,
      employee: true,
    },
  });

  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.legalName,
      branchId: user.branchId,
      branchName: user.branch?.name,
      avatarUrl: user.avatarUrl,
      isActive: user.isActive,
      employee: user.employee ? {
        id: user.employee.id,
        employeeCode: user.employee.employeeCode,
        departmentId: user.employee.departmentId,
      } : null,
    },
  });
}));

// POST /api/auth/change-password
router.post('/change-password', authenticateToken, validateBody(changePasswordSchema), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const { currentPassword, newPassword } = req.body;

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
  });

  if (!user) {
    throw new AppError(404, 'NOT_FOUND', 'User not found');
  }

  const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValidPassword) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 12);
  
  await prisma.user.update({
    where: { id: req.user.userId },
    data: { passwordHash: newPasswordHash },
  });

  // Revoke all refresh tokens to force re-login
  await revokeAllUserRefreshTokens(req.user.userId);

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.json({ message: 'Password changed successfully. Please log in again.' });
}));

export default router;