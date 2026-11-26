import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set JWT_SECRET for tests BEFORE importing auth middleware
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-must-be-32-chars-long-enough';

// Use the server's global Prisma client singleton
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let prisma: PrismaClient;
if (globalForPrisma.prisma) {
  prisma = globalForPrisma.prisma;
} else {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
  globalForPrisma.prisma = prisma;
}

let testDbUrl: string;

// Global test state shared across all test files
// Use globalThis to persist initialization flag across vitest module contexts
const globalInitFlag = globalThis as unknown as {
  __innowit_db_initialized__: boolean;
};

if (globalInitFlag.__innowit_db_initialized__ === undefined) {
  globalInitFlag.__innowit_db_initialized__ = false;
}

export const testState = {
  get prisma() { return prisma; },
  testData: null as any,
  adminToken: '',
  memberToken: '',
  otherOrgToken: '',
  channelId: '',
  otherChannelId: '',
  attachmentChannelId: '',
  get initialized() { return globalInitFlag.__innowit_db_initialized__; },
  set initialized(v: boolean) { globalInitFlag.__innowit_db_initialized__ = v; },
};

export async function initializeTestDatabase(): Promise<void> {
  if (testState.initialized) {
    console.log('[db-singleton] Already initialized, skipping');
    return;
  }

  // Set initialized flag immediately to prevent concurrent initialization
  testState.initialized = true;
  console.log('[db-singleton] Initializing test database...');

  testDbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/innowit_one_test?schema=public';
  process.env.DATABASE_URL = testDbUrl;

  // Ensure connection
  await prisma.$connect();

  // Clean any leftover test data first (run once globally)
  await cleanGlobalTestData(prisma);
  
  // Seed base test data (run once globally)
  testState.testData = await seedGlobalTestData(prisma);

  // Generate tokens
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing-only-must-be-32-chars-long-enough';
  
  const generateTestToken = (user: { userId?: string; id?: string; organizationId: string; branchId: string | null; role: string; email: string; fullName?: string }) => {
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
  };

  testState.adminToken = generateTestToken({ 
    ...testState.testData.users[0], 
    userId: testState.testData.users[0].id, 
    fullName: testState.testData.users[0].fullName 
  });
  testState.memberToken = generateTestToken({ 
    ...testState.testData.users[1], 
    userId: testState.testData.users[1].id, 
    fullName: testState.testData.users[1].fullName 
  });
  testState.otherOrgToken = generateTestToken({ 
    ...testState.testData.users[2], 
    userId: testState.testData.users[2].id, 
    fullName: testState.testData.users[2].fullName 
  });

  // Create fixture channels (shared across all tests)
  const channel = await prisma.channel.create({
    data: {
      name: 'fixture-test-channel',
      description: 'Test channel for messages',
      isPrivate: false,
      createdById: testState.testData.users[0].id,
      organizationId: testState.testData.orgA.id,
    },
  });
  testState.channelId = channel.id;

  const otherChannel = await prisma.channel.create({
    data: {
      name: 'fixture-other-channel',
      description: 'Another channel',
      isPrivate: false,
      createdById: testState.testData.users[0].id,
      organizationId: testState.testData.orgA.id,
    },
  });
  testState.otherChannelId = otherChannel.id;

  // Add members to fixture channels
  await prisma.channelMember.createMany({
    data: [
      { channelId: testState.channelId, userId: testState.testData.users[0].id, organizationId: testState.testData.orgA.id },
      { channelId: testState.channelId, userId: testState.testData.users[1].id, organizationId: testState.testData.orgA.id },
      { channelId: testState.otherChannelId, userId: testState.testData.users[0].id, organizationId: testState.testData.orgA.id },
    ],
  });
}

export async function teardownTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    testState.initialized = false;
  }
}

// Clean only truly temporary test data (run once at start)
async function cleanGlobalTestData(prisma: PrismaClient) {
  const testOrgs = await prisma.organization.findMany({
    where: { kraPin: { in: ['A001234567A', 'B001234567B'] } },
    select: { id: true },
  });
  const testOrgIds = testOrgs.map(o => o.id);

  if (testOrgIds.length === 0) return;

  // Delete all test data for these orgs
  const channels = await prisma.channel.findMany({
    where: { organizationId: { in: testOrgIds } },
    select: { id: true },
  });
  const channelIds = channels.map(c => c.id);

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

  // Clean Phase 3 CRM test data before deleting users/orgs
  await prisma.automationExecutionLog.deleteMany({ where: { rule: { organizationId: { in: testOrgIds } } } });
  await prisma.automationRule.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.cRMActivity.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.commissionRecord.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.commissionRule.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.salesRepQuota.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.savedView.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.customFieldValue.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.customFieldDefinition.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.dealStageHistory.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { organizationId: { in: testOrgIds } } } });
  await prisma.salesOrder.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.quotationItem.deleteMany({ where: { quotation: { organizationId: { in: testOrgIds } } } });
  await prisma.quotation.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.task.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.deal.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  // Clean Phase 4 accounting test data before deleting customers/products/branches/users/orgs
  await prisma.bankMatch.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.bankReconciliation.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.bankStatementLine.deleteMany({ where: { statement: { organizationId: { in: testOrgIds } } } });
  await prisma.bankStatement.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.mpesaTransaction.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.bankAccount.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.budgetLine.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.budget.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.taxTransaction.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.taxCode.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.exchangeRate.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.supplierPaymentAllocation.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.supplierPayment.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.supplierBillLine.deleteMany({ where: { supplierBill: { organizationId: { in: testOrgIds } } } });
  await prisma.supplierBill.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.supplier.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.creditNote.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.customerPayment.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.etimsTransmissionQueue.deleteMany({ where: { salesInvoice: { organizationId: { in: testOrgIds } } } });
  await prisma.salesInvoiceItem.deleteMany({ where: { salesInvoice: { organizationId: { in: testOrgIds } } } });
  await prisma.salesInvoice.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.journalLine.deleteMany({ where: { journalEntry: { organizationId: { in: testOrgIds } } } });
  await prisma.journalEntry.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.accountingPeriod.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.fiscalYear.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.organizationAccountingProfile.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.account.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.documentSequence.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.domainEventLog.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: testOrgIds } } });

  await prisma.customerContact.deleteMany({ where: { customer: { organizationId: { in: testOrgIds } } } });
  await prisma.customer.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.product.deleteMany({ where: { organizationId: { in: testOrgIds } } });

  await prisma.reaction.deleteMany({ where: { message: { channelId: { in: channelIds } } } });
  await prisma.readCursor.deleteMany({ where: { OR: [{ channelId: { in: channelIds } }, { recipientId: { in: allTestUserIds } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.presenceSession.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.meetingParticipant.deleteMany({ where: { meeting: { channelId: { in: channelIds } } } });
  await prisma.meeting.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.message.deleteMany({ where: { OR: [{ channelId: { in: channelIds } }, { senderId: { in: allTestUserIds } }] } });
  await prisma.channelMember.deleteMany({ where: { channelId: { in: channelIds } } });
  await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
  await prisma.conversation.deleteMany({ where: { createdById: { in: allTestUserIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { userId: { in: allTestUserIds } } });
  // Delete file attachments for all messages by test users (not just channel messages)
  await prisma.fileAttachment.deleteMany({ where: { message: { senderId: { in: allTestUserIds } } } });
  await prisma.fileAttachment.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.sharedNote.deleteMany({ where: { authorId: { in: orgAUserIds } } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: orgAUserIds } } });
  await prisma.importJob.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.user.deleteMany({ where: { email: { contains: '@orga.com' } } });
  await prisma.user.deleteMany({ where: { email: { contains: '@orgb.com' } } });
  await prisma.branch.deleteMany({ where: { organizationId: { in: testOrgIds } } });
  await prisma.organization.deleteMany({ where: { kraPin: { in: ['A001234567A', 'B001234567B'] } } });
}

// Seed base test data (run once globally)
async function seedGlobalTestData(prisma: PrismaClient) {
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('TestPass123!', 12);

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