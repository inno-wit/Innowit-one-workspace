/**
 * INNOWIT ONE — PHASE 1 EXIT AUDIT: REAL-DATABASE INTEGRATION TEST SUITE
 *
 * Self-contained: spawns its own API server instance on port 3101 (raised
 * rate limit), provisions test fixtures directly via Prisma, and exercises
 * the real HTTP API against the real PostgreSQL database.
 *
 * Usage: npx tsx server/tests/integration.ts
 * Output: per-test EXPECTED/ACTUAL/PASS|FAIL + server/tests/integration-results.json
 *
 * Results are NEVER assumed — every ACTUAL comes from a real HTTP/DB response.
 * @license Apache-2.0
 */

import { spawn, ChildProcess } from 'child_process';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

/**
 * KNOWN DEFECT WORKAROUND (documented): as shipped, /api/auth/login is behind
 * authenticateToken (server/index.ts applies it to the whole /api router before
 * mounting auth routes), so no one can obtain a token through the API. To audit
 * deeper behavior we mint tokens locally with the SAME JWT_SECRET the server
 * uses. This is test scaffolding only — the login blocker itself is reported
 * as a confirmed defect (AUTH-0).
 */
function mintToken(user: { id: string; organizationId: string; branchId: string | null; email: string; role: string; fullName: string }): string {
  return jwt.sign(
    { userId: user.id, organizationId: user.organizationId, branchId: user.branchId, email: user.email, role: user.role, fullName: user.fullName },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:3101';

interface TestResult {
  id: number;
  suite: string;
  expected: string;
  actual: string;
  pass: boolean;
  notes?: string;
}

const results: TestResult[] = [];
let serverProc: ChildProcess | null = null;

function record(id: number, suite: string, expected: string, actual: string, pass: boolean, notes?: string) {
  results.push({ id, suite, expected, actual, pass, notes });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] #${id} ${suite}: ${expected} | ACTUAL: ${actual}${notes ? ' | ' + notes : ''}`);
}

let counter = 0;
const nextId = () => ++counter;

async function req(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json, headers: res.headers };
}

async function waitForServer(timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIX = {
  orgA: null as any,
  branchA: null as any,
  orgB: null as any,
  branchB: null as any,
  adminA: null as any,       // ADMIN in org A (seeded)
  financeA: null as any,     // FINANCE_MANAGER in org A (seeded)
  employeeA: null as any,    // EMPLOYEE in org A (seeded)
  salesRepA: null as any,    // SALES_REP in org A (seeded)
  inventoryA: null as any,   // INVENTORY_MANAGER in org A (seeded)
  adminB: null as any,       // ADMIN in org B (fixture-created)
  tokens: {} as Record<string, string>,
  accountAr: null as any,
  accountRevenue: null as any,
  accountVat: null as any,
  customer: null as any,
  product: null as any,
  warehouse1: null as any,
  warehouse2: null as any,
  invoice: null as any,
};

const DEMO_PASSWORD = 'DemoUser#2026';

async function login(email: string, password = DEMO_PASSWORD): Promise<string | null> {
  const r = await req('POST', '/api/auth/login', undefined, { email, password });
  if (r.status === 200 && r.json?.accessToken) return r.json.accessToken;
  // AUTH-0 workaround: login endpoint is auth-gated as shipped; mint locally instead
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.isActive) return mintToken(user);
  return null;
}

async function setupFixtures() {
  // Org A = seeded organization
  FIX.orgA = await prisma.organization.findFirst({ where: { kraPin: 'P051234567X' } });
  FIX.branchA = await prisma.branch.findFirst({ where: { organizationId: FIX.orgA.id, isHq: true } });

  // Clean up test data from previous runs to ensure idempotent results
  const orgIds = [FIX.orgA.id, FIX.orgB?.id].filter((id): id is string => !!id);
  if (orgIds.length > 0) {
    await prisma.salesOrderItem.deleteMany({ where: { salesOrder: { organizationId: { in: orgIds } } } });
    await prisma.salesOrder.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.stockMovement.deleteMany({ where: { product: { organizationId: { in: orgIds } } } });
    await prisma.warehouseStock.deleteMany({ where: { product: { organizationId: { in: orgIds } } } });
    await prisma.warehouse.deleteMany({ where: { branch: { organizationId: { in: orgIds } } } });
  }

  for (const [key, email] of [
    ['adminA', 'admin@innowit.ke'],
    ['financeA', 'finance@innowit.ke'],
    ['employeeA', 'staff@innowit.ke'],
    ['salesRepA', 'sales@innowit.ke'],
    ['inventoryA', 'inventory@innowit.ke'],
    ['accountantA', 'accountant@innowit.ke'],
  ] as const) {
    FIX[key] = await prisma.user.findUnique({ where: { email } });
  }

  // Org B fixture (created directly in DB — legitimate test setup)
  FIX.orgB = await prisma.organization.upsert({
    where: { kraPin: 'P059999999Z' },
    update: {},
    create: { legalName: 'Audit Org B Ltd', tradeName: 'Org B', kraPin: 'P059999999Z' },
  });
  FIX.branchB = await prisma.branch.upsert({
    where: { organizationId_branchCode: { organizationId: FIX.orgB.id, branchCode: '00' } },
    update: {},
    create: { organizationId: FIX.orgB.id, branchCode: '00', name: 'Org B HQ', isHq: true },
  });
  const adminBEmail = 'audit-admin-b@test.local';
  FIX.adminB = await prisma.user.upsert({
    where: { email: adminBEmail },
    update: {},
    create: {
      email: adminBEmail,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      fullName: 'Audit Org B Admin',
      role: 'ADMIN',
      organizationId: FIX.orgB.id,
      branchId: FIX.branchB.id,
      isActive: true,
    },
  });

  // GL accounts for invoice posting (AR / Revenue / VAT payable)
  FIX.accountAr = await prisma.account.findFirst({ where: { organizationId: FIX.orgA.id, accountNumber: '1100' } });
  FIX.accountRevenue = await prisma.account.findFirst({ where: { organizationId: FIX.orgA.id, accountNumber: '4000' } });
  FIX.accountVat = await prisma.account.findFirst({ where: { organizationId: FIX.orgA.id, accountNumber: '2200' } });

  // Baseline org A data
  const custCode = 'AUD-CUST-001';
  FIX.customer = await prisma.customer.findFirst({ where: { customerCode: custCode } })
    ?? await prisma.customer.create({
      data: { customerCode: custCode, name: 'Audit Test Customer', organizationId: FIX.orgA.id, branchId: FIX.branchA.id, creditLimit: 100000 },
    });
  const sku = 'AUD-SKU-001';
  FIX.product = await prisma.product.findFirst({ where: { sku } })
    ?? await prisma.product.create({
      data: { sku, name: 'Audit Test Product', costPrice: 100, sellingPrice: 150, organizationId: FIX.orgA.id },
    });
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

async function suiteAuth() {
  // #1 bad password
  {
    const id = nextId();
    const r = await req('POST', '/api/auth/login', undefined, { email: 'admin@innowit.ke', password: 'WrongPass999' });
    // SPEC: 401 INVALID_CREDENTIALS from the login route.
    // ACTUAL defect check: middleware 401 (UNAUTHORIZED) means login itself is auth-gated.
    const loginGated = r.json?.code === 'UNAUTHORIZED';
    results.push({ id, suite: 'AUTH', expected: 'Bad password login returns 401 INVALID_CREDENTIALS from login route', actual: `HTTP ${r.status} code=${r.json?.code ?? ''}${loginGated ? ' [DEFECT AUTH-0: login endpoint itself requires authentication]' : ''}`, pass: r.status === 401 && !loginGated });
    console.log(`[${r.status === 401 && !loginGated ? 'PASS' : 'FAIL'}] #${id} AUTH bad-password: ${r.status} ${r.json?.code}`);
  }
  // #2 good login
  {
    const id = nextId();
    const r = await req('POST', '/api/auth/login', undefined, { email: 'admin@innowit.ke', password: DEMO_PASSWORD });
    const ok = r.status === 200 && !!r.json?.accessToken && r.json?.user?.role === 'ADMIN';
    if (ok) FIX.tokens.adminA = r.json.accessToken;
    else FIX.tokens.adminA = mintToken(FIX.adminA);
    record(id, 'AUTH', 'Valid login returns 200 + accessToken + role', `HTTP ${r.status} code=${r.json?.code ?? ''}; token=${!!r.json?.accessToken}; role=${r.json?.user?.role}`, ok, ok ? undefined : '[DEFECT AUTH-0: token minted locally for further testing]');
  }
  // #3 /me
  {
    const id = nextId();
    const r = await req('GET', '/api/auth/me', FIX.tokens.adminA);
    record(id, 'AUTH', 'GET /api/auth/me returns authenticated user', `HTTP ${r.status}; email=${r.json?.data?.email ?? r.json?.email ?? 'n/a'}`, r.status === 200);
  }
  // #4 refresh rotation (token minted + stored directly — login is auth-gated, see AUTH-0)
  {
    const id = nextId();
    const user = FIX.financeA;
    const tokenId = crypto.randomUUID();
    const refreshToken = jwt.sign({ userId: user.id, tokenId }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
    const { hashRefreshToken } = await import('../utils/auth');
    await prisma.refreshToken.create({ data: { userId: user.id, token: hashRefreshToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    const r2 = await req('POST', '/api/auth/refresh', undefined, { refreshToken });
    const rotationWorked = r2.status === 200;
    const r3 = await req('POST', '/api/auth/refresh', undefined, { refreshToken }); // reuse old
    const oldRejected = r3.status === 401;
    if (rotationWorked) FIX.tokens.financeA = r2.json?.accessToken ?? FIX.tokens.financeA;
    record(id, 'AUTH', 'Refresh rotation: first use 200, reuse of old token 401', `first=${r2.status} code=${r2.json?.code ?? ''}; reuse=${r3.status} code=${r3.json?.code ?? ''}`, rotationWorked && oldRejected, 'Reuse acceptance = no theft detection (AUTH-3 evidence)');
  }
  // #5 logout invalidates refresh token (token minted + stored directly)
  {
    const id = nextId();
    const user = FIX.accountantA;
    const accessToken = mintToken(user);
    FIX.tokens.accountantA = accessToken;
    const tokenId = crypto.randomUUID();
    const refreshToken = jwt.sign({ userId: user.id, tokenId }, process.env.JWT_SECRET as string, { expiresIn: '7d' });
    const { hashRefreshToken } = await import('../utils/auth');
    await prisma.refreshToken.create({ data: { userId: user.id, token: hashRefreshToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    const r2 = await req('POST', '/api/auth/logout', accessToken, { refreshToken });
    const r3 = await req('POST', '/api/auth/refresh', undefined, { refreshToken });
    record(id, 'AUTH', 'Logout invalidates refresh token (refresh after logout = 401)', `logout=${r2.status} code=${r2.json?.code ?? ''}; refresh-after=${r3.status} code=${r3.json?.code ?? ''}`, r3.status === 401);
  }
  // #6 change-password flow (disposable user)
  {
    const id = nextId();
    const email = 'audit-chpw@test.local';
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) },
      create: { email, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10), fullName: 'ChPw Probe', role: 'EMPLOYEE', organizationId: FIX.orgA.id, isActive: true },
    });
    const r1 = await req('POST', '/api/auth/login', undefined, { email, password: DEMO_PASSWORD });
    const accessToken = r1.json?.accessToken ?? mintToken(await prisma.user.findUnique({ where: { email } }));
    const r2 = await req('POST', '/api/auth/change-password', accessToken, { currentPassword: DEMO_PASSWORD, newPassword: 'NewAudit#2026pw' });
    const r3 = await req('POST', '/api/auth/login', undefined, { email, password: DEMO_PASSWORD });
    const r4 = await req('POST', '/api/auth/login', undefined, { email, password: 'NewAudit#2026pw' });
    record(id, 'AUTH', 'Change-password: old password rejected, new accepted', `change=${r2.status}; old-login=${r3.status}; new-login=${r4.status}`, r2.status === 200 && r3.status === 401 && r4.status === 200);
    // restore
    await prisma.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10) } });
  }
}

async function suiteRbacTenant() {
  // tokens for roles
  FIX.tokens.employeeA = FIX.tokens.employeeA ?? await login('staff@innowit.ke');
  FIX.tokens.salesRepA = FIX.tokens.salesRepA ?? await login('sales@innowit.ke');
  FIX.tokens.adminB = FIX.tokens.adminB ?? await login('audit-admin-b@test.local');
  FIX.tokens.inventoryA = FIX.tokens.inventoryA ?? await login('inventory@innowit.ke');

  // #7 EMPLOYEE cannot create users
  {
    const id = nextId();
    const r = await req('POST', '/api/users', FIX.tokens.employeeA, {
      email: 'escalation-attempt@test.local', password: 'SomePass#123', fullName: 'Esc Probe', role: 'EMPLOYEE',
    });
    record(id, 'RBAC', 'EMPLOYEE role denied on POST /api/users (403)', `HTTP ${r.status} ${r.json?.code ?? ''}`, r.status === 403);
  }
  // #8 SALES_REP cannot post journal entries
  {
    const id = nextId();
    const accounts = await prisma.account.findMany({ where: { organizationId: FIX.orgA.id }, take: 2 });
    const r = await req('POST', '/api/journal', FIX.tokens.salesRepA, {
      entryNumber: `AUD-JE-DENY-${Date.now()}`, description: 'RBAC denial probe', postingDate: new Date().toISOString(),
      sourceModule: 'MANUAL',
      lines: [
        { accountId: accounts[0].id, debit: 100, credit: 0, description: 'd' },
        { accountId: accounts[1].id, debit: 0, credit: 100, description: 'c' },
      ],
    });
    record(id, 'RBAC', 'SALES_REP role denied on POST /api/journal (403)', `HTTP ${r.status} ${r.json?.code ?? ''}`, r.status === 403);
  }
  // #9 ADMIN can create user in own org
  {
    const id = nextId();
    const email = `audit-created-user-${Date.now()}@test.local`;
    const r = await req('POST', '/api/users', FIX.tokens.adminA, {
      email, password: 'SomePass#123', fullName: 'Created By Audit', role: 'EMPLOYEE', branchId: FIX.branchA.id,
    });
    record(id, 'RBAC', 'ADMIN can create an EMPLOYEE user in own org (201)', `HTTP ${r.status}`, r.status === 201);
  }
  // #10 privilege escalation: ADMIN grants SUPER_ADMIN
  {
    const id = nextId();
    const email = `audit-escalation-${Date.now()}@test.local`;
    const r1 = await req('POST', '/api/users', FIX.tokens.adminA, {
      email, password: 'SomePass#123', fullName: 'Escalation Probe', role: 'SUPER_ADMIN',
    });
    const created = await prisma.user.findUnique({ where: { email } });
    const actualRole = created?.role ?? 'not-created';
    // SPEC: a lower-privileged admin must NOT be able to mint a SUPER_ADMIN
    record(id, 'RBAC', 'ADMIN must NOT be able to create SUPER_ADMIN (403)', `HTTP ${r1.status}; resulting role=${actualRole}`, r1.status === 403, 'If 201 + SUPER_ADMIN user exists in DB → confirmed privilege escalation (AUTH-4)');
  }
  // #11 cross-tenant read: org B admin reads org A customer by id
  {
    const id = nextId();
    const r = await req('GET', `/api/customers/${FIX.customer.id}`, FIX.tokens.adminB);
    const leaked = r.status === 200 && r.json?.data?.id === FIX.customer.id;
    record(id, 'TENANT', 'Org B reading org A customer by ID must be denied (403/404)', `HTTP ${r.status}${leaked ? ' + DATA LEAKED' : ''}`, !leaked, r.status === 200 ? 'Cross-tenant read SUCCEEDED — isolation defect' : undefined);
  }
  // #12 cross-tenant update: org B admin updates org A account
  {
    const id = nextId();
    const r = await req('PUT', `/api/accounts/${FIX.accountAr.id}`, FIX.tokens.adminB, { name: 'HACKED-BY-ORG-B' });
    const after = await prisma.account.findUnique({ where: { id: FIX.accountAr.id } });
    const tampered = after?.name === 'HACKED-BY-ORG-B';
    record(id, 'TENANT', 'Org B updating org A account must be denied', `HTTP ${r.status}; tampered=${tampered}`, !tampered, tampered ? 'Cross-tenant WRITE SUCCEEDED — isolation defect' : undefined);
  }
  // #13 organizationId spoofing on create
  {
    const id = nextId();
    const r = await req('POST', '/api/customers', FIX.tokens.adminB, {
      customerCode: `AUD-SPOOF-${Date.now()}`, name: 'Spoof Probe', organizationId: FIX.orgA.id,
    });
    let actualOrg: string | null = null;
    if (r.status === 201 && r.json?.data?.id) {
      const dbRow = await prisma.customer.findUnique({ where: { id: r.json.data.id } });
      actualOrg = dbRow?.organizationId ?? null;
    }
    const ignored = actualOrg === FIX.orgB.id || r.status >= 400;
    record(id, 'TENANT', 'Client-supplied organizationId must be ignored on create (record belongs to caller org)', `HTTP ${r.status}; record org=${actualOrg ?? 'n/a'}`, ignored);
  }
}

function vatOf(net: number): number { return Math.round(net * 0.16 * 100) / 100; }

async function suiteAccounting() {
  FIX.tokens.financeA = FIX.tokens.financeA ?? await login('finance@innowit.ke');
  const accounts = await prisma.account.findMany({ where: { organizationId: FIX.orgA.id } });
  const cash = accounts.find((a) => a.accountNumber === '1000')!;
  const capital = accounts.find((a) => a.accountNumber === '3000')!;

  // #14 balanced journal entry accepted
  {
    const id = nextId();
    const entryNumber = `AUD-JE-OK-${Date.now()}`;
    const r = await req('POST', '/api/journal', FIX.tokens.financeA, {
      entryNumber, description: 'Audit balanced entry', postingDate: new Date().toISOString(),
      sourceModule: 'MANUAL',
      lines: [
        { accountId: cash.id, debit: 1000, credit: 0, description: 'Dr cash' },
        { accountId: capital.id, debit: 0, credit: 1000, description: 'Cr capital' },
      ],
    });
    record(id, 'ACCOUNTING', 'Balanced journal entry accepted (201)', `HTTP ${r.status} ${r.json?.code ?? ''}`, r.status === 201);
  }
  // #15 unbalanced rejected
  {
    const id = nextId();
    const r = await req('POST', '/api/journal', FIX.tokens.financeA, {
      entryNumber: `AUD-JE-BAD-${Date.now()}`, description: 'Unbalanced', postingDate: new Date().toISOString(),
      sourceModule: 'MANUAL',
      lines: [
        { accountId: cash.id, debit: 500, credit: 0, description: 'd' },
        { accountId: capital.id, debit: 0, credit: 400, description: 'c' },
      ],
    });
    record(id, 'ACCOUNTING', 'Unbalanced journal entry rejected (400)', `HTTP ${r.status} ${r.json?.code ?? ''}`, r.status === 400);
  }
  // #16 tenant-scoped entry number: org B reuses org A's number
  {
    const id = nextId();
    const shared = `AUD-JE-SHARED-${Date.now()}`;
    const rA = await req('POST', '/api/journal', FIX.tokens.financeA, {
      entryNumber: shared, description: 'Org A', postingDate: new Date().toISOString(),
      sourceModule: 'MANUAL',
      lines: [ { accountId: cash.id, debit: 10, credit: 0, description: 'd' }, { accountId: capital.id, debit: 0, credit: 10, description: 'c' } ],
    });
    // org B needs its own accounts
    const rAcct = await req('POST', '/api/accounts', FIX.tokens.adminB, { accountNumber: 'B1000', name: 'Org B Cash', type: 'ASSET' });
    let accountB = rAcct.json?.data;
    if (!accountB) {
      accountB = await prisma.account.findFirst({ where: { organizationId: FIX.orgB.id, accountNumber: 'B1000' } });
    }
    const rAcct2 = await req('POST', '/api/accounts', FIX.tokens.adminB, { accountNumber: 'B3000', name: 'Org B Capital', type: 'EQUITY' });
    let accountB2 = rAcct2.json?.data;
    if (!accountB2) accountB2 = await prisma.account.findFirst({ where: { organizationId: FIX.orgB.id, accountNumber: 'B3000' } });
    const rB = accountB && accountB2
      ? await req('POST', '/api/journal', FIX.tokens.adminB, {
          entryNumber: shared, description: 'Org B same number', postingDate: new Date().toISOString(),
          sourceModule: 'MANUAL',
          lines: [ { accountId: accountB.id, debit: 20, credit: 0, description: 'd' }, { accountId: accountB2.id, debit: 0, credit: 20, description: 'c' } ],
        })
      : { status: -1, json: { error: 'org B account setup failed' } };
    // SPEC: per ADR multi-tenancy, entry numbers must be tenant-scoped → org B should be able to use its own number space
    const tenantScoped = rA.status === 201 && rB.status === 201;
    record(id, 'ACCOUNTING', 'Journal entry numbers tenant-scoped: org B can use a number already used by org A (201)', `orgA=${rA.status}; orgB=${rB.status} ${rB.json?.code ?? ''}`, tenantScoped, rB.status === 409 ? 'Global unique on entryNumber blocks other tenants (SC evidence)' : undefined);
  }
  // #17-19 invoice + payments
  const qty = 2, unitPrice = 1500; // net 3000, VAT 480, total 3480
  {
    const id = nextId();
    const invoiceNumber = `AUD-INV-${Date.now()}`;
    const r = await req('POST', '/api/invoices', FIX.tokens.financeA, {
      branchId: FIX.branchA.id, customerId: FIX.customer.id, invoiceNumber,
      invoiceDate: new Date().toISOString(), dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      items: [{ productId: FIX.product.id, description: 'Audit item', quantity: qty, unitPrice }],
    });
    FIX.invoice = r.json?.data;
    const status = FIX.invoice?.status ?? 'unknown';
    record(id, 'ACCOUNTING', 'Invoice created (201)', `HTTP ${r.status}; id=${FIX.invoice?.id ?? 'n/a'}; status=${status}`, r.status === 201);
  }
  // post invoice
  {
    const id = nextId();
    let r = await req('POST', `/api/invoices/${FIX.invoice?.id}/post`, FIX.tokens.financeA);
    let note = '';
    if (r.status === 400 && (r.json?.code === 'INVALID_STATUS')) {
      // try validating first via PUT
      const rPut = await req('PUT', `/api/invoices/${FIX.invoice.id}`, FIX.tokens.financeA, { status: 'VALIDATED' });
      r = await req('POST', `/api/invoices/${FIX.invoice?.id}/post`, FIX.tokens.financeA);
      note = `PUT-status=${rPut.status}`;
    }
    const posted = r.status === 200 || r.status === 201;
    record(id, 'ACCOUNTING', 'Invoice posts to GL + eTIMS queue (200/201)', `HTTP ${r.status} ${r.json?.code ?? ''} ${note}`, posted, r.json?.message);
  }
  // #18 overpayment rejected
  {
    const id = nextId();
    const total = qty * unitPrice + vatOf(qty * unitPrice);
    const r = await req('POST', '/api/payments', FIX.tokens.financeA, {
      salesInvoiceId: FIX.invoice.id, paymentNumber: `AUD-PAY-OVER-${Date.now()}`,
      paymentDate: new Date().toISOString(), amount: total + 100, paymentMethod: 'BANK_TRANSFER',
    });
    record(id, 'ACCOUNTING', 'Overpayment (amount > outstanding) rejected (400)', `HTTP ${r.status} ${r.json?.code ?? ''}`, r.status === 400);
  }
  // #19 payment accepted then duplicate rejected
  {
    const id = nextId();
    const total = qty * unitPrice + vatOf(qty * unitPrice);
    const r1 = await req('POST', '/api/payments', FIX.tokens.financeA, {
      salesInvoiceId: FIX.invoice.id, paymentNumber: `AUD-PAY-1-${Date.now()}`,
      paymentDate: new Date().toISOString(), amount: total, paymentMethod: 'CASH',
    });
    const invAfter = await prisma.salesInvoice.findUnique({ where: { id: FIX.invoice.id }, include: { payments: true } });
    const paid = Number(invAfter?.paidAmount ?? 0);
    const r2 = await req('POST', '/api/payments', FIX.tokens.financeA, {
      salesInvoiceId: FIX.invoice.id, paymentNumber: `AUD-PAY-2-${Date.now()}`,
      paymentDate: new Date().toISOString(), amount: total, paymentMethod: 'CASH',
    });
    const paidNow = await prisma.salesInvoice.findUnique({ where: { id: FIX.invoice.id }, include: { payments: true } });
    const totalPaid = Number(paidNow?.paidAmount ?? 0);
    const dupRejected = r2.status >= 400 && Math.abs(totalPaid - total) < 0.01;
    record(id, 'ACCOUNTING', 'Full payment accepted; duplicate full payment rejected (paid amount stays = invoice total)', `pay1=${r1.status}; pay2=${r2.status}; paidAmount=${totalPaid}; payments=${paidNow?.payments?.length ?? '?'}; paid-after-1=${paid}`, dupRejected, r2.status < 400 ? 'Duplicate payment ACCEPTED — overpayment defect' : undefined);
  }
  // #20 reversal creates mirrored entry, original preserved
  {
    const id = nextId();
    const entryNumber = `AUD-JE-REV-${Date.now()}`;
    const r0 = await req('POST', '/api/journal', FIX.tokens.financeA, {
      entryNumber, description: 'To be reversed', postingDate: new Date().toISOString(),
      sourceModule: 'MANUAL',
      lines: [ { accountId: cash.id, debit: 250, credit: 0, description: 'd' }, { accountId: capital.id, debit: 0, credit: 250, description: 'c' } ],
    });
    const entryId = r0.json?.data?.id;
    if (!entryId) { record(id, 'ACCOUNTING', 'Reversal produces mirrored entry; original preserved', `setup entry failed: HTTP ${r0.status}`, false); }
    else {
      const r1 = await req('POST', `/api/journal/${entryId}/reverse`, FIX.tokens.financeA, {
        reversalEntryNumber: `${entryNumber}-REV`, reversalDate: new Date().toISOString(), reversalDescription: 'Audit reversal',
      });
      const original = await prisma.journalEntry.findUnique({ where: { id: entryId }, include: { lines: true } });
      const reversal = r1.json?.data;
      // Verify reversal mirrors original: same accounts, swapped debit/credit per line
      const mirrored = reversal?.lines?.length === 2
        && reversal.lines.some((l: any) => l.accountId === original.lines[0].accountId && Number(l.debit) === 0 && Number(l.credit) === 250)
        && reversal.lines.some((l: any) => l.accountId === original.lines[1].accountId && Number(l.debit) === 250 && Number(l.credit) === 0);
      record(id, 'ACCOUNTING', 'Reversal: mirrored entry created; original entry + lines preserved', `reverse=${r1.status}; mirrored=${mirrored}; originalLines=${original?.lines?.length}`, r1.status === 201 && mirrored && (original?.lines?.length ?? 0) === 2);
    }
  }
  // #21 account with postings cannot be deleted
  {
    const id = nextId();
    const r = await req('DELETE', `/api/accounts/${cash.id}`, FIX.tokens.adminA);
    const stillThere = await prisma.account.findUnique({ where: { id: cash.id } });
    record(id, 'ACCOUNTING', 'Account with journal postings cannot be deleted', `HTTP ${r.status}; stillExists=${!!stillThere}`, r.status >= 400 && !!stillThere);
  }
}

async function suiteInventory() {
  FIX.tokens.inventoryA = FIX.tokens.inventoryA ?? await login('inventory@innowit.ke');
  // #22 product + warehouses
  {
    const id = nextId();
    const ts = Date.now();
    const rW1 = await req('POST', '/api/warehouses', FIX.tokens.inventoryA, { branchId: FIX.branchA.id, name: 'Audit WH 1', code: `AUDW1-${ts}` });
    const rW2 = await req('POST', '/api/warehouses', FIX.tokens.inventoryA, { branchId: FIX.branchA.id, name: 'Audit WH 2', code: `AUDW2-${ts}` });
    FIX.warehouse1 = rW1.json?.data ?? await prisma.warehouse.findFirst({ where: { code: `AUDW1-${ts}` } });
    FIX.warehouse2 = rW2.json?.data ?? await prisma.warehouse.findFirst({ where: { code: `AUDW2-${ts}` } });
    record(id, 'INVENTORY', 'Two warehouses created (201)', `w1=${rW1.status}; w2=${rW2.status}`, rW1.status === 201 && rW2.status === 201);
  }
  // #23 receipt movement
  {
    const id = nextId();
    const r = await req('POST', '/api/inventory/movements', FIX.tokens.inventoryA, {
      productId: FIX.product.id, warehouseId: FIX.warehouse1.id, movementType: 'RECEIPT', quantity: 100, unitCost: 100,
    });
    const stock = await prisma.warehouseStock.findUnique({
      where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } },
    }).catch(() => null);
    record(id, 'INVENTORY', 'RECEIPT 100 units → on-hand 100', `HTTP ${r.status}; onHand=${stock?.quantityOnHand ?? 'n/a'}`, r.status === 201 && Number(stock?.quantityOnHand ?? -1) === 100);
  }
  // #24 transfer
  {
    const id = nextId();
    const r = await req('POST', '/api/inventory/transfer', FIX.tokens.inventoryA, {
      productId: FIX.product.id, fromWarehouseId: FIX.warehouse1.id, toWarehouseId: FIX.warehouse2.id, quantity: 30,
    });
    const s1 = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } } }).catch(() => null);
    const s2 = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse2.id } } }).catch(() => null);
    const ok = r.status === 201 && Number(s1?.quantityOnHand ?? -1) === 70 && Number(s2?.quantityOnHand ?? -1) === 30;
    record(id, 'INVENTORY', 'Transfer 30 units: source 70, destination 30', `HTTP ${r.status}; src=${s1?.quantityOnHand ?? 'n/a'}; dst=${s2?.quantityOnHand ?? 'n/a'}`, ok);
  }
  // #25 over-transfer rejected
  {
    const id = nextId();
    const r = await req('POST', '/api/inventory/transfer', FIX.tokens.inventoryA, {
      productId: FIX.product.id, fromWarehouseId: FIX.warehouse1.id, toWarehouseId: FIX.warehouse2.id, quantity: 1000,
    });
    const s1 = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } } }).catch(() => null);
    const onHand = Number(s1?.quantityOnHand ?? 0);
    record(id, 'INVENTORY', 'Transfer of 1000 units (only 70 on hand) rejected (400)', `HTTP ${r.status} ${r.json?.code ?? ''}; src onHand=${onHand}`, r.status >= 400 && onHand === 70, onHand < 70 ? 'Over-transfer SUCCEEDED — stock loss defect (INV-1)' : undefined);
  }
  // #26 reservation via sales order; over-reservation guard
  {
    const id = nextId();
    const ts = Date.now();
    const rOrder = await req('POST', '/api/sales-orders', FIX.tokens.salesRepA, {
      customerId: FIX.customer.id, orderNumber: `AUD-SO-${ts}`, totalAmount: 4500,
      items: [{ productId: FIX.product.id, quantity: 40, unitPrice: 150 }],
    });
    const stock = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } } }).catch(() => null);
    const reserved = Number(stock?.quantityReserved ?? -1);
    const okReserve = rOrder.status === 201 && reserved === 40;
    record(id, 'INVENTORY', 'Sales order reserves 40 units (reserved=40)', `order=${rOrder.status}; reserved=${reserved}`, okReserve);
    // #27 over-reservation: order for 1000 units when only 70 on hand (40 already reserved)
    const id2 = nextId();
    const rOver = await req('POST', '/api/sales-orders', FIX.tokens.salesRepA, {
      customerId: FIX.customer.id, orderNumber: `AUD-SO-OVER-${ts}`, totalAmount: 150000,
      items: [{ productId: FIX.product.id, quantity: 1000, unitPrice: 150 }],
    });
    const stockAfter = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } } }).catch(() => null);
    const reservedAfter = Number(stockAfter?.quantityReserved ?? -1);
    record(id2, 'INVENTORY', 'Over-reservation (1000 units vs 70 on hand) rejected (400)', `order=${rOver.status}; reserved=${reservedAfter}`, rOver.status >= 400 && reservedAfter === 40, reservedAfter > 40 ? 'Over-reservation SUCCEEDED — reserved exceeds on-hand (INV-2)' : undefined);
  }
  // #28 adjustment cannot create negative / unvalidated absolute overwrite
  {
    const id = nextId();
    const r = await req('POST', '/api/inventory/movements', FIX.tokens.inventoryA, {
      productId: FIX.product.id, warehouseId: FIX.warehouse1.id, movementType: 'ADJUSTMENT', quantity: -500, notes: 'audit probe: negative adjustment',
    });
    const stock = await prisma.warehouseStock.findUnique({ where: { productId_warehouseId: { productId: FIX.product.id, warehouseId: FIX.warehouse1.id } } }).catch(() => null);
    const onHand = Number(stock?.quantityOnHand ?? 0);
    record(id, 'INVENTORY', 'ADJUSTMENT of -500 must not drive stock negative (400)', `HTTP ${r.status} ${r.json?.code ?? ''}; onHand=${onHand}`, r.status >= 400 && onHand >= 0, r.status === 201 || onHand < 0 ? 'Negative adjustment SUCCEEDED — INV-3' : undefined);
  }
}

async function suiteEtims() {
  FIX.tokens.financeA = FIX.tokens.financeA ?? await login('finance@innowit.ke');
  // #29 eTIMS sandbox config; secret must not come back plaintext
  {
    const id = nextId();
    // Clean up any existing SANDBOX config for idempotent test runs
    await prisma.etimsConfiguration.deleteMany({ where: { organizationId: FIX.orgA.id, environment: 'SANDBOX' } });
    const r = await req('POST', '/api/etims/config', FIX.tokens.financeA, {
      mode: 'OSCU', environment: 'SANDBOX', taxpayerPin: 'P051234567X',
      clientSecret: 'audit-secret-never-log-me', apiUrl: process.env.ETIMS_SANDBOX_URL || 'https://etims-sandbox.example.ke/api',
    });
    const body = JSON.stringify(r.json ?? {});
    const secretLeaked = body.includes('audit-secret-never-log-me');
    record(id, 'ETIMS', 'Sandbox config created (201); client secret NOT returned in plaintext', `HTTP ${r.status}; secretInResponse=${secretLeaked}`, r.status === 201 && !secretLeaked);
  }
  // #30 invoice post → queue entry PENDING; no fabricated ACCEPTED
  {
    const id = nextId();
    // post a fresh invoice
    const invoiceNumber = `AUD-ETIMS-${Date.now()}`;
    const rInv = await req('POST', '/api/invoices', FIX.tokens.financeA, {
      branchId: FIX.branchA.id, customerId: FIX.customer.id, invoiceNumber,
      invoiceDate: new Date().toISOString(), dueDate: new Date(Date.now() + 15 * 86400000).toISOString(),
      items: [{ productId: FIX.product.id, description: 'etims probe', quantity: 1, unitPrice: 1000 }],
    });
    const inv = rInv.json?.data;
    let note = '';
    let rPost = await req('POST', `/api/invoices/${inv?.id}/post`, FIX.tokens.financeA);
    if (rPost.status === 400 && rPost.json?.code === 'INVALID_STATUS') {
      await req('PUT', `/api/invoices/${inv.id}`, FIX.tokens.financeA, { status: 'VALIDATED' });
      rPost = await req('POST', `/api/invoices/${inv?.id}/post`, FIX.tokens.financeA);
      note = 'after-PUT';
    }
    const queueRows = await prisma.etimsTransmissionQueue.findMany({ where: { salesInvoiceId: inv.id } });
    const statuses = queueRows.map((q) => q.status);
    const noFabricatedAcceptance = statuses.every((s) => s !== 'ACCEPTED');
    record(id, 'ETIMS', 'Posting queues eTIMS entry as PENDING (not ACCEPTED) without external response', `post=${rPost.status} ${note}; queueRows=${queueRows.length}; statuses=${statuses.join(',')}`, queueRows.length === 1 && statuses[0] === 'PENDING' && noFabricatedAcceptance, rPost.status !== 200 && rPost.status !== 201 ? `post failed: ${rPost.json?.code}` : undefined);
    // #31 retry idempotency: retry endpoint must not duplicate queue rows
    const id2 = nextId();
    const q = queueRows[0];
    let retryStatuses: string[] = [];
    if (q) {
      await req('POST', `/api/etims/queue/${q.id}/retry`, FIX.tokens.financeA);
      await req('POST', `/api/etims/queue/${q.id}/retry`, FIX.tokens.financeA);
      retryStatuses = (await prisma.etimsTransmissionQueue.findMany({ where: { salesInvoiceId: inv.id } })).map((x) => x.status);
    }
    record(id2, 'ETIMS', 'Retries do not duplicate queue entries for the same invoice (still 1 row, never ACCEPTED)', `rows-after-retry=${retryStatuses.length}; statuses=${retryStatuses.join(',')}`, retryStatuses.length === 1 && retryStatuses.every((s) => s !== 'ACCEPTED'));
  }
  // #32 worker run: unreachable KRA must never produce ACCEPTED
  {
    const id = nextId();
    const before = await prisma.etimsTransmissionQueue.findMany({ where: { status: { in: ['PENDING', 'RETRY_SCHEDULED', 'IN_FLIGHT'] } } });
    const pendingBefore = before.length;
    let workerNote = `pendingBefore=${pendingBefore}`;
    if (pendingBefore > 0) {
      const proc = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/workers/etimsWorker.ts'], {
        cwd: REPO_ROOT,
        env: { ...process.env, ETIMS_SANDBOX_URL: 'http://127.0.0.1:9/unreachable-kra' },
        stdio: 'ignore',
      });
      await new Promise((r) => setTimeout(r, 8000));
      try { proc.kill('SIGTERM'); } catch { /* */ }
      const after = await prisma.etimsTransmissionQueue.findMany();
      const anyAccepted = after.some((q) => q.status === 'ACCEPTED' && (q.responseJson ?? '').length === 0);
      workerNote += `; after statuses=${after.map((q) => q.status).join(',')}`;
      record(id, 'ETIMS', 'Worker against unreachable KRA never marks queue items ACCEPTED', workerNote, !after.some((q) => q.status === 'ACCEPTED'));
    } else {
      record(id, 'ETIMS', 'Worker against unreachable KRA never marks queue items ACCEPTED', workerNote + ' — no pending items to process (skipped)', false, 'No PENDING queue items available; re-run after posting invoices');
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== INNOWIT ONE integration suite (real DB + real HTTP) ===');
  console.log('Spawning dedicated server on :3101 ...');
  serverProc = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: '3101', HOST: '127.0.0.1', RATE_LIMIT_MAX_REQUESTS: '100000', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog: string[] = [];
  serverProc.stdout?.on('data', (d) => serverLog.push(String(d)));
  serverProc.stderr?.on('data', (d) => serverLog.push(String(d)));
  serverProc.on('error', (e) => serverLog.push(`SPAWN-ERROR: ${e.message}`));
  const up = await waitForServer();
  if (!up) {
    console.error('FATAL: server did not start on :3101');
    console.error('--- server output ---');
    console.error(serverLog.join(''));
    process.exit(2);
  }
  console.log('Server is up. Building fixtures ...');
  try {
    await setupFixtures();
    await suiteAuth();
    await suiteRbacTenant();
    await suiteAccounting();
    await suiteInventory();
    await suiteEtims();
  } catch (e: any) {
    console.error('SUITE ERROR:', e?.stack ?? e);
    results.push({ id: -1, suite: 'META', expected: 'suite completes', actual: `crashed: ${e?.message}`, pass: false });
  } finally {
    if (serverProc) { try { serverProc.kill('SIGTERM'); } catch { /* */ } }
    await prisma.$disconnect();
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  const out = path.join(REPO_ROOT, 'server', 'tests', 'integration-results.json');
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), total: results.length, passed, failed, results }, null, 2));
  console.log(`Results written to ${out}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
