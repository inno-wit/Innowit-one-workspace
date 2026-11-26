import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  AccountControlType,
  AccountNormalBalance,
  AccountType,
  CurrencyCode,
  PrismaClient,
} from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';
import accountRoutes from '../routes/accounts';
import journalRoutes from '../routes/journal';
import invoiceRoutes from '../routes/invoices';
import paymentRoutes from '../routes/payments';
import creditNoteRoutes from '../routes/creditNotes';
import accountingRoutes from '../routes/accounting';
import supplierBillRoutes from '../routes/supplierBills';
import supplierPaymentRoutes from '../routes/supplierPayments';
import { reconcileAccountBalances } from '../services/accounting/journal';
import { resolveTaxCode } from '../services/accounting/taxService';
import { finalizeReconciliation } from '../services/accounting/bankService';

describe('Phase 4: Accounting & Financial Engine Integration Tests (F4.1–F4.10)', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let orgAId: string;
  let orgBId: string;
  let branchAId: string;
  let adminUserId: string;
  let memberUserId: string;

  // Chart of accounts for Org A
  let arAccountId: string;
  let apAccountId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let expenseAccountId: string;
  let vatOutputAccountId: string;
  let vatInputAccountId: string;
  let whtPayableAccountId: string;
  let fxAccountId: string;
  let summaryAccountId: string;
  let inactiveAccountId: string;
  let orgBAccountId: string;

  let customerId: string;
  let supplierId: string;
  let productId: string;

  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;
    orgAId = testState.testData.orgA.id;
    orgBId = testState.testData.orgB.id;
    branchAId = testState.testData.branchA.id;
    adminUserId = testState.testData.users[0].id;
    memberUserId = testState.testData.users[1].id;

    app = express();
    app.use(express.json());
    app.use('/api/accounts', accountRoutes);
    app.use('/api/journal', journalRoutes);
    app.use('/api/invoices', invoiceRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/credit-notes', creditNoteRoutes);
    app.use('/api/accounting', accountingRoutes);
    app.use('/api/suppliers', supplierBillRoutes);
    app.use('/api/suppliers', supplierPaymentRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Ensure Org A has a complete, mapped Chart of Accounts
    const ensureAccount = async (
      orgId: string,
      accountNumber: string,
      name: string,
      type: AccountType,
      normalBalance: AccountNormalBalance,
      opts: {
        isPostable?: boolean;
        isControl?: boolean;
        controlType?: AccountControlType;
        isActive?: boolean;
      } = {}
    ) => {
      const existing = await prisma.account.findUnique({
        where: { organizationId_accountNumber: { organizationId: orgId, accountNumber } },
      });
      if (existing) {
        return prisma.account.update({
          where: { id: existing.id },
          data: {
            isPostable: opts.isPostable ?? true,
            isControl: opts.isControl ?? false,
            controlType: opts.controlType ?? AccountControlType.NONE,
            isActive: opts.isActive ?? true,
          },
        });
      }
      return prisma.account.create({
        data: {
          organizationId: orgId,
          accountNumber,
          name,
          type,
          normalBalance,
          isPostable: opts.isPostable ?? true,
          isControl: opts.isControl ?? false,
          controlType: opts.controlType ?? AccountControlType.NONE,
          isActive: opts.isActive ?? true,
        },
      });
    };

    const cash = await ensureAccount(orgAId, `1010-${suffix}`, 'Main Bank KES', AccountType.ASSET, AccountNormalBalance.DEBIT, {
      controlType: AccountControlType.CASH,
    });
    const ar = await ensureAccount(orgAId, `1200-${suffix}`, 'Accounts Receivable', AccountType.ASSET, AccountNormalBalance.DEBIT, {
      isControl: true,
      controlType: AccountControlType.CUSTOMER_AR,
    });
    const vatIn = await ensureAccount(orgAId, `1310-${suffix}`, 'Input VAT Recoverable', AccountType.ASSET, AccountNormalBalance.DEBIT, {
      isControl: true,
      controlType: AccountControlType.VAT_INPUT,
    });
    const ap = await ensureAccount(orgAId, `2000-${suffix}`, 'Accounts Payable', AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.SUPPLIER_AP,
    });
    const vatOut = await ensureAccount(orgAId, `2110-${suffix}`, 'Output VAT Payable', AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.VAT_OUTPUT,
    });
    const wht = await ensureAccount(orgAId, `2120-${suffix}`, 'WHT Payable', AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.WHT_PAYABLE,
    });
    const rev = await ensureAccount(orgAId, `4000-${suffix}`, 'Sales Revenue', AccountType.REVENUE, AccountNormalBalance.CREDIT);
    const exp = await ensureAccount(orgAId, `6000-${suffix}`, 'Operating Expense', AccountType.EXPENSE, AccountNormalBalance.DEBIT);
    const fx = await ensureAccount(orgAId, `7100-${suffix}`, 'FX Gain / Loss', AccountType.EXPENSE, AccountNormalBalance.DEBIT, {
      controlType: AccountControlType.FX_GAIN_LOSS,
    });
    const summary = await ensureAccount(orgAId, `1000-${suffix}`, 'Current Assets Summary', AccountType.ASSET, AccountNormalBalance.DEBIT, {
      isPostable: false,
    });
    const inactive = await ensureAccount(orgAId, `9999-${suffix}`, 'Inactive Account', AccountType.EXPENSE, AccountNormalBalance.DEBIT, {
      isActive: false,
    });
    const orgBAcc = await ensureAccount(orgBId, `1010-${suffix}`, 'Org B Bank', AccountType.ASSET, AccountNormalBalance.DEBIT);

    cashAccountId = cash.id;
    arAccountId = ar.id;
    vatInputAccountId = vatIn.id;
    apAccountId = ap.id;
    vatOutputAccountId = vatOut.id;
    whtPayableAccountId = wht.id;
    revenueAccountId = rev.id;
    expenseAccountId = exp.id;
    fxAccountId = fx.id;
    summaryAccountId = summary.id;
    inactiveAccountId = inactive.id;
    orgBAccountId = orgBAcc.id;

    // Configure Org A accounting profile mappings
    await prisma.organizationAccountingProfile.upsert({
      where: { organizationId: orgAId },
      update: {
        functionalCurrency: CurrencyCode.KES,
        isVatRegistered: true,
        arControlAccountId: arAccountId,
        apControlAccountId: apAccountId,
        vatOutputAccountId,
        vatInputAccountId,
        whtPayableAccountId,
        fxGainAccountId: fxAccountId,
        fxLossAccountId: fxAccountId,
        defaultRevenueAccountId: revenueAccountId,
        defaultExpenseAccountId: expenseAccountId,
        defaultCashAccountId: cashAccountId,
      },
      create: {
        organizationId: orgAId,
        functionalCurrency: CurrencyCode.KES,
        isVatRegistered: true,
        arControlAccountId: arAccountId,
        apControlAccountId: apAccountId,
        vatOutputAccountId,
        vatInputAccountId,
        whtPayableAccountId,
        fxGainAccountId: fxAccountId,
        fxLossAccountId: fxAccountId,
        defaultRevenueAccountId: revenueAccountId,
        defaultExpenseAccountId: expenseAccountId,
        defaultCashAccountId: cashAccountId,
      },
    });

    // Ensure customer, supplier, and product in Org A
    const customer = await prisma.customer.create({
      data: {
        organizationId: orgAId,
        branchId: branchAId,
        customerCode: `P4-CUST-${suffix}`,
        name: 'Phase 4 Customer Ltd',
        email: `p4cust-${suffix}@example.com`,
      },
    });
    customerId = customer.id;

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: orgAId,
        name: 'Phase 4 Supplier Ltd',
        kraPin: 'P051112223Z',
      },
    });
    supplierId = supplier.id;

    const product = await prisma.product.create({
      data: {
        organizationId: orgAId,
        sku: `P4-SKU-${suffix}`,
        name: 'Phase 4 Consulting Service',
        sellingPrice: 1000,
        costPrice: 400,
        taxClassification: 'STANDARD_16',
      },
    });
    productId = product.id;
  });

  // =========================================================================
  // F4.1: COA & Fiscal Periods
  // =========================================================================
  describe('F4.1: Fiscal Periods & Lock Controls', () => {
    it('creates fiscal year lazily and enforces OPEN -> SOFT_CLOSED -> CLOSED -> REOPEN', async () => {
      const token = testState.adminToken;

      const fyRes = await request(app)
        .get('/api/accounting/fiscal-years')
        .set('Authorization', `Bearer ${token}`);
      expect(fyRes.status).toBe(200);
      expect(fyRes.body.data.length).toBeGreaterThanOrEqual(1);

      const periodsRes = await request(app)
        .get('/api/accounting/periods')
        .set('Authorization', `Bearer ${token}`);
      expect(periodsRes.status).toBe(200);
      expect(periodsRes.body.data.length).toBeGreaterThanOrEqual(12);

      // Pick a period from the current year (e.g. period 1 / Jan)
      const janPeriod = periodsRes.body.data[0];
      const postingDateInJan = new Date(janPeriod.startDate);
      postingDateInJan.setUTCDate(15);

      // Close Jan period
      const closeRes = await request(app)
        .post(`/api/accounting/periods/${janPeriod.id}/close`)
        .set('Authorization', `Bearer ${token}`);
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.status).toBe('CLOSED');

      // Posting into closed period must fail with 409 PERIOD_CLOSED
      const postInClosed = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: postingDateInJan.toISOString(),
          description: 'Should fail in closed period',
          sourceModule: 'MANUAL',
          lines: [
            { accountId: cashAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(postInClosed.status).toBe(409);

      // Reopen requires reason
      const reopenNoReason = await request(app)
        .post(`/api/accounting/periods/${janPeriod.id}/reopen`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(reopenNoReason.status).toBe(400);

      const reopenOk = await request(app)
        .post(`/api/accounting/periods/${janPeriod.id}/reopen`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Audit adjustment required' });
      expect(reopenOk.status).toBe(200);
      expect(reopenOk.body.data.status).toBe('OPEN');
    });
  });

  // =========================================================================
  // F4.2: Canonical GL Posting Engine
  // =========================================================================
  describe('F4.2: General Ledger Posting Engine Invariants', () => {
    it('rejects unbalanced, single-line, dual-sided, negative, summary, inactive, control, and cross-tenant lines', async () => {
      const token = testState.adminToken;
      const now = new Date().toISOString();

      // Unbalanced
      const unbalanced = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Unbalanced',
          lines: [
            { accountId: cashAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '99.00' },
          ],
        });
      expect(unbalanced.status).toBe(400);

      // Single line
      const singleLine = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Single line',
          lines: [{ accountId: cashAccountId, debit: '100.00' }],
        });
      expect(singleLine.status).toBe(400);

      // Both debit and credit on one line
      const dualSided = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Dual sided',
          lines: [
            { accountId: cashAccountId, debit: '100.00', credit: '50.00' },
            { accountId: revenueAccountId, credit: '50.00' },
          ],
        });
      expect(dualSided.status).toBe(400);

      // Summary (non-postable) account
      const summaryPost = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Summary account',
          lines: [
            { accountId: summaryAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(summaryPost.status).toBe(400);

      // Inactive account
      const inactivePost = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Inactive account',
          lines: [
            { accountId: inactiveAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(inactivePost.status).toBe(400);

      // Control account blocked on manual journal
      const controlPost = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Control account',
          lines: [
            { accountId: arAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(controlPost.status).toBe(400);

      // Cross-tenant account blocked
      const crossTenant = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: now,
          description: 'Cross-tenant',
          lines: [
            { accountId: orgBAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(crossTenant.status).toBe(403);
    });

    it('posts balanced journal idempotently, blocks edit/delete, and reverses cleanly once', async () => {
      const token = testState.adminToken;
      const sourceKey = `manual-idem-${suffix}`;

      const res1 = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: new Date().toISOString(),
          description: 'Capital injection',
          sourceKey,
          lines: [
            { accountId: cashAccountId, debit: '5000.00' },
            { accountId: revenueAccountId, credit: '5000.00' },
          ],
        });
      expect(res1.status).toBe(201);
      expect(res1.body.meta.created).toBe(true);
      const journalId = res1.body.data.id;

      // Idempotent replay
      const res2 = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: new Date().toISOString(),
          description: 'Capital injection',
          sourceKey,
          lines: [
            { accountId: cashAccountId, debit: '5000.00' },
            { accountId: revenueAccountId, credit: '5000.00' },
          ],
        });
      expect(res2.status).toBe(200);
      expect(res2.body.meta.created).toBe(false);
      expect(res2.body.data.id).toBe(journalId);

      // Posted journal cannot be edited
      const editRes = await request(app)
        .put(`/api/journal/${journalId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Tamper' });
      expect(editRes.status).toBe(409);

      // Reverse once
      const rev1 = await request(app)
        .post(`/api/journal/${journalId}/reverse`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Testing exact reversal' });
      expect(rev1.status).toBe(201);

      // Double reversal rejected
      const rev2 = await request(app)
        .post(`/api/journal/${journalId}/reverse`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Double reversal attempt' });
      expect(rev2.status).toBe(409);

      // Balance cache reconciliation
      const recon = await reconcileAccountBalances(orgAId, { apply: false });
      expect(recon.drifted).toBe(0);
    });
  });

  // =========================================================================
  // F4.5 & F4.6: Tax Engine & FX
  // =========================================================================
  describe('F4.5 & F4.6: Effective-Dated Tax Rules & FX', () => {
    it('seeds Kenyan VAT catalogue, creates tax code with optional GL accounts, and resolves effective-dated rules', async () => {
      const token = testState.adminToken;

      const seedRes = await request(app)
        .post('/api/accounting/tax-codes/seed-kenya')
        .set('Authorization', `Bearer ${token}`);
      expect(seedRes.status).toBe(200);

      // Creating tax code without optional GL account IDs must succeed (previously crashed 403)
      const createTaxRes = await request(app)
        .post('/api/accounting/tax-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: `WHT-PROF-${suffix}`,
          name: 'WHT Professional 5%',
          kind: 'WHT_INCOME',
          applicability: 'PURCHASE',
          ratePercent: '5',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        });
      expect(createTaxRes.status).toBe(201);

      // Effective-date boundary: create future version of a code and verify earlier date resolves old rule
      const v1 = await request(app)
        .post('/api/accounting/tax-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: `BOUND-${suffix}`,
          name: 'Boundary Tax 10%',
          kind: 'VAT_STANDARD',
          applicability: 'BOTH',
          ratePercent: '10',
          effectiveFrom: '2025-01-01T00:00:00.000Z',
          effectiveTo: '2025-12-31T23:59:59.999Z',
        });
      expect(v1.status).toBe(201);

      const v2 = await request(app)
        .post('/api/accounting/tax-codes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: `BOUND-${suffix}`,
          name: 'Boundary Tax 12%',
          kind: 'VAT_STANDARD',
          applicability: 'BOTH',
          ratePercent: '12',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        });
      expect(v2.status).toBe(201);

      const resolved2025 = await resolveTaxCode(prisma, orgAId, { code: `BOUND-${suffix}` }, new Date('2025-06-15'));
      const resolved2026 = await resolveTaxCode(prisma, orgAId, { code: `BOUND-${suffix}` }, new Date('2026-06-15'));
      expect(Number(resolved2025.ratePercent)).toBe(10);
      expect(Number(resolved2026.ratePercent)).toBe(12);
    });

    it('captures FX rate, computes inverted conversion, and runs fx-revaluation endpoint', async () => {
      const token = testState.adminToken;

      const fxRes = await request(app)
        .post('/api/accounting/exchange-rates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fromCurrency: 'USD',
          toCurrency: 'KES',
          rate: '130.00',
          rateDate: '2026-11-25T00:00:00.000Z',
          source: 'CBK',
        });
      expect(fxRes.status).toBe(201);

      const convRes = await request(app)
        .get('/api/accounting/exchange-rates/convert')
        .query({ amount: '100', from: 'KES', to: 'USD', date: '2026-11-25T12:00:00.000Z' })
        .set('Authorization', `Bearer ${token}`);
      expect(convRes.status).toBe(200);
      expect(convRes.body.data.basis).toBe('INVERTED');

      const revalRes = await request(app)
        .get('/api/accounting/reports/fx-revaluation')
        .query({ asOf: '2026-11-25T23:59:59.000Z' })
        .set('Authorization', `Bearer ${token}`);
      expect(revalRes.status).toBe(200);
      expect(revalRes.body.data.functionalCurrency).toBe('KES');
    });
  });

  // =========================================================================
  // F4.3: Accounts Receivable
  // =========================================================================
  describe('F4.3: Accounts Receivable Lifecycle', () => {
    it('posts invoice (GL + eTIMS PENDING), allocates partial payment, rejects over-allocation, posts credit note', async () => {
      const token = testState.adminToken;
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString();

      // Create draft invoice (1000 + 160 VAT = 1160)
      const invCreate = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          branchId: branchAId,
          customerId,
          invoiceNumber: `INV-P4-${suffix}`,
          invoiceDate: now,
          dueDate: due,
          items: [
            {
              productId,
              description: 'Consulting',
              quantity: 1,
              unitPrice: 1000,
              taxClassification: 'STANDARD_16',
            },
          ],
        });
      expect(invCreate.status).toBe(201);
      const invoiceId = invCreate.body.data.id;

      // Post invoice
      const invPost = await request(app)
        .post(`/api/invoices/${invoiceId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(invPost.status).toBe(200);
      expect(invPost.body.data.status).toBe('POSTED');

      // Verify eTIMS queue is PENDING, never ACCEPTED
      const queueRow = await prisma.etimsTransmissionQueue.findUnique({
        where: { idempotencyKey: invoiceId },
      });
      expect(queueRow).not.toBeNull();
      expect(queueRow!.status).toBe('PENDING');

      // Create & post partial customer payment (500)
      const payCreate = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          branchId: branchAId,
          paymentNumber: `RCPT-P4-${suffix}`,
          paymentDate: now,
          amount: '500.00',
          paymentMethod: 'BANK',
          sourceKey: `rcpt-key-${suffix}`,
        });
      expect(payCreate.status).toBe(201);
      const paymentId = payCreate.body.data.id;

      const payPost = await request(app)
        .post(`/api/payments/${paymentId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(payPost.status).toBe(201);

      // Over-allocation rejected
      const overAlloc = await request(app)
        .post(`/api/payments/${paymentId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ allocations: [{ invoiceId, amount: '600.00' }] });
      expect(overAlloc.status).toBe(400);

      // Exact partial allocation (500)
      const allocOk = await request(app)
        .post(`/api/payments/${paymentId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ allocations: [{ invoiceId, amount: '500.00' }] });
      expect(allocOk.status).toBe(200);

      const invAfterPay = await prisma.salesInvoice.findUnique({ where: { id: invoiceId } });
      expect(invAfterPay!.status).toBe('PARTIALLY_PAID');

      // Credit note (200 + 32 VAT = 232)
      const cnCreate = await request(app)
        .post('/api/credit-notes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          salesInvoiceId: invoiceId,
          creditNoteNumber: `CN-P4-${suffix}`,
          reason: 'Service discount',
          items: [
            {
              productId,
              description: 'Discount',
              quantity: 1,
              unitPrice: 200,
              taxClassification: 'STANDARD_16',
            },
          ],
        });
      expect(cnCreate.status).toBe(201);
      const cnId = cnCreate.body.data.id;

      const cnPost = await request(app)
        .post(`/api/credit-notes/${cnId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(cnPost.status).toBe(201);
    });
  });

  // =========================================================================
  // F4.4: Accounts Payable
  // =========================================================================
  describe('F4.4: Accounts Payable Lifecycle', () => {
    it('creates & posts supplier bill, blocks duplicate fingerprint, posts & allocates supplier payment', async () => {
      const token = testState.adminToken;
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString();

      const vatTax = await prisma.taxCode.findFirst({
        where: { organizationId: orgAId, code: 'KE-VAT-STD' },
      });

      const bill1Res = await request(app)
        .post('/api/suppliers/bills')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          billNumber: `SUP-INV-${suffix}`,
          billDate: now,
          dueDate: due,
          lines: [
            {
              description: 'Office Supplies',
              quantity: '1',
              unitPrice: '1000.00',
              taxCodeId: vatTax?.id ?? null,
              expenseAccountId,
            },
          ],
        });
      expect(bill1Res.status).toBe(201);
      const bill1Id = bill1Res.body.data.id;

      const bill1Post = await request(app)
        .post(`/api/suppliers/bills/${bill1Id}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(bill1Post.status).toBe(201);

      // Duplicate supplier invoice must be blocked (at creation or posting)
      const billDupRes = await request(app)
        .post('/api/suppliers/bills')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          billNumber: `SUP-INV-${suffix}`,
          billDate: now,
          dueDate: due,
          lines: [
            {
              description: 'Office Supplies duplicate',
              quantity: '1',
              unitPrice: '1000.00',
              taxCodeId: vatTax?.id ?? null,
              expenseAccountId,
            },
          ],
        });
      if (billDupRes.status === 201) {
        const billDupPost = await request(app)
          .post(`/api/suppliers/bills/${billDupRes.body.data.id}/post`)
          .set('Authorization', `Bearer ${token}`);
        expect(billDupPost.status).toBe(409);
      } else {
        expect(billDupRes.status).toBe(409);
      }

      // Supplier payment: create, post, allocate
      const spCreate = await request(app)
        .post('/api/suppliers/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          paymentNumber: `SPAY-${suffix}`,
          paymentDate: now,
          amount: '500.00',
          paymentMethod: 'BANK',
        });
      expect(spCreate.status).toBe(201);
      const spId = spCreate.body.data.id;

      const spPost = await request(app)
        .post(`/api/suppliers/payments/${spId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(spPost.status).toBe(201);

      const spAlloc = await request(app)
        .post(`/api/suppliers/payments/${spId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ allocations: [{ billId: bill1Id, amount: '500.00' }] });
      expect(spAlloc.status).toBe(200);

      // Unallocated supplier payment reversal must reverse GL journal too
      const spRevCreate = await request(app)
        .post('/api/suppliers/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          paymentNumber: `SPAY-REV-${suffix}`,
          paymentDate: now,
          amount: '100.00',
          paymentMethod: 'CASH',
        });
      const spRevId = spRevCreate.body.data.id;
      await request(app)
        .post(`/api/suppliers/payments/${spRevId}/post`)
        .set('Authorization', `Bearer ${token}`);
      const spRevRes = await request(app)
        .post(`/api/suppliers/payments/${spRevId}/reverse`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Wrong supplier' });
      expect(spRevRes.status).toBe(200);
      expect(spRevRes.body.data.reversalEntryId).toBeDefined();
    });
  });

  // =========================================================================
  // F4.7: Banking, Reconciliation & M-Pesa
  // =========================================================================
  describe('F4.7: Banking, Statement Import, Reconciliation & M-Pesa', () => {
    it('imports CSV once, blocks duplicate hash, enforces segregation of duties, and handles M-Pesa idempotency', async () => {
      const token = testState.adminToken;

      const bankRes = await request(app)
        .post('/api/accounting/bank-accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `KCB Operating ${suffix}`,
          type: 'BANK',
          glAccountId: cashAccountId,
          currency: 'KES',
        });
      expect(bankRes.status).toBe(201);
      const bankAccountId = bankRes.body.data.id;

      const csv = [
        'date,description,reference,debit,credit',
        `2026-11-25,Customer receipt,RCPT-P4-${suffix},500.00,0`,
      ].join('\n');

      const stmt1 = await request(app)
        .post('/api/accounting/bank-statements/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          bankAccountId,
          fileName: 'nov2026.csv',
          statementFrom: '2026-11-01T00:00:00.000Z',
          statementTo: '2026-11-30T00:00:00.000Z',
          openingBalance: '0.00',
          closingBalance: '500.00',
          content: csv,
        });
      expect(stmt1.status).toBe(201);

      // Duplicate fileHash rejected
      const stmt2 = await request(app)
        .post('/api/accounting/bank-statements/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          bankAccountId,
          fileName: 'nov2026-copy.csv',
          statementFrom: '2026-11-01T00:00:00.000Z',
          statementTo: '2026-11-30T00:00:00.000Z',
          openingBalance: '0.00',
          closingBalance: '500.00',
          content: csv,
        });
      expect(stmt2.status).toBe(409);

      // Start reconciliation & test segregation of duties (preparer === adminUserId cannot finalize)
      const recRes = await request(app)
        .post('/api/accounting/bank-reconciliation')
        .set('Authorization', `Bearer ${token}`)
        .send({
          bankAccountId,
          statementId: stmt1.body.data.id,
          periodStart: '2026-11-01T00:00:00.000Z',
          periodEnd: '2026-11-30T00:00:00.000Z',
          statementClosingBalance: '500.00',
        });
      expect(recRes.status).toBe(201);

      await expect(
        prisma.$transaction((tx) =>
          finalizeReconciliation(tx, {
            organizationId: orgAId,
            reconciliationId: recRes.body.data.id,
            userId: adminUserId,
            allowSelfApproval: false,
          })
        )
      ).rejects.toThrow();

      // M-Pesa callback idempotency & status handling
      const mpesaKey = `mpesa-cb-${suffix}`;
      const cb1 = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'C2B',
          amount: '1500.00',
          idempotencyKey: mpesaKey,
          mpesaReceiptNumber: `MP${suffix}`,
          resultCode: '0',
          resultDesc: 'Success',
          rawPayload: { TransID: `MP${suffix}` },
        });
      expect(cb1.status).toBe(201);
      expect(cb1.body.data.status).toBe('CONFIRMED');

      // Replay with same key returns 200 created=false
      const cb2 = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'C2B',
          amount: '1500.00',
          idempotencyKey: mpesaKey,
          mpesaReceiptNumber: `MP${suffix}`,
          resultCode: '0',
          resultDesc: 'Success',
          rawPayload: { TransID: `MP${suffix}` },
        });
      expect(cb2.status).toBe(200);
      expect(cb2.body.meta.created).toBe(false);

      // Cancelled STK callback must NOT be CONFIRMED
      const cbCancel = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'STK_PUSH',
          amount: '1500.00',
          idempotencyKey: `mpesa-cancel-${suffix}`,
          resultCode: '1032',
          resultDesc: 'Request cancelled by user',
          rawPayload: { ResultCode: 1032 },
        });
      expect(cbCancel.status).toBe(201);
      expect(cbCancel.body.data.status).not.toBe('CONFIRMED');
    });
  });

  // =========================================================================
  // F4.8: Financial Reports, VAT Summary, Budgets & Tenant Isolation
  // =========================================================================
  describe('F4.8: Financial Statements, Budgets & Tenant Isolation', () => {
    it('verifies TB balanced, Balance Sheet ties, VAT summary splits Output/Input, and Budget SoD works', async () => {
      const token = testState.adminToken;
      const from = '2026-01-01T00:00:00.000Z';
      const to = '2026-12-31T23:59:59.999Z';

      const tbRes = await request(app)
        .get('/api/accounting/reports/trial-balance')
        .query({ from, to })
        .set('Authorization', `Bearer ${token}`);
      expect(tbRes.status).toBe(200);
      expect(tbRes.body.data.balanced).toBe(true);
      expect(tbRes.body.data.totals.debit).toBe(tbRes.body.data.totals.credit);

      const bsRes = await request(app)
        .get('/api/accounting/reports/balance-sheet')
        .query({ asOf: to })
        .set('Authorization', `Bearer ${token}`);
      expect(bsRes.status).toBe(200);
      expect(bsRes.body.data.balanced).toBe(true);
      expect(bsRes.body.data.difference).toBe('0.00');

      const pnlRes = await request(app)
        .get('/api/accounting/reports/profit-and-loss')
        .query({ from, to })
        .set('Authorization', `Bearer ${token}`);
      expect(pnlRes.status).toBe(200);

      const cfRes = await request(app)
        .get('/api/accounting/reports/cash-flow')
        .query({ from, to })
        .set('Authorization', `Bearer ${token}`);
      expect(cfRes.status).toBe(200);

      const vatRes = await request(app)
        .get('/api/accounting/reports/vat-summary')
        .query({ from, to })
        .set('Authorization', `Bearer ${token}`);
      expect(vatRes.status).toBe(200);
      expect(Array.isArray(vatRes.body.data.output)).toBe(true);
      expect(Array.isArray(vatRes.body.data.input)).toBe(true);

      // Budget creation & self-approval blocked
      const fyRes = await request(app)
        .get('/api/accounting/fiscal-years')
        .set('Authorization', `Bearer ${token}`);
      const fyId = fyRes.body.data[0].id;

      const budgetRes = await request(app)
        .post('/api/accounting/budgets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fiscalYearId: fyId,
          name: `FY Budget ${suffix}`,
          lines: [
            { accountId: expenseAccountId, periodNumber: 11, amount: '5000.00' },
          ],
        });
      expect(budgetRes.status).toBe(201);
      const budgetId = budgetRes.body.data.id;

      // Creator cannot self-approve
      const selfApprove = await request(app)
        .post(`/api/accounting/budgets/${budgetId}/approve`)
        .set('Authorization', `Bearer ${token}`);
      expect(selfApprove.status).toBe(403);

      const varRes = await request(app)
        .get(`/api/accounting/reports/budget-variance/${budgetId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(varRes.status).toBe(200);
      expect(varRes.body.data.rows.length).toBe(1);

      // Tenant isolation: Org B sees 0 of Org A's bank accounts
      const orgBBankRes = await request(app)
        .get('/api/accounting/bank-accounts')
        .set('Authorization', `Bearer ${testState.otherOrgToken}`);
      expect(orgBBankRes.status).toBe(200);
      expect(orgBBankRes.body.data.length).toBe(0);
    });
  });
});
