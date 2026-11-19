-- Phase 3 CRM: Add closedAt and wonQuotationNumber to Deal model
-- Additive migration for Gate P3.4 closure date tracking and P3.11 quotation-to-order linkage

ALTER TABLE "Deal" ADD COLUMN "closedAt" TIMESTAMPTZ;
ALTER TABLE "Deal" ADD COLUMN "wonQuotationNumber" TEXT;

CREATE INDEX "Deal_closedAt_idx" ON "Deal"("closedAt");

-- Backfill closedAt for already closed deals using DealStageHistory or updatedAt
UPDATE "Deal" d
SET "closedAt" = COALESCE(
    (SELECT h."createdAt" FROM "DealStageHistory" h WHERE h."dealId" = d.id AND h."toStage" = 'CLOSED' ORDER BY h."createdAt" DESC LIMIT 1),
    d."updatedAt"
)
WHERE d."stage" = 'CLOSED' AND d."closedAt" IS NULL;
