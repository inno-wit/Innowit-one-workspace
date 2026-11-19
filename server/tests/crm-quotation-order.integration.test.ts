import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import quotationRoutes from '../routes/quotations';
import dealRoutes from '../routes/deals';
import salesOrderRoutes from '../routes/salesOrders';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.11: CRM Quotation-to-Order Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let customerId: string;
  let dealId: string;
  let productId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/quotations', quotationRoutes);
    app.use('/api/deals', dealRoutes);
    app.use('/api/sales-orders', salesOrderRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    // 1. Create customer
    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `QUO-CUST-${Date.now()}`,
        name: 'Quotation-to-Order Customer Ltd',
      },
    });
    customerId = cust.id;

    // 2. Create product
    const prod = await prisma.product.create({
      data: {
        organizationId: testState.testData.orgA.id,
        sku: `SKU-CRM-${Date.now()}`,
        name: 'Enterprise Software License',
        costPrice: 50000,
        sellingPrice: 150000,
        taxClassification: 'STANDARD_16',
      },
    });
    productId = prod.id;

    // 3. Create deal and mark WON
    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId,
        assignedToId: testState.testData.users[0].id,
        title: 'Commercial ERP Deal',
        value: 1500000,
        stage: 'CLOSED',
        closeOutcome: 'WON',
        closedAt: new Date(),
        winProbability: 100,
      },
    });
    dealId = deal.id;
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  it('Step 1-4: Generate quotation from won deal', async () => {
    const quoNumber = `QUO-WON-${Date.now()}`;
    const validUntil = new Date(Date.now() + 14 * 86400000).toISOString();

    const res = await request(app)
      .post(`/api/quotations/from-deal/${dealId}`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({
        quotationNumber: quoNumber,
        validUntil,
        items: [
          {
            productId,
            description: '10x Enterprise Software License',
            quantity: 10,
            unitPrice: 150000,
            taxRate: 16,
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.quotationNumber).toBe(quoNumber);
    expect(res.body.data.dealId).toBe(dealId);

    // Verify wonQuotationNumber is persisted on the Deal
    const updatedDeal = await prisma.deal.findUnique({ where: { id: dealId } });
    expect(updatedDeal!.wonQuotationNumber).toBe(quoNumber);

    // Verify quotation exists in PostgreSQL
    const dbQuotation = await prisma.quotation.findUnique({
      where: { id: res.body.data.id },
      include: { items: true },
    });
    expect(dbQuotation).not.toBeNull();
    expect(dbQuotation!.items.length).toBe(1);
    expect(Number(dbQuotation!.items[0].quantity)).toBe(10);
  });

  it('Step 5-7: Convert approved quotation into a sales order', async () => {
    // Find the quotation created in the previous test
    const quotation = await prisma.quotation.findUnique({ where: { dealId } });
    expect(quotation).not.toBeNull();

    const orderNumber = `SO-CRM-${Date.now()}`;
    const convertRes = await request(app)
      .post(`/api/quotations/${quotation!.id}/convert-to-order`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({ orderNumber });

    expect(convertRes.status).toBe(201);
    expect(convertRes.body.data).toBeDefined();
    expect(convertRes.body.data.orderNumber).toBe(orderNumber);
    expect(convertRes.body.data.customerId).toBe(customerId);
    expect(convertRes.body.data.orderStatus).toBe('CONFIRMED');

    // Verify SalesOrder in PostgreSQL
    const dbOrder = await prisma.salesOrder.findUnique({
      where: { id: convertRes.body.data.id },
      include: { items: true },
    });
    expect(dbOrder).not.toBeNull();
    expect(dbOrder!.organizationId).toBe(testState.testData.orgA.id);
    expect(dbOrder!.quotationId).toBe(quotation!.id);
    expect(dbOrder!.items.length).toBe(1);
    expect(Number(dbOrder!.items[0].quantity)).toBe(10);
    expect(Number(dbOrder!.items[0].unitPrice)).toBe(150000);
  });

  it('Step 8: Retry conversion and prove idempotency / duplicate order rejection', async () => {
    const quotation = await prisma.quotation.findUnique({ where: { dealId } });
    expect(quotation).not.toBeNull();

    const retryRes = await request(app)
      .post(`/api/quotations/${quotation!.id}/convert-to-order`)
      .set('Authorization', `Bearer ${getAdminToken()}`)
      .send({ orderNumber: `SO-DUP-${Date.now()}` });

    expect(retryRes.status).toBe(400);
    expect(retryRes.body.code).toBe('ALREADY_CONVERTED');

    // Confirm only one sales order exists for this quotation
    const orderCount = await prisma.salesOrder.count({ where: { quotationId: quotation!.id } });
    expect(orderCount).toBe(1);
  });
});
