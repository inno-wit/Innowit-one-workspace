/**
 * INNOWIT ONE — REAL DATABASE SEED (Phase 1 exit-audit fix)
 *
 * Fixes confirmed audit defect SEED-1: the previous `npm run db:seed`
 * (src/scripts/seed.ts) only reset in-memory demo state and never wrote
 * to PostgreSQL. This seed provisions the same 12-role RBAC account set,
 * organization, branches, and a minimal chart of accounts DIRECTLY in the
 * database, idempotently (safe to run repeatedly).
 *
 * Usage: npx prisma db seed   (or: npm run db:seed)
 * @license Apache-2.0
 */

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'DemoUser#2026';

const ORG = {
  legalName: 'Innowit One Demo Ltd',
  tradeName: 'Innowit One',
  kraPin: 'P051234567X',
  vatNumber: 'VAT-DEMO-001',
};

const BRANCHES = [
  { branchCode: '00', name: 'Headquarters - Nairobi', isHq: true, address: 'Riverside Drive, Nairobi' },
  { branchCode: '01', name: 'Mombasa Branch', isHq: false, address: 'Nyali Road, Mombasa' },
];

const USERS: Array<{ email: string; fullName: string; role: UserRole; branchCode: string }> = [
  { email: 'super@innowit.ke', fullName: 'System Super Admin', role: 'SUPER_ADMIN', branchCode: '00' },
  { email: 'admin@innowit.ke', fullName: 'Wanjiku Kamau', role: 'ADMIN', branchCode: '00' },
  { email: 'executive@innowit.ke', fullName: 'Peter Njoroge', role: 'EXECUTIVE', branchCode: '00' },
  { email: 'finance@innowit.ke', fullName: 'Mary Wambui', role: 'FINANCE_MANAGER', branchCode: '00' },
  { email: 'accountant@innowit.ke', fullName: 'John Mwangi', role: 'ACCOUNTANT', branchCode: '00' },
  { email: 'sales.dir@innowit.ke', fullName: 'David Ochieng', role: 'SALES_MANAGER', branchCode: '00' },
  { email: 'sales@innowit.ke', fullName: 'Kevin Mutiso', role: 'SALES_REP', branchCode: '01' },
  { email: 'procure@innowit.ke', fullName: 'Grace Mutua', role: 'PROCUREMENT_OFFICER', branchCode: '00' },
  { email: 'inventory@innowit.ke', fullName: 'Hassan Abdi', role: 'INVENTORY_MANAGER', branchCode: '01' },
  { email: 'hr@innowit.ke', fullName: 'Lilian Ndinda', role: 'HR_MANAGER', branchCode: '00' },
  { email: 'pm@innowit.ke', fullName: 'Brian Kiprono', role: 'PROJECT_MANAGER', branchCode: '00' },
  { email: 'staff@innowit.ke', fullName: 'Mercy Achieng', role: 'EMPLOYEE', branchCode: '01' },
];

const CHART_OF_ACCOUNTS = [
  { accountNumber: '1000', name: 'Cash and Bank', type: 'ASSET' as const, currentBalance: 0 },
  { accountNumber: '1100', name: 'Accounts Receivable', type: 'ASSET' as const, currentBalance: 0 },
  { accountNumber: '1200', name: 'Inventory', type: 'ASSET' as const, currentBalance: 0 },
  { accountNumber: '1400', name: 'VAT Receivable', type: 'ASSET' as const, currentBalance: 0 },
  { accountNumber: '2000', name: 'Accounts Payable', type: 'LIABILITY' as const, currentBalance: 0 },
  { accountNumber: '2200', name: 'VAT Payable', type: 'LIABILITY' as const, currentBalance: 0 },
  { accountNumber: '2300', name: 'PAYE Payable', type: 'LIABILITY' as const, currentBalance: 0 },
  { accountNumber: '3000', name: 'Share Capital', type: 'EQUITY' as const, currentBalance: 0 },
  { accountNumber: '3100', name: 'Retained Earnings', type: 'EQUITY' as const, currentBalance: 0 },
  { accountNumber: '4000', name: 'Sales Revenue', type: 'REVENUE' as const, currentBalance: 0 },
  { accountNumber: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE' as const, currentBalance: 0 },
  { accountNumber: '6000', name: 'Operating Expenses', type: 'EXPENSE' as const, currentBalance: 0 },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const organization = await prisma.organization.upsert({
    where: { kraPin: ORG.kraPin },
    update: {},
    create: ORG,
  });

  const branchByCode = new Map<string, string>();
  for (const b of BRANCHES) {
    const branch = await prisma.branch.upsert({
      where: { organizationId_branchCode: { organizationId: organization.id, branchCode: b.branchCode } },
      update: {},
      create: { ...b, organizationId: organization.id },
    });
    branchByCode.set(b.branchCode, branch.id);
  }

  let usersCreated = 0;
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: u.email,
          passwordHash,
          fullName: u.fullName,
          role: u.role,
          organizationId: organization.id,
          branchId: branchByCode.get(u.branchCode) ?? null,
          isActive: true,
        },
      });
      usersCreated++;
    }
  }

  let accountsCreated = 0;
  for (const a of CHART_OF_ACCOUNTS) {
    const existing = await prisma.account.findUnique({
      where: { organizationId_accountNumber: { organizationId: organization.id, accountNumber: a.accountNumber } },
    }).catch(() => null);
    if (!existing) {
      await prisma.account.create({
        data: {
          ...a,
          organizationId: organization.id,
          currency: 'KES',
        },
      }).catch(async () => {
        // Fallback if compound unique does not exist yet (schema fix pending)
        const byNumber = await prisma.account.findFirst({
          where: { organizationId: organization.id, accountNumber: a.accountNumber },
        });
        if (!byNumber) {
          await prisma.account.create({ data: { ...a, organizationId: organization.id, currency: 'KES' } });
          accountsCreated++;
        }
      });
      accountsCreated++;
    }
  }

  console.log('=============================================');
  console.log(' REAL DATABASE SEED COMPLETE');
  console.log(` Organization: ${organization.legalName} (${organization.kraPin})`);
  console.log(` Branches:     ${BRANCHES.map((b) => b.branchCode).join(', ')}`);
  console.log(` Users:        ${USERS.length} provisioned (${usersCreated} newly created)`);
  console.log(` Accounts:     ${CHART_OF_ACCOUNTS.length} chart-of-accounts entries`);
  console.log(` Demo password: ${DEMO_PASSWORD} (all seeded accounts)`);
  console.log('=============================================');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
