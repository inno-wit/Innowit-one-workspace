-- Phase 3 CRM Domain Model Extensions
-- Generated: 2026-11-19
-- Baseline: Phase 2 Exit Audit PASS (commit b87ac48)

-- ============================================================================
-- 1. NEW ENUMS
-- ============================================================================

-- Add CLOSED to DealStage enum (CLOSED_WON and CLOSED_LOST remain for backward compatibility)
ALTER TYPE "DealStage" ADD VALUE IF NOT EXISTS 'CLOSED';

DO $$ BEGIN
    CREATE TYPE "DealCloseOutcome" AS ENUM ('WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "CustomerLifecycle" AS ENUM ('LEAD', 'ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "CustomerType" AS ENUM ('CORPORATE', 'INDIVIDUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "CRMActivityType" AS ENUM (
        'CALL',
        'MEETING',
        'NOTE',
        'EMAIL_LOGGED',
        'STAGE_CHANGE',
        'TASK_CREATED',
        'TASK_COMPLETED',
        'CONTACT_ADDED',
        'DEAL_CREATED',
        'DEAL_WON',
        'DEAL_LOST',
        'DEAL_REOPENED',
        'QUOTATION_GENERATED'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. EXTEND CUSTOMER MODEL
-- ============================================================================

ALTER TABLE "Customer" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "lifecycle" "CustomerLifecycle" NOT NULL DEFAULT 'LEAD';
ALTER TABLE "Customer" ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'CORPORATE';
ALTER TABLE "Customer" ADD COLUMN "leadSource" TEXT;

CREATE INDEX "Customer_branchId_idx" ON "Customer"("branchId");
CREATE INDEX "Customer_lifecycle_idx" ON "Customer"("lifecycle");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_branchId_fkey" 
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 3. EXTEND CUSTOMER CONTACT MODEL
-- ============================================================================

ALTER TABLE "CustomerContact" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerContact" ADD COLUMN "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "CustomerContact" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX "CustomerContact_customerId_isPrimary_idx" ON "CustomerContact"("customerId", "isPrimary");

-- ============================================================================
-- 4. EXTEND DEAL MODEL
-- ============================================================================

ALTER TABLE "Deal" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Deal" ADD COLUMN "closeOutcome" "DealCloseOutcome";
ALTER TABLE "Deal" ADD COLUMN "lostNotes" TEXT;
ALTER TABLE "Deal" ADD COLUMN "source" TEXT;
ALTER TABLE "Deal" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Deal" ADD COLUMN "reopenedAt" TIMESTAMPTZ;
ALTER TABLE "Deal" ADD COLUMN "reopenedById" TEXT;
ALTER TABLE "Deal" ADD COLUMN "reopenReason" TEXT;

CREATE INDEX "Deal_organizationId_idx" ON "Deal"("organizationId");
CREATE INDEX "Deal_closeOutcome_idx" ON "Deal"("closeOutcome");
CREATE INDEX "Deal_reopenedById_idx" ON "Deal"("reopenedById");

-- Backfill organizationId from customer
UPDATE "Deal" d
SET "organizationId" = c."organizationId"
FROM "Customer" c
WHERE d."customerId" = c.id AND d."organizationId" IS NULL;

ALTER TABLE "Deal" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_reopenedById_fkey" 
    FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 5. EXTEND TASK MODEL
-- ============================================================================

ALTER TABLE "Task" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMPTZ;
ALTER TABLE "Task" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Task" ADD COLUMN "salesOrderId" TEXT;
ALTER TABLE "Task" ADD COLUMN "reminderAt" TIMESTAMPTZ;
ALTER TABLE "Task" ADD COLUMN "snoozedUntil" TIMESTAMPTZ;
ALTER TABLE "Task" ADD COLUMN "reminderSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_salesOrderId_idx" ON "Task"("salesOrderId");
CREATE INDEX "Task_reminderAt_idx" ON "Task"("reminderAt");

-- Backfill organizationId from customer or deal
UPDATE "Task" t
SET "organizationId" = COALESCE(
    (SELECT c."organizationId" FROM "Customer" c WHERE c.id = t."customerId"),
    (SELECT d."organizationId" FROM "Deal" d WHERE d.id = t."dealId")
)
WHERE t."organizationId" IS NULL AND (t."customerId" IS NOT NULL OR t."dealId" IS NOT NULL);

ALTER TABLE "Task" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Task" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 6. DEAL STAGE HISTORY MODEL
-- ============================================================================

CREATE TABLE "DealStageHistory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStage" "DealStage",
    "toStage" "DealStage" NOT NULL,
    "closeOutcome" "DealCloseOutcome",
    "winProbability" INTEGER NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "DealStageHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealStageHistory_organizationId_idx" ON "DealStageHistory"("organizationId");
CREATE INDEX "DealStageHistory_dealId_idx" ON "DealStageHistory"("dealId");
CREATE INDEX "DealStageHistory_createdAt_idx" ON "DealStageHistory"("createdAt");

ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_dealId_fkey" 
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DealStageHistory" ADD CONSTRAINT "DealStageHistory_changedById_fkey" 
    FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 7. CRM ACTIVITY MODEL
-- ============================================================================

CREATE TABLE "CRMActivity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dealId" TEXT,
    "contactId" TEXT,
    "taskId" TEXT,
    "type" "CRMActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadataJson" TEXT,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CRMActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CRMActivity_organizationId_idx" ON "CRMActivity"("organizationId");
CREATE INDEX "CRMActivity_customerId_idx" ON "CRMActivity"("customerId");
CREATE INDEX "CRMActivity_dealId_idx" ON "CRMActivity"("dealId");
CREATE INDEX "CRMActivity_contactId_idx" ON "CRMActivity"("contactId");
CREATE INDEX "CRMActivity_taskId_idx" ON "CRMActivity"("taskId");
CREATE INDEX "CRMActivity_type_idx" ON "CRMActivity"("type");
CREATE INDEX "CRMActivity_occurredAt_idx" ON "CRMActivity"("occurredAt");
CREATE INDEX "CRMActivity_actorId_idx" ON "CRMActivity"("actorId");

ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_customerId_fkey" 
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_dealId_fkey" 
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_contactId_fkey" 
    FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_taskId_fkey" 
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CRMActivity" ADD CONSTRAINT "CRMActivity_actorId_fkey" 
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 8. SALES REP QUOTA MODEL
-- ============================================================================

CREATE TABLE "SalesRepQuota" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ NOT NULL,
    "periodEnd" TIMESTAMPTZ NOT NULL,
    "periodType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DECIMAL(14,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "SalesRepQuota_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesRepQuota_organizationId_userId_periodStart_periodEnd_metric_key" 
    ON "SalesRepQuota"("organizationId", "userId", "periodStart", "periodEnd", "metric");
CREATE INDEX "SalesRepQuota_organizationId_idx" ON "SalesRepQuota"("organizationId");
CREATE INDEX "SalesRepQuota_userId_idx" ON "SalesRepQuota"("userId");
CREATE INDEX "SalesRepQuota_periodStart_periodEnd_idx" ON "SalesRepQuota"("periodStart", "periodEnd");

ALTER TABLE "SalesRepQuota" ADD CONSTRAINT "SalesRepQuota_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesRepQuota" ADD CONSTRAINT "SalesRepQuota_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 9. COMMISSION RULE MODEL
-- ============================================================================

CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effectiveFrom" TIMESTAMPTZ NOT NULL,
    "effectiveTo" TIMESTAMPTZ,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "basis" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "rateValue" DECIMAL(5,2) NOT NULL,
    "tierJson" TEXT,
    "eligibleDealStages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "excludedDealSources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionRule_organizationId_idx" ON "CommissionRule"("organizationId");
CREATE INDEX "CommissionRule_effectiveFrom_effectiveTo_idx" ON "CommissionRule"("effectiveFrom", "effectiveTo");
CREATE INDEX "CommissionRule_isActive_idx" ON "CommissionRule"("isActive");

ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 10. COMMISSION RECORD MODEL
-- ============================================================================

CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "basisAmount" DECIMAL(14,2) NOT NULL,
    "rateApplied" DECIMAL(5,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMPTZ,
    "approvedById" TEXT,
    "paidAt" TIMESTAMPTZ,
    "calculationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionRecord_calculationKey_key" ON "CommissionRecord"("calculationKey");
CREATE INDEX "CommissionRecord_organizationId_idx" ON "CommissionRecord"("organizationId");
CREATE INDEX "CommissionRecord_ruleId_idx" ON "CommissionRecord"("ruleId");
CREATE INDEX "CommissionRecord_dealId_idx" ON "CommissionRecord"("dealId");
CREATE INDEX "CommissionRecord_userId_idx" ON "CommissionRecord"("userId");
CREATE INDEX "CommissionRecord_status_idx" ON "CommissionRecord"("status");
CREATE INDEX "CommissionRecord_createdAt_idx" ON "CommissionRecord"("createdAt");

ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_ruleId_fkey" 
    FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_dealId_fkey" 
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_approvedById_fkey" 
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 11. CUSTOM FIELD DEFINITION MODEL
-- ============================================================================

CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "optionsJson" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_organizationId_entityType_fieldKey_key" 
    ON "CustomFieldDefinition"("organizationId", "entityType", "fieldKey");
CREATE INDEX "CustomFieldDefinition_organizationId_idx" ON "CustomFieldDefinition"("organizationId");
CREATE INDEX "CustomFieldDefinition_entityType_idx" ON "CustomFieldDefinition"("entityType");

ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 12. CUSTOM FIELD VALUE MODEL
-- ============================================================================

CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldValue_definitionId_entityId_key" 
    ON "CustomFieldValue"("definitionId", "entityId");
CREATE INDEX "CustomFieldValue_organizationId_idx" ON "CustomFieldValue"("organizationId");
CREATE INDEX "CustomFieldValue_entityId_idx" ON "CustomFieldValue"("entityId");

ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_definitionId_fkey" 
    FOREIGN KEY ("definitionId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 13. SAVED VIEW MODEL
-- ============================================================================

CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "sortJson" TEXT NOT NULL,
    "columnsJson" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedView_organizationId_idx" ON "SavedView"("organizationId");
CREATE INDEX "SavedView_userId_idx" ON "SavedView"("userId");
CREATE INDEX "SavedView_entityType_idx" ON "SavedView"("entityType");

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 14. BRANCH RELATION FOR CUSTOMER
-- ============================================================================

-- Already added branchId to Customer and FK above

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================