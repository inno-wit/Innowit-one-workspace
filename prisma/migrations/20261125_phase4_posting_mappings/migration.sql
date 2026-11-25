-- Phase 4 / posting mappings
-- Documents name products and suppliers, not general-ledger accounts. Until now
-- the only way to pick a revenue or expense account was a hardcoded account
-- number, which silently posts to the wrong account when an organization
-- renumbers its chart. These three mappings make the choice explicit and
-- tenant-scoped, with a deterministic backfill so existing organizations keep
-- posting without an admin step.

ALTER TABLE "OrganizationAccountingProfile"
  ADD COLUMN IF NOT EXISTS "defaultRevenueAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultExpenseAccountId" TEXT,
  ADD COLUMN IF NOT EXISTS "defaultCashAccountId"   TEXT;

-- Revenue default: the lowest-numbered active, postable revenue account.
UPDATE "OrganizationAccountingProfile" p
SET "defaultRevenueAccountId" = a."id"
FROM (
  SELECT DISTINCT ON ("organizationId") "id", "organizationId"
  FROM "Account"
  WHERE "type" = 'REVENUE' AND "isActive" = true AND "isPostable" = true
  ORDER BY "organizationId", "accountNumber" ASC
) a
WHERE a."organizationId" = p."organizationId"
  AND p."defaultRevenueAccountId" IS NULL;

-- Expense default: the lowest-numbered active, postable expense account.
UPDATE "OrganizationAccountingProfile" p
SET "defaultExpenseAccountId" = a."id"
FROM (
  SELECT DISTINCT ON ("organizationId") "id", "organizationId"
  FROM "Account"
  WHERE "type" = 'EXPENSE' AND "isActive" = true AND "isPostable" = true
  ORDER BY "organizationId", "accountNumber" ASC
) a
WHERE a."organizationId" = p."organizationId"
  AND p."defaultExpenseAccountId" IS NULL;

-- Cash default: an explicit cash control account, else a cash-looking asset.
UPDATE "OrganizationAccountingProfile" p
SET "defaultCashAccountId" = a."id"
FROM (
  SELECT DISTINCT ON ("organizationId") "id", "organizationId"
  FROM "Account"
  WHERE "type" = 'ASSET'
    AND "isActive" = true
    AND "isPostable" = true
    AND (
      "controlType" = 'CASH'
      OR UPPER(COALESCE("subtype", '')) LIKE '%CASH%'
      OR "accountNumber" IN ('1000', '1010', '1011')
    )
  ORDER BY "organizationId", "accountNumber" ASC
) a
WHERE a."organizationId" = p."organizationId"
  AND p."defaultCashAccountId" IS NULL;
