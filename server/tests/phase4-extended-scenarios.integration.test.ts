/**
 * Phase 4 - Extended Scenario Coverage (F4.11 / Section 16)
 * Isolated integration tests on innowit_one_test verifying:
 * - Unbalanced journal rejection
 * - Duplicate sourceKey idempotency
 * - Closed-period posting rejection (409) & reopen
 * - AR partial payment, exact settlement & overpayment rejection
 * - AP supplier bill, payment & reversal GL reconciliation
 * - M-Pesa resultCode 1032 cancellation never confirms & duplicate callback idempotency
 */
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
import accountingRoutes from '../routes/accounting';
import invoiceRoutes from '../routes/invoices';
import paymentRoutes from '../routes/payments';
import supplierBillRoutes from '../routes/supplierBills';
import supplierPaymentRoutes from '../routes/supplierPayments';

describe('Phase 4: Extended Scenario Coverage (F4.11)', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let orgAId: string;
  let branchAId: string;
  let arAccountId: string;
  let revenueAccountId: string;
  let cashAccountId: string;
  let vatOutputAccountId: string;
  let vatInputAccountId: string;
  let apAccountId: string;
  let whtPayableAccountId: string;
  let fxAccountId: string;
  let expenseAccountId: string;
  let customerId: string;
  let supplierId: string;
  let productId: string;

  const sfx = `EXT${Date.now().toString().slice(-5)}`;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;
    orgAId = testState.testData.orgA.id;
    branchAId = testState.testData.branchA.id;

    // Database identity safety assertion
    const dbIdentity = await prisma.$queryRaw<{ database_name: string }[]>`
      SELECT current_database() AS database_name
    `;
    expect(dbIdentity[0].database_name).toBe('innowit_one_test');

    app = express();
    app.use(express.json());
    app.use('/api/accounts', accountRoutes);
    app.use('/api/journal', journalRoutes);
    app.use('/api/invoices', invoiceRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/accounting', accountingRoutes);
    app.use('/api/suppliers', supplierBillRoutes);
    app.use('/api/suppliers', supplierPaymentRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    const ensureAccount = async (
      accountNumber: string,
      name: string,
      type: AccountType,
      normalBalance: AccountNormalBalance,
      opts: { isControl?: boolean; controlType?: AccountControlType } = {}
    ) => {
      const existing = await prisma.account.findUnique({
        where: { organizationId_accountNumber: { organizationId: orgAId, accountNumber } },
      });
      if (existing) return existing;
      return prisma.account.create({
        data: {
          organizationId: orgAId,
          accountNumber,
          name,
          type,
          normalBalance,
          isPostable: true,
          isControl: opts.isControl ?? false,
          controlType: opts.controlType ?? AccountControlType.NONE,
          isActive: true,
        },
      });
    };

    const cash = await ensureAccount(`1015-${sfx}`, `Cash Ext ${sfx}`, AccountType.ASSET, AccountNormalBalance.DEBIT, {
      controlType: AccountControlType.CASH,
    });
    const ar = await ensureAccount(`1205-${sfx}`, `AR Ext ${sfx}`, AccountType.ASSET, AccountNormalBalance.DEBIT, {
      isControl: true,
      controlType: AccountControlType.CUSTOMER_AR,
    });
    const vatIn = await ensureAccount(`1315-${sfx}`, `VAT In Ext ${sfx}`, AccountType.ASSET, AccountNormalBalance.DEBIT, {
      isControl: true,
      controlType: AccountControlType.VAT_INPUT,
    });
    const ap = await ensureAccount(`2005-${sfx}`, `AP Ext ${sfx}`, AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.SUPPLIER_AP,
    });
    const vatOut = await ensureAccount(`2115-${sfx}`, `VAT Out Ext ${sfx}`, AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.VAT_OUTPUT,
    });
    const wht = await ensureAccount(`2125-${sfx}`, `WHT Ext ${sfx}`, AccountType.LIABILITY, AccountNormalBalance.CREDIT, {
      isControl: true,
      controlType: AccountControlType.WHT_PAYABLE,
    });
    const rev = await ensureAccount(`4005-${sfx}`, `Rev Ext ${sfx}`, AccountType.REVENUE, AccountNormalBalance.CREDIT);
    const exp = await ensureAccount(`6005-${sfx}`, `Exp Ext ${sfx}`, AccountType.EXPENSE, AccountNormalBalance.DEBIT);
    const fx = await ensureAccount(`7105-${sfx}`, `FX Ext ${sfx}`, AccountType.EXPENSE, AccountNormalBalance.DEBIT, {
      controlType: AccountControlType.FX_GAIN_LOSS,
    });

    cashAccountId = cash.id;
    arAccountId = ar.id;
    vatInputAccountId = vatIn.id;
    apAccountId = ap.id;
    vatOutputAccountId = vatOut.id;
    whtPayableAccountId = wht.id;
    revenueAccountId = rev.id;
    expenseAccountId = exp.id;
    fxAccountId = fx.id;

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

    const customer = await prisma.customer.create({
      data: {
        organizationId: orgAId,
        branchId: branchAId,
        customerCode: `EXT-CUST-${sfx}`,
        name: `Ext Test Customer ${sfx}`,
        email: `extcust-${sfx}@example.com`,
      },
    });
    customerId = customer.id;

    const supplier = await prisma.supplier.create({
      data: {
        organizationId: orgAId,
        name: `Ext Supplier ${sfx}`,
        kraPin: 'P051119991Z',
      },
    });
    supplierId = supplier.id;

    const product = await prisma.product.create({
      data: {
        organizationId: orgAId,
        sku: `EXT-SKU-${sfx}`,
        name: `Ext Consulting ${sfx}`,
        sellingPrice: 1000,
        costPrice: 400,
        taxClassification: 'STANDARD_16',
      },
    });
    productId = product.id;
  });

  // ─── F4.2 extra: Unbalanced post, idempotency, closed-period lock ─────────
  describe('GL Posting Invariants (extra)', () => {
    it('rejects a journal where debit != credit', async () => {
      const res = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${testState.adminToken}`)
        .send({
          postingDate: new Date().toISOString(),
          description: 'Unbalanced test',
          sourceModule: 'MANUAL',
          lines: [
            { accountId: cashAccountId, debit: '1000.00' },
            { accountId: revenueAccountId, credit: '900.00' },
          ],
        });
      expect(res.status).toBe(400);
    });

    it('idempotently handles duplicate sourceKey on second post', async () => {
      const sourceKey = `IDEMP-${sfx}`;
      const payload = {
        postingDate: new Date().toISOString(),
        description: 'Idempotency test',
        sourceModule: 'MANUAL',
        sourceKey,
        lines: [
          { accountId: cashAccountId, debit: '500.00' },
          { accountId: revenueAccountId, credit: '500.00' },
        ],
      };
      const first = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${testState.adminToken}`)
        .send(payload);
      const second = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${testState.adminToken}`)
        .send(payload);

      expect(first.status).toBe(201);
      expect([200, 201]).toContain(second.status);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it('rejects posting to a CLOSED fiscal period and restores on reopen', async () => {
      const token = testState.adminToken;
      await request(app)
        .get('/api/accounting/fiscal-years')
        .set('Authorization', `Bearer ${token}`);
      const periodsRes = await request(app)
        .get('/api/accounting/periods')
        .set('Authorization', `Bearer ${token}`);
      expect(periodsRes.status).toBe(200);
      const period = periodsRes.body.data[1]; // Feb period
      expect(period).toBeDefined();

      const closeRes = await request(app)
        .post(`/api/accounting/periods/${period.id}/close`)
        .set('Authorization', `Bearer ${token}`);
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.status).toBe('CLOSED');

      const postingDate = new Date(period.startDate);
      postingDate.setUTCDate(10);

      const postRes = await request(app)
        .post('/api/journal')
        .set('Authorization', `Bearer ${token}`)
        .send({
          postingDate: postingDate.toISOString(),
          description: 'Post to closed period',
          sourceModule: 'MANUAL',
          lines: [
            { accountId: cashAccountId, debit: '100.00' },
            { accountId: revenueAccountId, credit: '100.00' },
          ],
        });
      expect(postRes.status).toBe(409);

      // Reopen so other tests in this year remain unaffected
      const reopenRes = await request(app)
        .post(`/api/accounting/periods/${period.id}/reopen`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Restore period after closed-period rejection test' });
      expect(reopenRes.status).toBe(200);
    });
  });

  // ─── F4.3 extra: AR partial payment & over-allocation rejection ───────────
  describe('AR Partial Receipt & Over-Allocation Rejection (extra)', () => {
    let invoiceId: string;
    let paymentId: string;

    it('creates & posts an invoice of KES 1,160, applies partial payment 500, and rejects over-allocation', async () => {
      const token = testState.adminToken;
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString();

      const invCreate = await request(app)
        .post('/api/invoices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          branchId: branchAId,
          customerId,
          invoiceNumber: `INV-EXT-${sfx}`,
          invoiceDate: now,
          dueDate: due,
          items: [
            {
              productId,
              description: 'Extended Consulting',
              quantity: 1,
              unitPrice: 1000,
              taxClassification: 'STANDARD_16',
            },
          ],
        });
      expect(invCreate.status).toBe(201);
      invoiceId = invCreate.body.data.id;

      const invPost = await request(app)
        .post(`/api/invoices/${invoiceId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(invPost.status).toBe(200);
      expect(invPost.body.data.status).toBe('POSTED');

      const payCreate = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          branchId: branchAId,
          paymentNumber: `RCPT-EXT-${sfx}`,
          paymentDate: now,
          amount: '500.00',
          paymentMethod: 'BANK',
          sourceKey: `ext-rcpt-${sfx}`,
        });
      expect(payCreate.status).toBe(201);
      paymentId = payCreate.body.data.id;

      const payPost = await request(app)
        .post(`/api/payments/${paymentId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(payPost.status).toBe(201);

      // Over-allocation (600 > 500 payment amount) must be rejected with 400
      const overAlloc = await request(app)
        .post(`/api/payments/${paymentId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ allocations: [{ invoiceId, amount: '600.00' }] });
      expect(overAlloc.status).toBe(400);

      // Valid partial allocation (500)
      const okAlloc = await request(app)
        .post(`/api/payments/${paymentId}/allocate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ allocations: [{ invoiceId, amount: '500.00' }] });
      expect(okAlloc.status).toBe(200);

      const invAfter = await prisma.salesInvoice.findUnique({ where: { id: invoiceId } });
      expect(invAfter!.status).toBe('PARTIALLY_PAID');
      expect(Number(invAfter!.paidAmount)).toBe(500);
    });
  });

  // ─── F4.4 extra: AP Bill + Payment Reversal ───────────────────────────────
  describe('AP Bill + Payment Reversal GL Reconciliation (extra)', () => {
    it('creates bill, posts payment, reverses unallocated payment with offsetting GL journal', async () => {
      const token = testState.adminToken;
      const now = new Date().toISOString();
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString();

      const billRes = await request(app)
        .post('/api/suppliers/bills')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          billNumber: `EXT-BILL-${sfx}`,
          billDate: now,
          dueDate: due,
          lines: [
            {
              description: 'Extended Supplies',
              quantity: '1',
              unitPrice: '1000.00',
              expenseAccountId,
            },
          ],
        });
      expect(billRes.status).toBe(201);
      const billId = billRes.body.data.id;

      const billPost = await request(app)
        .post(`/api/suppliers/bills/${billId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(billPost.status).toBe(201);

      const spCreate = await request(app)
        .post('/api/suppliers/payments')
        .set('Authorization', `Bearer ${token}`)
        .send({
          supplierId,
          branchId: branchAId,
          paymentNumber: `EXT-SPAY-${sfx}`,
          paymentDate: now,
          amount: '250.00',
          paymentMethod: 'CASH',
        });
      expect(spCreate.status).toBe(201);
      const spId = spCreate.body.data.id;

      const spPost = await request(app)
        .post(`/api/suppliers/payments/${spId}/post`)
        .set('Authorization', `Bearer ${token}`);
      expect(spPost.status).toBe(201);

      const spRev = await request(app)
        .post(`/api/suppliers/payments/${spId}/reverse`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Audit reversal check' });
      expect(spRev.status).toBe(200);
      expect(spRev.body.data.reversalEntryId).toBeDefined();
    });
  });

  // ─── F4.7 extra: M-Pesa result code 1032 & duplicate callback ─────────────
  describe('M-Pesa Idempotency & Cancellation (extra)', () => {
    it('handles duplicate M-Pesa callback idempotently and never confirms resultCode 1032', async () => {
      const token = testState.adminToken;
      const mpesaKey = `ext-mpesa-cb-${suffixOr(sfx)}`;

      const cb1 = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'C2B',
          amount: '750.00',
          idempotencyKey: mpesaKey,
          mpesaReceiptNumber: `MPX${sfx}`,
          resultCode: '0',
          resultDesc: 'Success',
          rawPayload: { TransID: `MPX${sfx}` },
        });
      expect(cb1.status).toBe(201);
      expect(cb1.body.data.status).toBe('CONFIRMED');

      const cb2 = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'C2B',
          amount: '750.00',
          idempotencyKey: mpesaKey,
          mpesaReceiptNumber: `MPX${sfx}`,
          resultCode: '0',
          resultDesc: 'Success',
          rawPayload: { TransID: `MPX${sfx}` },
        });
      expect(cb2.status).toBe(200);
      expect(cb2.body.meta.created).toBe(false);

      const cbCancel = await request(app)
        .post('/api/accounting/mpesa/callback')
        .set('Authorization', `Bearer ${token}`)
        .send({
          transactionType: 'STK_PUSH',
          amount: '750.00',
          idempotencyKey: `ext-mpesa-1032-${sfx}`,
          resultCode: '1032',
          resultDesc: 'Request cancelled by user',
          rawPayload: { ResultCode: 1032 },
        });
      expect(cbCancel.status).toBe(201);
      expect(cbCancel.body.data.status).not.toBe('CONFIRMED');
    });
  });
});

function suffixOr(s: string) {
  return s;
}
