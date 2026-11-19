import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import customerRoutes from '../routes/customers';
import dealRoutes from '../routes/deals';
import taskRoutes from '../routes/tasks';
import salesRepRoutes from '../routes/salesReps';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.10: CRM Multi-Tenant Isolation and RBAC Security Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;
  let orgACustomerId: string;
  let orgADealId: string;
  let orgATaskId: string;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/customers', customerRoutes);
    app.use('/api/deals', dealRoutes);
    app.use('/api/tasks', taskRoutes);
    app.use('/api/sales-reps', salesRepRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    // Create Org A Customer
    const cust = await prisma.customer.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerCode: `SEC-CUST-A-${Date.now()}`,
        name: 'Confidential Client Org A',
      },
    });
    orgACustomerId = cust.id;

    // Create Org A Deal
    const deal = await prisma.deal.create({
      data: {
        organizationId: testState.testData.orgA.id,
        customerId: cust.id,
        assignedToId: testState.testData.users[0].id,
        title: 'Top Secret Deal Org A',
        value: 10000000,
        stage: 'NEW_LEAD',
      },
    });
    orgADealId = deal.id;

    // Create Org A Task
    const task = await prisma.task.create({
      data: {
        organizationId: testState.testData.orgA.id,
        title: 'Confidential Strategy Review',
        assignedToId: testState.testData.users[0].id,
        customerId: cust.id,
        dealId: deal.id,
      },
    });
    orgATaskId = task.id;
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('Cross-Organization Read Protection', () => {
    it('Org B user cannot read Org A customer by ID', async () => {
      const res = await request(app)
        .get(`/api/customers/${orgACustomerId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect([403, 404]).toContain(res.status);
    });

    it('Org B user cannot read Org A deal by ID', async () => {
      const res = await request(app)
        .get(`/api/deals/${orgADealId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect([403, 404]).toContain(res.status);
    });

    it('Org B user cannot read Org A task by ID', async () => {
      const res = await request(app)
        .get(`/api/tasks/${orgATaskId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('Cross-Organization Write and Mutation Protection', () => {
    it('Org B user cannot update Org A customer', async () => {
      const res = await request(app)
        .put(`/api/customers/${orgACustomerId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({ name: 'Hacked Name' });

      expect([403, 404]).toContain(res.status);

      const dbCust = await prisma.customer.findUnique({ where: { id: orgACustomerId } });
      expect(dbCust!.name).toBe('Confidential Client Org A');
    });

    it('Org B user cannot update Org A deal or stage', async () => {
      const res = await request(app)
        .post(`/api/deals/${orgADealId}/stage`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({ stage: 'QUALIFIED' });

      expect([403, 404]).toContain(res.status);

      const dbDeal = await prisma.deal.findUnique({ where: { id: orgADealId } });
      expect(dbDeal!.stage).toBe('NEW_LEAD');
    });
  });

  describe('Cross-Organization Foreign Key Linkage Prevention', () => {
    it('Org B user cannot create a deal linked to Org A customer', async () => {
      const res = await request(app)
        .post('/api/deals')
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({
          customerId: orgACustomerId, // Org A customer
          assignedToId: testState.testData.users[2].id, // Org B user
          title: 'Illegitimate Linked Deal',
          value: 500000,
        });

      expect([403, 404]).toContain(res.status);
    });

    it('Org B user cannot create a task linked to Org A customer or deal', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({
          title: 'Illegitimate Linked Task',
          assignedToId: testState.testData.users[2].id,
          customerId: orgACustomerId,
          dealId: orgADealId,
        });

      expect([403, 404]).toContain(res.status);
    });
  });
});
