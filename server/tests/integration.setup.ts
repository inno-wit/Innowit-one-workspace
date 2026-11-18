import { vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let prisma: PrismaClient;
let testDbUrl: string;

// Use existing database for testing (since Docker not available)
// The user already has PostgreSQL running with the innowit_one database
// We'll use a separate test schema or clean up after each test

export async function setupTestDatabase(): Promise<{ prisma: PrismaClient; dbUrl: string }> {
  // Use existing DATABASE_URL from environment
  testDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innowit_one?schema=public';
  
  // Set for Prisma
  process.env.DATABASE_URL = testDbUrl;

  // Create Prisma client
  prisma = new PrismaClient({
    datasources: {
      db: { url: testDbUrl },
    },
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
  // Use upsert to handle existing test data properly
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('TestPass123!', 12);

  const orgA = await prisma.organization.upsert({
    where: { kraPin: 'A001234567A' },
    update: {},
    create: { legalName: 'Test Org A', tradeName: 'Org A', kraPin: 'A001234567A', vatNumber: 'VAT001' },
  });

  const orgB = await prisma.organization.upsert({
    where: { kraPin: 'B001234567B' },
    update: {},
    create: { legalName: 'Test Org B', tradeName: 'Org B', kraPin: 'B001234567B', vatNumber: 'VAT002' },
  });

  const branchA = await prisma.branch.upsert({
    where: { organizationId_branchCode: { organizationId: orgA.id, branchCode: '00' } },
    update: {},
    create: { organizationId: orgA.id, branchCode: '00', name: 'HQ', isHq: true },
  });

  const branchB = await prisma.branch.upsert({
    where: { organizationId_branchCode: { organizationId: orgB.id, branchCode: '00' } },
    update: {},
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

export function getPrisma(): PrismaClient {
  return prisma;
}

export function getTestDbUrl(): string {
  return testDbUrl;
}

// Clean up test data between tests
export async function cleanTestData(prisma: PrismaClient) {
  // Delete in reverse order of dependencies - only test data
  // We identify test data by email pattern or specific identifiers
  await prisma.reaction.deleteMany({
    where: {
      message: {
        OR: [
          { sender: { email: { contains: '@orga.com' } } },
          { sender: { email: { contains: '@orgb.com' } } },
        ],
      },
    },
  });

  await prisma.readCursor.deleteMany({
    where: {
      user: {
        email: { contains: '@orga.com' },
      },
    },
  });

  await prisma.notification.deleteMany({
    where: {
      user: {
        email: { contains: '@orga.com' },
      },
    },
  });

  await prisma.presenceSession.deleteMany({
    where: {
      user: {
        email: { contains: '@orga.com' },
      },
    },
  });

  await prisma.meetingParticipant.deleteMany({
    where: {
      meeting: {
        OR: [
          { channel: { name: { contains: 'test' } } },
          { startedBy: { email: { contains: '@orga.com' } } },
        ],
      },
    },
  });

  await prisma.meeting.deleteMany({
    where: {
      OR: [
        { channel: { name: { contains: 'test' } } },
        { startedBy: { email: { contains: '@orga.com' } } },
      ],
    },
  });

  await prisma.message.deleteMany({
    where: {
      OR: [
        { sender: { email: { contains: '@orga.com' } } },
        { sender: { email: { contains: '@orgb.com' } } },
      ],
    },
  });

  await prisma.channelMember.deleteMany({
    where: {
      channel: {
        name: { contains: 'test' },
      },
    },
  });

  await prisma.channel.deleteMany({
    where: {
      name: { contains: 'test' },
    },
  });

  await prisma.conversationParticipant.deleteMany({
    where: {
      conversation: {
        participants: {
          some: {
            user: {
              email: { contains: '@orga.com' },
            },
          },
        },
      },
    },
  });

  await prisma.conversation.deleteMany({
    where: {
      participants: {
        some: {
          user: {
            email: { contains: '@orga.com' },
          },
        },
      },
    },
  });

  await prisma.fileAttachment.deleteMany({
    where: {
      message: {
        sender: { email: { contains: '@orga.com' } },
      },
    },
  });

  await prisma.sharedNote.deleteMany({
    where: {
      author: { email: { contains: '@orga.com' } },
    },
  });

  await prisma.notificationPreference.deleteMany({
    where: {
      user: { email: { contains: '@orga.com' } },
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: { contains: '@orga.com' },
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: { contains: '@orgb.com' },
    },
  });

  await prisma.branch.deleteMany({
    where: {
      organization: {
        kraPin: { in: ['A001234567A', 'B001234567B'] },
      },
    },
  });

  await prisma.organization.deleteMany({
    where: {
      kraPin: { in: ['A001234567A', 'B001234567B'] },
    },
  });
}

// Generate auth token for testing
export function generateTestToken(user: { userId: string; organizationId: string; branchId: string | null; role: string; email: string }) {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-must-be-32-chars';
  
  return jwt.sign(
    {
      userId: user.userId,
      organizationId: user.organizationId,
      branchId: user.branchId,
      role: user.role,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Mock request object for testing middleware
export function createMockRequest(overrides: Record<string, any> = {}) {
  return {
    headers: {},
    query: {},
    params: {},
    body: {},
    user: undefined,
    ...overrides,
  };
}

// Mock response object for testing middleware
export function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    getHeader(name: string) {
      return this.headers[name];
    },
  };
  return res;
}

// Mock next function
export function createMockNext() {
  return vi.fn();
}