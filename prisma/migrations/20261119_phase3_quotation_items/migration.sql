-- Phase 3 CRM: Add QuotationItem model
-- Additive migration for Gate P3.11 quotation line item persistence and conversion

CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "quotationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 16.00,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");
CREATE INDEX "QuotationItem_productId_idx" ON "QuotationItem"("productId");

ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" 
    FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_productId_fkey" 
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
