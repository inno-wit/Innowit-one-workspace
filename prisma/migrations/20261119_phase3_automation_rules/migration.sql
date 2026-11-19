-- Phase 3 CRM: Add AutomationRule and AutomationExecutionLog models
-- Additive migration for Gate P3.8 workflow automation rules

CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "conditionsJson" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionConfigJson" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL DEFAULT 'ALL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationRule_organizationId_idx" ON "AutomationRule"("organizationId");
CREATE INDEX "AutomationRule_trigger_idx" ON "AutomationRule"("trigger");
CREATE INDEX "AutomationRule_isActive_idx" ON "AutomationRule"("isActive");

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AutomationExecutionLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "ruleId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "matchedEntityCount" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "executedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "AutomationExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationExecutionLog_ruleId_idx" ON "AutomationExecutionLog"("ruleId");
CREATE INDEX "AutomationExecutionLog_executedAt_idx" ON "AutomationExecutionLog"("executedAt");

ALTER TABLE "AutomationExecutionLog" ADD CONSTRAINT "AutomationExecutionLog_ruleId_fkey" 
    FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
