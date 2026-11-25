-- Phase 4 / Wave 4.1 follow-up
-- Tenant-scoped audit queries without a join, plus data backfill for the
-- accounting columns introduced in 20261125_phase4_accounting_engine.
--
-- Hand-written deliberately: `prisma migrate diff` against this database also
-- reports long-standing schema/migration drift that is unrelated to Phase 4
-- (enum value ordering, index-name truncation, TIMESTAMP precision). Folding
-- that drift into a Phase 4 migration would risk rewriting the DealStage enum
-- and dropping rows that still use CLOSED_WON / CLOSED_LOST.

-- 1. Tenant-scoped audit trail -------------------------------------------------
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_timestamp_idx"
  ON "AuditLog" ("organizationId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_correlationId_idx"
  ON "AuditLog" ("correlationId");

-- 2. Natural balance backfill ---------------------------------------------------
-- Account.normalBalance was added with a DEBIT default so the column could be
-- added to a populated table. Credit-normal account types must be corrected or
-- the balance cache would be written with the wrong sign.
UPDATE "Account" SET "normalBalance" = 'CREDIT'
WHERE "type" IN ('LIABILITY', 'EQUITY', 'REVENUE')
  AND "normalBalance" = 'DEBIT';

-- 3. Control-account intent for well-known seeded numbers -----------------------
-- Conservative: only exact, well-known numbers, and only where the account is
-- still generic. An organization is free to reconfigure these afterwards.
UPDATE "Account"
SET "isControl" = true, "isPostable" = false, "controlType" = 'CUSTOMER_AR'
WHERE "accountNumber" = '1100' AND "type" = 'ASSET' AND "controlType" = 'NONE';

UPDATE "Account"
SET "isControl" = true, "isPostable" = false, "controlType" = 'SUPPLIER_AP'
WHERE "accountNumber" = '2100' AND "type" = 'LIABILITY' AND "controlType" = 'NONE';

-- 4. Control-account mapping backfill ------------------------------------------
-- Populate the accounting profile mapping from the well-known numbers where the
-- organization's chart of accounts still matches the seeded values.
UPDATE "OrganizationAccountingProfile" p
SET "arControlAccountId" = a."id"
FROM "Account" a
WHERE a."organizationId" = p."organizationId"
  AND a."controlType" = 'CUSTOMER_AR'
  AND p."arControlAccountId" IS NULL;

UPDATE "OrganizationAccountingProfile" p
SET "apControlAccountId" = a."id"
FROM "Account" a
WHERE a."organizationId" = p."organizationId"
  AND a."controlType" = 'SUPPLIER_AP'
  AND p."apControlAccountId" IS NULL;
