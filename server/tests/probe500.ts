/**
 * 500-cause probe: replays the failing request shapes against a dedicated
 * server instance, minting tokens locally (login is auth-gated — AUTH-0).
 * @license Apache-2.0
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:3102';

async function req(method: string, url: string, token: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}

function mint(user: any): string {
  return jwt.sign(
    { userId: user.id, organizationId: user.organizationId, branchId: user.branchId, email: user.email, role: user.role, fullName: user.fullName },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));
  const finance = await prisma.user.findUnique({ where: { email: 'finance@innowit.ke' } });
  const admin = await prisma.user.findUnique({ where: { email: 'admin@innowit.ke' } });
  const org = await prisma.organization.findFirst({ where: { kraPin: 'P051234567X' } });
  const tFinance = mint(finance);
  const tAdmin = mint(admin);

  // A) journal POST (balanced) — result #14 was 500
  const accounts = await prisma.account.findMany({ where: { organizationId: org!.id } });
  const cash = accounts.find((a) => a.accountNumber === '1000')!;
  const capital = accounts.find((a) => a.accountNumber === '3000')!;
  const rA = await req('POST', '/api/journal', tFinance, {
    entryNumber: `PROBE-JE-${Date.now()}`, description: '500 cause probe', postingDate: new Date().toISOString(),
    sourceModule: 'MANUAL',
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0, description: 'Dr' },
      { accountId: capital.id, debit: 0, credit: 1000, description: 'Cr' },
    ],
  });
  console.log('A journal POST:', rA.status, JSON.stringify(rA.json).slice(0, 300));

  // B) users POST (valid EMPLOYEE) — result #9 was 500
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id, isHq: true } });
  const rB = await req('POST', '/api/users', tAdmin, {
    email: `probe-user-${Date.now()}@test.local`, password: 'SomePass#123', fullName: 'Probe User', role: 'EMPLOYEE', branchId: branch!.id,
  });
  console.log('B users POST:', rB.status, JSON.stringify(rB.json).slice(0, 300));

  // C) payment POST — result #20 was 500
  const inv = await prisma.salesInvoice.findFirst({ where: { status: 'POSTED' } });
  const rC = await req('POST', '/api/payments', tFinance, {
    salesInvoiceId: inv?.id, paymentNumber: `PROBE-PAY-${Date.now()}`,
    paymentDate: new Date().toISOString(), amount: 1, paymentMethod: 'CASH',
  });
  console.log('C payment POST:', rC.status, JSON.stringify(rC.json).slice(0, 300));

  // D) etims config POST — result #30 was 500
  const rD = await req('POST', '/api/etims/config', tFinance, {
    mode: 'OSCU', environment: 'SANDBOX', taxpayerPin: 'P051234567X',
    clientSecret: 'probe-secret', apiUrl: 'https://etims-sandbox.example.ke/api',
  });
  console.log('D etims config POST:', rD.status, JSON.stringify(rD.json).slice(0, 300));

  await prisma.$disconnect();
}

main().catch((e) => { console.error('PROBE ERR', e); process.exit(1); });
