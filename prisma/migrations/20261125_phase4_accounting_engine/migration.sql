-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REVERSED', 'VOID');

-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountControlType" AS ENUM ('NONE', 'CUSTOMER_AR', 'SUPPLIER_AP', 'BANK', 'CASH', 'MPESA', 'VAT_OUTPUT', 'VAT_INPUT', 'WHT_PAYABLE', 'INVENTORY', 'PAYROLL', 'RETAINED_EARNINGS', 'FX_GAIN_LOSS', 'SUSPENSE');

-- CreateEnum
CREATE TYPE "TaxKind" AS ENUM ('VAT_STANDARD', 'VAT_ZERO', 'VAT_EXEMPT', 'VAT_REVERSE_CHARGE', 'WHT_INCOME', 'WHT_VAT', 'NONE');

-- CreateEnum
CREATE TYPE "TaxApplicability" AS ENUM ('SALES', 'PURCHASE', 'BOTH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierBillStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK', 'CASH', 'MPESA');

-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'FINALIZED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReconciliationMatchType" AS ENUM ('AUTO_EXACT', 'AUTO_PARTIAL', 'MANUAL', 'MULTI_LINE', 'BANK_FEE');

-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('CBK', 'MANUAL', 'CONTRACTUAL', 'PROVIDER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MpesaTransactionType" AS ENUM ('STK_PUSH', 'C2B', 'B2C');

-- CreateEnum
CREATE TYPE "MpesaTransactionStatus" AS ENUM ('REQUESTED', 'ACKNOWLEDGED', 'CONFIRMED', 'FAILED', 'CANCELLED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DomainEventStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "controlType" "AccountControlType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isControl" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPostable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "normalBalance" "AccountNormalBalance" NOT NULL DEFAULT 'DEBIT',
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "subtype" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
ADD COLUMN     "customerPaymentId" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedJournalId" TEXT,
ADD COLUMN     "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE "CustomerPayment" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedJournalId" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN     "unappliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ALTER COLUMN "salesInvoiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
ADD COLUMN     "periodId" TEXT,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "postedBy" TEXT,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "sourceKey" TEXT,
ADD COLUMN     "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN     "transactionRef" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "baseCredit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "baseDebit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "costCentreId" TEXT,
ADD COLUMN     "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
ADD COLUMN     "dimensionTag" TEXT,
ADD COLUMN     "fxRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
ADD COLUMN     "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
ADD COLUMN     "journalPostedAt" TIMESTAMP(3),
ADD COLUMN     "postedJournalId" TEXT,
ADD COLUMN     "taxSnapshotJson" TEXT;

-- CreateTable
CREATE TABLE "OrganizationAccountingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "functionalCurrency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "fiscalYearStartDay" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "isVatRegistered" BOOLEAN NOT NULL DEFAULT true,
    "vatNumber" TEXT,
    "whtAgent" BOOLEAN NOT NULL DEFAULT false,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "journalApprovalThreshold" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "billApprovalThreshold" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "paymentApprovalThreshold" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "arControlAccountId" TEXT,
    "apControlAccountId" TEXT,
    "vatOutputAccountId" TEXT,
    "vatInputAccountId" TEXT,
    "whtPayableAccountId" TEXT,
    "suspenseAccountId" TEXT,
    "fxGainAccountId" TEXT,
    "fxLossAccountId" TEXT,
    "retainedEarningsAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationAccountingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCentre" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCentre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromCurrency" "CurrencyCode" NOT NULL,
    "toCurrency" "CurrencyCode" NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'CBK',
    "sourceRef" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxCode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TaxKind" NOT NULL,
    "applicability" "TaxApplicability" NOT NULL DEFAULT 'BOTH',
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "isRecoverable" BOOLEAN NOT NULL DEFAULT true,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "whtRecipientType" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "glOutputAccountId" TEXT,
    "glInputAccountId" TEXT,
    "glLiabilityAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "legalRef" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxCodeId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "taxKind" "TaxKind" NOT NULL,
    "taxableBase" DECIMAL(14,2) NOT NULL,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "ruleSnapshotJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "internalNumber" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "whtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "status" "SupplierBillStatus" NOT NULL DEFAULT 'DRAFT',
    "purchaseOrderId" TEXT,
    "goodsReceiptRef" TEXT,
    "duplicateHash" TEXT,
    "postedJournalId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBillLine" (
    "id" TEXT NOT NULL,
    "supplierBillId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1.00,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxCodeId" TEXT,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "whtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "expenseAccountId" TEXT NOT NULL,
    "costCentreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1.00000000,
    "paymentMethod" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "whtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "unappliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "status" "PaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "bankAccountId" TEXT,
    "postedJournalId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "supplierBillId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "type" "BankAccountType" NOT NULL DEFAULT 'BANK',
    "accountNumber" TEXT,
    "glAccountId" TEXT NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "provider" TEXT,
    "mpesaShortcode" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "openingDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "statementFrom" TIMESTAMP(3) NOT NULL,
    "statementTo" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(14,2) NOT NULL,
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "importedBy" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "balanceAfter" DECIMAL(14,2),
    "fingerprint" TEXT NOT NULL,
    "status" "StatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedTargetType" TEXT,
    "matchedTargetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementClosingBalance" DECIMAL(14,2) NOT NULL,
    "glClosingBalance" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedBy" TEXT,
    "finalizedBy" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matchType" "ReconciliationMatchType" NOT NULL DEFAULT 'MANUAL',
    "reason" TEXT,
    "matchedBy" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpesaTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "transactionType" "MpesaTransactionType" NOT NULL,
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "mpesaReceiptNumber" TEXT,
    "phoneNumber" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'KES',
    "status" "MpesaTransactionStatus" NOT NULL DEFAULT 'REQUESTED',
    "resultCode" TEXT,
    "resultDesc" TEXT,
    "accountReference" TEXT,
    "rawPayloadJson" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "customerPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "costCentreId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "costCentreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEventLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "DomainEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationAccountingProfile_organizationId_key" ON "OrganizationAccountingProfile"("organizationId");

-- CreateIndex
CREATE INDEX "FiscalYear_organizationId_status_idx" ON "FiscalYear"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_organizationId_name_key" ON "FiscalYear"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_organizationId_startDate_key" ON "FiscalYear"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "AccountingPeriod_organizationId_status_idx" ON "AccountingPeriod"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AccountingPeriod_organizationId_startDate_endDate_idx" ON "AccountingPeriod"("organizationId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_organizationId_fiscalYearId_periodNumber_key" ON "AccountingPeriod"("organizationId", "fiscalYearId", "periodNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_organizationId_startDate_key" ON "AccountingPeriod"("organizationId", "startDate");

-- CreateIndex
CREATE INDEX "CostCentre_organizationId_isActive_idx" ON "CostCentre"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "CostCentre_parentId_idx" ON "CostCentre"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCentre_organizationId_code_key" ON "CostCentre"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ExchangeRate_organizationId_fromCurrency_toCurrency_rateDat_idx" ON "ExchangeRate"("organizationId", "fromCurrency", "toCurrency", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_organizationId_fromCurrency_toCurrency_rateDat_key" ON "ExchangeRate"("organizationId", "fromCurrency", "toCurrency", "rateDate", "source");

-- CreateIndex
CREATE INDEX "TaxCode_organizationId_kind_effectiveFrom_idx" ON "TaxCode"("organizationId", "kind", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxCode_organizationId_isActive_idx" ON "TaxCode"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxCode_organizationId_code_effectiveFrom_key" ON "TaxCode"("organizationId", "code", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TaxTransaction_organizationId_sourceType_sourceId_idx" ON "TaxTransaction"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TaxTransaction_organizationId_taxKind_createdAt_idx" ON "TaxTransaction"("organizationId", "taxKind", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_organizationId_salesInvoiceId_idx" ON "PaymentAllocation"("organizationId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_salesInvoiceId_key" ON "PaymentAllocation"("paymentId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierBill_organizationId_status_dueDate_idx" ON "SupplierBill"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "SupplierBill_supplierId_idx" ON "SupplierBill"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierBill_branchId_idx" ON "SupplierBill"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_internalNumber_key" ON "SupplierBill"("organizationId", "internalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_organizationId_supplierId_billNumber_key" ON "SupplierBill"("organizationId", "supplierId", "billNumber");

-- CreateIndex
CREATE INDEX "SupplierBillLine_supplierBillId_idx" ON "SupplierBillLine"("supplierBillId");

-- CreateIndex
CREATE INDEX "SupplierBillLine_expenseAccountId_idx" ON "SupplierBillLine"("expenseAccountId");

-- CreateIndex
CREATE INDEX "SupplierBillLine_costCentreId_idx" ON "SupplierBillLine"("costCentreId");

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_supplierId_paymentDate_idx" ON "SupplierPayment"("organizationId", "supplierId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_organizationId_paymentNumber_key" ON "SupplierPayment"("organizationId", "paymentNumber");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_organizationId_supplierBillId_idx" ON "SupplierPaymentAllocation"("organizationId", "supplierBillId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_supplierPaymentId_supplierBillId_key" ON "SupplierPaymentAllocation"("supplierPaymentId", "supplierBillId");

-- CreateIndex
CREATE INDEX "BankAccount_organizationId_isActive_idx" ON "BankAccount"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "BankAccount_glAccountId_idx" ON "BankAccount"("glAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_organizationId_name_key" ON "BankAccount"("organizationId", "name");

-- CreateIndex
CREATE INDEX "BankStatement_organizationId_bankAccountId_statementTo_idx" ON "BankStatement"("organizationId", "bankAccountId", "statementTo");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatement_organizationId_bankAccountId_fileHash_key" ON "BankStatement"("organizationId", "bankAccountId", "fileHash");

-- CreateIndex
CREATE INDEX "BankStatementLine_statementId_status_idx" ON "BankStatementLine"("statementId", "status");

-- CreateIndex
CREATE INDEX "BankStatementLine_valueDate_idx" ON "BankStatementLine"("valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_statementId_fingerprint_key" ON "BankStatementLine"("statementId", "fingerprint");

-- CreateIndex
CREATE INDEX "BankReconciliation_organizationId_bankAccountId_status_idx" ON "BankReconciliation"("organizationId", "bankAccountId", "status");

-- CreateIndex
CREATE INDEX "BankReconciliation_organizationId_periodEnd_idx" ON "BankReconciliation"("organizationId", "periodEnd");

-- CreateIndex
CREATE INDEX "BankMatch_organizationId_reconciliationId_idx" ON "BankMatch"("organizationId", "reconciliationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankMatch_statementLineId_targetType_targetId_key" ON "BankMatch"("statementLineId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_idempotencyKey_key" ON "MpesaTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MpesaTransaction_organizationId_status_idx" ON "MpesaTransaction"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MpesaTransaction_organizationId_mpesaReceiptNumber_idx" ON "MpesaTransaction"("organizationId", "mpesaReceiptNumber");

-- CreateIndex
CREATE INDEX "MpesaTransaction_checkoutRequestId_idx" ON "MpesaTransaction"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "Budget_organizationId_status_idx" ON "Budget"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_organizationId_fiscalYearId_name_version_key" ON "Budget"("organizationId", "fiscalYearId", "name", "version");

-- CreateIndex
CREATE INDEX "BudgetLine_organizationId_accountId_idx" ON "BudgetLine"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetId_accountId_periodNumber_costCentreId_key" ON "BudgetLine"("budgetId", "accountId", "periodNumber", "costCentreId");

-- CreateIndex
CREATE INDEX "DomainEventLog_organizationId_status_idx" ON "DomainEventLog"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DomainEventLog_aggregateType_aggregateId_idx" ON "DomainEventLog"("aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_organizationId_prefix_scope_year_key" ON "DocumentSequence"("organizationId", "prefix", "scope", "year");

-- CreateIndex
CREATE INDEX "Account_parentId_idx" ON "Account"("parentId");

-- CreateIndex
CREATE INDEX "Account_organizationId_controlType_idx" ON "Account"("organizationId", "controlType");

-- CreateIndex
CREATE INDEX "CustomerPayment_organizationId_customerId_paymentDate_idx" ON "CustomerPayment"("organizationId", "customerId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_organizationId_providerRef_key" ON "CustomerPayment"("organizationId", "providerRef");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_postingDate_idx" ON "JournalEntry"("organizationId", "postingDate");

-- CreateIndex
CREATE INDEX "JournalEntry_periodId_idx" ON "JournalEntry"("periodId");

-- CreateIndex
CREATE INDEX "JournalEntry_status_idx" ON "JournalEntry"("status");

-- CreateIndex
CREATE INDEX "JournalEntry_branchId_idx" ON "JournalEntry"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_sourceKey_key" ON "JournalEntry"("organizationId", "sourceKey");

-- CreateIndex
CREATE INDEX "JournalLine_costCentreId_idx" ON "JournalLine"("costCentreId");

-- CreateIndex
CREATE INDEX "SalesInvoice_postedJournalId_idx" ON "SalesInvoice"("postedJournalId");

-- CreateIndex
CREATE INDEX "SalesInvoice_organizationId_customerId_status_idx" ON "SalesInvoice"("organizationId", "customerId", "status");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationAccountingProfile" ADD CONSTRAINT "OrganizationAccountingProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxTransaction" ADD CONSTRAINT "TaxTransaction_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_statementLineId_fkey" FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEventLog" ADD CONSTRAINT "DomainEventLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

