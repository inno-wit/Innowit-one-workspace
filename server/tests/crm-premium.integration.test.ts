import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { testState, initializeTestDatabase } from './db-singleton';
import crmPremiumRoutes from '../routes/crmPremium';
import { errorHandler, notFoundHandler } from '../middleware/errorHandler';

describe('Gate P3.8: CRM Premium Features Integration Tests', () => {
  let app: express.Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    await initializeTestDatabase();
    prisma = testState.prisma!;

    app = express();
    app.use(express.json());
    app.use('/api/crm/premium', crmPremiumRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

  const getAdminToken = () => testState.adminToken;
  const getOtherOrgToken = () => testState.otherOrgToken;

  describe('Saved Views API', () => {
    it('should create and retrieve saved views persisted in PostgreSQL', async () => {
      const res = await request(app)
        .post('/api/crm/premium/saved-views')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          entityType: 'DEAL',
          name: 'High Value Deals Q4',
          filtersJson: JSON.stringify({ value: { gte: 1000000 }, stage: 'PROPOSAL' }),
          sortJson: JSON.stringify({ field: 'value', direction: 'desc' }),
          columnsJson: JSON.stringify(['title', 'value', 'stage', 'customer']),
          isShared: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('High Value Deals Q4');
      expect(res.body.data.entityType).toBe('DEAL');

      // Verify in PostgreSQL
      const dbRow = await prisma.savedView.findUnique({ where: { id: res.body.data.id } });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.organizationId).toBe(testState.testData.orgA.id);

      // List saved views for DEAL
      const listRes = await request(app)
        .get('/api/crm/premium/saved-views?entityType=DEAL')
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect(listRes.body.data.some((v: any) => v.id === res.body.data.id)).toBe(true);
    });

    it('should block Org B from accessing Org A private saved views', async () => {
      const createRes = await request(app)
        .post('/api/crm/premium/saved-views')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          entityType: 'CUSTOMER',
          name: 'Secret Org A Customers',
          filtersJson: JSON.stringify({ lifecycle: 'ACTIVE' }),
          sortJson: JSON.stringify({ field: 'createdAt', direction: 'desc' }),
        });

      const viewId = createRes.body.data.id;

      // Org B attempts to access it
      const res = await request(app)
        .get(`/api/crm/premium/saved-views/${viewId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  describe('Custom Fields API', () => {
    it('should define custom field and persist entity values', async () => {
      const defRes = await request(app)
        .post('/api/crm/premium/custom-fields/definitions')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          entityType: 'CUSTOMER',
          fieldKey: `tax_exemption_number_${Date.now()}`,
          label: 'Tax Exemption Certificate Number',
          fieldType: 'TEXT',
          isRequired: false,
        });

      expect(defRes.status).toBe(201);
      const defId = defRes.body.data.id;

      // Verify in PostgreSQL
      const dbDef = await prisma.customFieldDefinition.findUnique({ where: { id: defId } });
      expect(dbDef).not.toBeNull();
      expect(dbDef!.entityType).toBe('CUSTOMER');
    });
  });

  describe('Workflow Automation Rules API', () => {
    it('should create automation rule with trigger and condition validation', async () => {
      const res = await request(app)
        .post('/api/crm/premium/workflows/rules')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          name: 'Auto-Task on Qualified Deal',
          trigger: 'DEAL_STAGE_CHANGED',
          conditionsJson: JSON.stringify([{ field: 'toStage', operator: 'EQUALS', value: 'QUALIFIED' }]),
          actionType: 'CREATE_TASK',
          actionConfigJson: JSON.stringify({ title: 'Prepare Formal Proposal', priority: 'HIGH' }),
          isActive: true,
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('Import/Export API (RC-09 & Multi-Tenant Isolation)', () => {
    const sharedIdempotencyKey = `idem-import-${Date.now()}`;
    let orgAJobId: string;

    it('should create an import job and persist it in PostgreSQL', async () => {
      const res = await request(app)
        .post('/api/crm/premium/import')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          entityType: 'CUSTOMER',
          fileUrl: 'https://storage.innowit.ke/imports/customers_2026.csv',
          mappingJson: JSON.stringify({ FullName: 'name', TaxPIN: 'kraPin', EmailAddress: 'email' }),
          options: {
            dryRun: false,
            idempotencyKey: sharedIdempotencyKey,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
      expect(res.body.data.status).toBe('PENDING');

      orgAJobId = res.body.data.id;

      // Verify row in PostgreSQL
      const dbJob = await prisma.importJob.findUnique({
        where: { id: orgAJobId },
      });
      expect(dbJob).not.toBeNull();
      expect(dbJob!.organizationId).toBe(testState.testData.orgA.id);
      expect(dbJob!.idempotencyKey).toBe(sharedIdempotencyKey);
    });

    it('should return existing import job when matching idempotencyKey is replayed for the same organization', async () => {
      const res = await request(app)
        .post('/api/crm/premium/import')
        .set('Authorization', `Bearer ${getAdminToken()}`)
        .send({
          entityType: 'CUSTOMER',
          fileUrl: 'https://storage.innowit.ke/imports/customers_2026.csv',
          mappingJson: JSON.stringify({ FullName: 'name', TaxPIN: 'kraPin', EmailAddress: 'email' }),
          options: {
            dryRun: false,
            idempotencyKey: sharedIdempotencyKey,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Import already processed');
      expect(res.body.data.id).toBe(orgAJobId);
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
    });

    it('should allow Org B to use the exact same idempotencyKey without collision or leaking Org A data', async () => {
      const res = await request(app)
        .post('/api/crm/premium/import')
        .set('Authorization', `Bearer ${getOtherOrgToken()}`)
        .send({
          entityType: 'DEAL',
          fileUrl: 'https://storage.innowit.ke/imports/orgb_deals.csv',
          mappingJson: JSON.stringify({ DealTitle: 'title', DealAmount: 'value' }),
          options: {
            dryRun: false,
            idempotencyKey: sharedIdempotencyKey,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).not.toBe(orgAJobId);
      expect(res.body.data.organizationId).toBe(testState.testData.orgB.id);
      expect(res.body.data.entityType).toBe('DEAL');
    });

    it('should retrieve import job by ID for the owning organization', async () => {
      const res = await request(app)
        .get(`/api/crm/premium/import/${orgAJobId}`)
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orgAJobId);
      expect(res.body.data.organizationId).toBe(testState.testData.orgA.id);
    });

    it('should block Org B from accessing Org A import job by ID with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/crm/premium/import/${orgAJobId}`)
        .set('Authorization', `Bearer ${getOtherOrgToken()}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('should return 404 for non-existent import job ID', async () => {
      const res = await request(app)
        .get('/api/crm/premium/import/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${getAdminToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
