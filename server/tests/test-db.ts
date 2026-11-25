import { vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

// Set JWT_SECRET for tests BEFORE importing auth middleware
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-must-be-32-chars-long-enough';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let prisma: PrismaClient;
let testDbUrl: string;

export async function setupTestDatabase(): Promise<{ prisma: PrismaClient; dbUrl: string }> {
  testDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public';
  process.env.DATABASE_URL = testDbUrl;

  prisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
  });

  await prisma.$connect();

  return { prisma, dbUrl: testDbUrl };
}

export async function teardownTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

export async function seedTestData(prisma: PrismaClient) {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('TestPass123!', 12);

  // Use upsert with empty update to handle existing data
  // This will either create new or update existing (with no changes)
  const orgA = await prisma.organization.upsert({
    where: { kraPin: 'A001234567A' },
    update: { legalName: 'Test Org A', tradeName: 'Org A', vatNumber: 'VAT001' },
    create: { legalName: 'Test Org A', tradeName: 'Org A', kraPin: 'A001234567A', vatNumber: 'VAT001' },
  });

  const orgB = await prisma.organization.upsert({
    where: { kraPin: 'B001234567B' },
    update: { legalName: 'Test Org B', tradeName: 'Org B', vatNumber: 'VAT002' },
    create: { legalName: 'Test Org B', tradeName: 'Org B', kraPin: 'B001234567B', vatNumber: 'VAT002' },
  });

  const branchA = await prisma.branch.upsert({
    where: { organizationId_branchCode: { organizationId: orgA.id, branchCode: '00' } },
    update: { name: 'HQ', isHq: true },
    create: { organizationId: orgA.id, branchCode: '00', name: 'HQ', isHq: true },
  });

  const branchB = await prisma.branch.upsert({
    where: { organizationId_branchCode: { organizationId: orgB.id, branchCode: '00' } },
    update: { name: 'HQ', isHq: true },
    create: { organizationId: orgB.id, branchCode: '00', name: 'HQ', isHq: true },
  });

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@orga.com' },
      update: { organizationId: orgA.id, branchId: branchA.id, fullName: 'Admin User A', role: 'SUPER_ADMIN', isActive: true },
      create: { organizationId: orgA.id, branchId: branchA.id, email: 'admin@orga.com', passwordHash, fullName: 'Admin User A', role: 'SUPER_ADMIN', isActive: true }
    }),
    prisma.user.upsert({
      where: { email: 'member@orga.com' },
      update: { organizationId: orgA.id, branchId: branchA.id, fullName: 'Member User A', role: 'EMPLOYEE', isActive: true },
      create: { organizationId: orgA.id, branchId: branchA.id, email: 'member@orga.com', passwordHash, fullName: 'Member User A', role: 'EMPLOYEE', isActive: true }
    }),
    prisma.user.upsert({
      where: { email: 'admin@orgb.com' },
      update: { organizationId: orgB.id, branchId: branchB.id, fullName: 'Admin User B', role: 'ADMIN', isActive: true },
      create: { organizationId: orgB.id, branchId: branchB.id, email: 'admin@orgb.com', passwordHash, fullName: 'Admin User B', role: 'ADMIN', isActive: true }
    }),
    prisma.user.upsert({
      where: { email: 'finance@orga.com' },
      update: { organizationId: orgA.id, branchId: branchA.id, fullName: 'Finance User A', role: 'FINANCE_MANAGER', isActive: true },
      create: { organizationId: orgA.id, branchId: branchA.id, email: 'finance@orga.com', passwordHash, fullName: 'Finance User A', role: 'FINANCE_MANAGER', isActive: true }
    }),
  ]);

  return { orgA, orgB, branchA, branchB, users };
}

export function getPrisma(): PrismaClient { return prisma; }
export function getTestDbUrl(): string { return testDbUrl; }

export async function cleanTestData(prisma: PrismaClient) {
  // Get test organization IDs
  const testOrgs = await prisma.organization.findMany({
    where: { kraPin: { in: ['A001234567A', 'B001234567B'] } },
    select: { id: true },
  });
  const testOrgIds = testOrgs.map(o => o.id);

  if (testOrgIds.length === 0) return;

  // Get channel IDs for test organizations, EXCEPT fixture channels (which persist across test runs)
  const channels = await prisma.channel.findMany({
    where: { 
      organizationId: { in: testOrgIds },
      name: { not: { startsWith: 'fixture-' } }  // Preserve fixture channels
    },
    select: { id: true },
  });
  const channelIds = channels.map(c => c.id);

  // Get all user IDs for test organizations
  const users = await prisma.user.findMany({
    where: { email: { contains: '@orga.com' } },
    select: { id: true },
  });
  const orgAUserIds = users.map(u => u.id);

  const orgBUsers = await prisma.user.findMany({
    where: { email: { contains: '@orgb.com' } },
    select: { id: true },
  });
  const orgBUserIds = orgBUsers.map(u => u.id);

  const allTestUserIds = [...orgAUserIds, ...orgBUserIds];

  // Delete in correct order to respect foreign key constraints
  // Only delete data for non-fixture channels
  await prisma.reaction.deleteMany({ where: { message: { channelId: { in: channelIds } } } });
  await prisma.readCursor.deleteMany({ where: { OR: [{ channelId: { in: channelIds } }, { recipientId: { in: allTestUserIds } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.presenceSession.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.meetingParticipant.deleteMany({ where: { meeting: { channelId: { in: channelIds } } } });
  await prisma.meeting.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.message.deleteMany({ where: { OR: [{ channelId: { in: channelIds } }, { senderId: { in: allTestUserIds } }] } });
  await prisma.channelMember.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  // Delete conversations created by test users (not fixture channels)
  await prisma.conversation.deleteMany({ where: { createdById: { in: allTestUserIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { userId: { in: allTestUserIds } } });
  await prisma.fileAttachment.deleteMany({ where: { message: { channelId: { in: channelIds } } } });
  await prisma.sharedNote.deleteMany({ where: { authorId: { in: orgAUserIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.importJob.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  // DO NOT delete users, branches, organizations - they are base fixtures that persist across test runs
}

export function generateTestToken(user: { userId?: string; id?: string; organizationId: string; branchId: string | null; role: string; email: string; fullName?: string }) {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-must-be-32-chars-long-enough';
  const uid = user.userId || user.id;
  return jwt.sign(
    {
      userId: uid,
      organizationId: user.organizationId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
      fullName: user.fullName || '',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

export function createMockRequest(overrides: Record<string, any> = {}) {
  return { headers: {}, query: {}, params: {}, body: {}, user: undefined, ...overrides };
}

export function createMockResponse() {
  const res: any = { statusCode: 200, body: null, headers: {}, status(code: number) { this.statusCode = code; return this; }, json(data: any) { this.body = data; return this; }, setHeader(name: string, value: string) { this.headers[name] = value; return this; }, getHeader(name: string) { return this.headers[name]; } };
  return res;
}

export function createMockNext() { return vi.fn(); }