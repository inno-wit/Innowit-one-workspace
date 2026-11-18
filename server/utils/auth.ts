import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { UserRole } from '@prisma/client';

export { UserRole };

// Audit fix AUTH-1: no silent fallback secret. A missing or weak JWT_SECRET in
// production previously signed tokens with a public default string (full auth
// bypass). The process now refuses to start instead.
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'FATAL: JWT_SECRET is missing or shorter than 32 characters. Refusing to start — ' +
      'set a strong JWT_SECRET in the environment (never commit it).'
    );
  }
  return secret;
}

const JWT_SECRET = requireJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

export interface JWTPayload {
  userId: string;
  organizationId: string;
  branchId: string | null;
  email: string;
  role: UserRole;
  fullName: string;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function generateRefreshToken(userId: string, tokenId: string): string {
  const payload: RefreshTokenPayload = { userId, tokenId };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as RefreshTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Audit fix AUTH-2: refresh tokens are stored as SHA-256 hashes, never in
 * plaintext. A database leak no longer exposes usable sessions.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      userId,
      token: hashRefreshToken(token),
      expiresAt,
    },
  });
}

export async function validateRefreshToken(token: string): Promise<{ userId: string; tokenId: string } | null> {
  const payload = verifyRefreshToken(token);
  if (!payload) return null;

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: hashRefreshToken(token) },
    include: { user: true },
  });

  if (!storedToken || storedToken.expiresAt < new Date()) {
    return null;
  }

  if (!storedToken.user.isActive) {
    return null;
  }

  return { userId: payload.userId, tokenId: payload.tokenId };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { token: hashRefreshToken(token) },
  });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId },
  });
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  EXECUTIVE: 70,
  FINANCE_MANAGER: 60,
  ACCOUNTANT: 50,
  SALES_MANAGER: 45,
  SALES_REP: 40,
  PROCUREMENT_OFFICER: 35,
  INVENTORY_MANAGER: 35,
  HR_MANAGER: 35,
  PROJECT_MANAGER: 35,
  EMPLOYEE: 10,
};

export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (userRole: UserRole): boolean => {
    return allowedRoles.some(role => hasPermission(userRole, role));
  };
}