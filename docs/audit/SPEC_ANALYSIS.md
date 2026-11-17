# Innowit One — Specification Analysis (7 source documents)

Source documents read in full on 2026-11-17 by the requirements analyst agent (nemotron-ultra).
Location: `public/assets/aistudio/` (see master prompt §0.2 for file list).

## 1. Purpose per document

| Document | Purpose |
|---|---|
| README.md | Living project entry point: enterprise kernel for Innowit Technologies Limited (KRA PIN P051234567Z, KES base currency), multi-branch (HQ Nairobi 00, Mombasa 01, Kisumu 02), 7 core modules, 12 seeded RBAC demo accounts, double-entry ledger invariants, eTIMS air-gap security, 5 acceptance gates. |
| 01-PRODUCT-REQUIREMENTS | Product vision: accounting-first transaction engine — every commercial action updates GL, syncs stock, triggers statutory compliance. 6 modules; 5 goals; 3 non-goals (no WebRTC media, no disconnected CRUD, no cross-module direct DB writes); dark-terminal Swiss UX; 6 quantified success metrics. |
| 02-TECHNICAL-REQUIREMENTS | Prescribes **Next.js 15 (App Router) / React 19 / TS / Tailwind v4 / PostgreSQL 16 / Prisma / Docker**, modular monolith with 10 module directories, TanStack Query + Zustand, transactional outbox for eTIMS, idempotency keys, SERIALIZABLE isolation for financial/inventory ops, 12-role RBAC server guards, Argon2id/bcrypt auth, M-Pesa Daraja 2.0, eTIMS OSCU/VSCU adapter, dual sandbox/production separation. |
| 03-APP-FLOW | Screen inventory + click-by-click journeys: global shell (sidebar, top bar, Ctrl+K), auth/onboarding, Collaboration, CRM (6-stage Kanban), Accounting (COA tree, journals with live balance, AR invoicing with eTIMS queue trigger), Operations (inventory, 8-step procurement with GRN/3-way match, HR payroll with statutory deductions), eTIMS (taxpayer config, queue monitor, credit notes, 3-way reconciliation). |
| 04-UI-UX | Design system: dark terminal + Swiss grid. Tokens below. |
| 05-BACKEND-SCHEMA | Production-grade Prisma schema: 25+ models, 18 enums (full entity list below). Includes data-flow rules for order-to-cash, eTIMS queue processing, credit-note reversal with stock restoration. |
| ROADMAP | Phase-gated execution guide: 8 phases scaffolding → Collaboration → CRM → Accounting → ERP Ops → eTIMS → BI/Automation/Ctrl+K → Hardening. Strict directives: no placeholders, double-entry enforcement, air-gap separation, phase-gate verification. |

## 2. Required-feature matrix (M = mandatory, N = nice-to-have)

**Collaboration (all M):** public/private channels + membership + pins + file attachments + search; DMs with markdown, reactions, read states, edit/delete + audit; threads with reply counts and alerts; files repository with preview and access control; shared notes linked to CRM/ERP entities; Huddles demo-mode presence.

**CRM (all M):** customer directory (Lead/Active/Inactive, KRA PIN, credit terms, interaction timeline); sales reps (assignment, quota, commission rules, activity logs); 6-stage Kanban with mandatory Won/Lost logging, win probability, expected close date; cross-entity tasks (Low→Urgent, due dates, escalation); CRM analytics from live transactions.

**Accounting (all M):** hierarchical COA; atomic double-entry GL with immutable posted entries and reversing lineage; AR (aging, partial payments, statements, unapplied cash); AP (bills, 3-way match, payment vouchers, supplier aging); cash/bank (multi-currency, transfers, statement import, reconciliation); real-time financial reports from ledger.

**ERP Operations (all M):** products (SKU/barcode/UOM/FIFO-MA costing/reorder), multi-warehouse, immutable stock ledgers, reservations, no negative stock; procurement 8-step lifecycle (Requisition→Approval→RFQ→Selection→PO→GRN→Bill→Payment); sales fulfillment chain; HR/payroll (PAYE/NSSF/SHIF/Housing Levy); projects (Kanban/Gantt, time logging, profitability); fixed assets (depreciation, disposal accounting).

**eTIMS (all M):** dual adapter (OSCU direct REST / VSCU proxy) behind `IEtimsAdapter`; taxpayer/branch/device config; product tax classification to KRA HS codes (16%/0%/Exempt/Withholding); 10-step invoice submission lifecycle; credit notes linked to original KRA control numbers; offline outbox with exponential backoff (30s/2m/10m/30m/2h) + idempotency; air-gap sandbox/production with `is_sandbox` partitioning, encrypted credentials, sandbox banner, Super Admin dual-factor production gate.

**BI/Automation (all M):** executive BI KPIs; event-driven automation engine (trigger-condition-action); universal command center Ctrl+K; immutable audit trail on all writes.

## 3. Prescribed data model (seed for Prisma design)

Auth/Org: `Organization(kraPin unique)`, `Branch(organizationId, branchCode, isHq)`, `User(organizationId, branchId?, email unique, passwordHash, role)`.
Collaboration: `Channel(isPrivate)`, `ChannelMember(@@unique(channelId,userId))`, `Message(channelId?, senderId, recipientId?, parentId?, isPinned)`, `FileAttachment(messageId?, storagePath)`.
CRM: `Customer(organizationId, customerCode unique, kraPin?, creditLimit, paymentTermsDays)`, `CustomerContact`, `Deal(customerId, assignedToId, stage, winProbability, expectedCloseDate, lostReason)`, `Task(assignedToId, customerId?, dealId?)`.
Accounting: `Account(organizationId, accountNumber, type, currentBalance)`, `JournalEntry(entryNumber unique, postingDate, sourceModule, sourceId?, isReversed, reversalEntryId? unique)`, `JournalLine(journalEntryId, accountId, debit, credit)`.
Inventory: `Product(organizationId, sku unique, costPrice, sellingPrice, taxClassification, reorderLevel)`, `Warehouse(branchId, code unique)`, `WarehouseStock(@@unique(productId,warehouseId), quantityOnHand, quantityReserved)`, `StockMovement(productId, warehouseId, movementType, quantity, unitCost)`.
Sales: `Quotation(dealId?)`, `SalesOrder(quotationId? unique, orderStatus)`, `SalesOrderItem(productId, quantity, unitPrice, taxRate)`, `SalesInvoice(branchId, customerId, salesOrderId? unique, status, isSandbox, subtotal, taxAmount, totalAmount, paidAmount)`, `SalesInvoiceItem(productId, taxClassification, taxAmount, lineTotal)`, `CustomerPayment(salesInvoiceId, paymentNumber unique, paymentMethod, referenceCode)`, `CreditNote(salesInvoiceId, reason)`.
eTIMS: `EtimsConfiguration(organizationId, mode, environment, taxpayerPin, deviceSerial?, clientSecretEnc, apiUrl, isCertified, isProductionActive)`, `EtimsInvoice(salesInvoiceId unique, kraControlNumber unique, ackCode)`, `EtimsTransmissionQueue(salesInvoiceId, idempotencyKey unique, status, payloadJson, responseJson?, attemptCount, lastError?, nextRetryAt?)`.
Procurement: `Supplier`, `PurchaseOrder(branchId, supplierId, poNumber unique, isApproved)`.
HR: `Department`, `Employee(userId unique, departmentId, employeeCode unique, kraPin?, nssfNumber?, nhifNumber?, basicSalary)`, `PayrollRun(month, year, @@unique(month,year), isApproved, postedToGl)`, `Payslip(payrollRunId, employeeId, basicSalary, allowances, grossPay, payeTax, nssfDeduction, nhifDeduction, housingLevy, netPay)`.
Audit: `AuditLog(userId?, action, entityType, entityId, changesJson?, ipAddress?)`.

## 4. Architecture discrepancies (for DECISIONS.md)

| # | Discrepancy | Severity |
|---|---|---|
| 1 | TRD mandates Next.js 15 App Router; target is Tauri 2 + Node API + PostgreSQL + Prisma (desktop). Incompatible. | Critical |
| 2 | README says Vite; TRD says Next.js — mutually exclusive build systems. | Critical |
| 3 | TanStack Query + Server Actions don't exist in Tauri; use local HTTP API / typed IPC. | High |
| 4 | Docker Compose stack vs Tauri sidecar/local Postgres. | Medium |
| 5 | HTTP-only cookie sessions vs Tauri token-based auth in secure storage. | Medium |
| 6 | Core Web Vitals targets not applicable to desktop; use startup latency/frame time. | Low |
| 7 | eTIMS credential isolation can be strengthened in Tauri Rust sidecar. | Note |
| 8 | PRD "no cross-module direct DB writes" aligns with modular monolith service interfaces. | Note |
| 9 | ROADMAP scaffold command `npx create-next-app@latest` not applicable. | Critical |
| 10 | Mobile breakpoint not applicable to desktop window; tablet/desktop still relevant. | Low |
| 11 | No mention anywhere of Rust/Tauri/sidecar/native capabilities. | Critical |

Resolution: ADR-001 (see `docs/architecture/DECISIONS.md`) keeps Vite/React renderer + Tauri 2 + Node API + PostgreSQL per master prompt §4, which supersedes the web TRD.

## 5. Design tokens (04-UI-UX)

Brand: teal `#00B3C8` (primary interactive), orange `#E8631A` (high-priority callouts), dark base `#1A1A1A`, sidebar bg `#1E1B2E`, sidebar active `#2D2254`.
Surfaces: canvas `#0F1115`, surface `#161920`, raised `#1F2430`, border subtle `#282E3E`, border strong `#3D465E`.
Text: primary `#F1F5F9`, secondary `#94A3B8`, muted `#64748B`.
Status: success `#10B981` (tint `#064E3B`), danger `#EF4444` (`#7F1D1D`), warning `#F59E0B` (`#78350F`), info `#3B82F6` (`#1E3A8A`), sandbox `#8B5CF6` (`#4C1D95`).
Type: Inter/Geist Sans primary; JetBrains Mono for all numbers (financial figures, PINs, SKUs) with `tabular-nums`; Display 1 28px/700 → Caption 11px/600 uppercase overline; body 14px, table data 13px.
Spacing: 4/8px scale (space-1 4px → space-8 32px). Layout: desktop ≥1440px sidebar 260px fixed; tablet 768-1439px icon-only 64px; drawers 480/640px.
