# PHASE 3 DOMAIN MODEL: INNOWIT ONE CRM & SALES PIPELINE

**Document Version:** 1.0.0  
**Date:** 2026-11-19  
**Status:** As-Built  

---

## 1. Entity Relationship Diagram

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────┐
│ Customer    │◄──────│ CustomerContact  │       │ Deal        │
├─────────────┤       ├──────────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)          │       │ id (PK)     │
│ orgId (FK)  │       │ customerId (FK)  │       │ orgId (FK)  │
│ customerCode│       │ firstName        │       │ customerId  │
│ name        │       │ lastName         │       │ assignedTo  │
│ kraPin      │       │ email            │       │ title       │
│ lifecycle   │       │ phone            │       │ value       │
│ type        │       │ jobTitle         │       │ stage       │
│ branchId    │       │ isPrimary        │       │ closeOutcome│
│ creditLimit │       └──────────────────┘       │ winProb     │
│ paymentTerms│                                    │ expectedClose│
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │ 1:N                                             │ 1:N
       ▼                                                  ▼
┌─────────────┐       ┌──────────────────┐       ┌─────────────┐
│ Task        │       │ CRMActivity      │       │ DealStageHist│
├─────────────┤       ├──────────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)          │       │ id (PK)     │
│ orgId (FK)  │       │ orgId (FK)       │       │ orgId (FK)  │
│ customerId  │       │ customerId (FK)  │       │ dealId (FK) │
│ dealId (FK) │       │ dealId (FK)      │       │ fromStage   │
│ projectId   │       │ contactId (FK)   │       │ toStage     │
│ salesOrderId│       │ taskId (FK)      │       │ closeOutcome│
│ priority    │       │ type             │       │ winProb     │
│ status      │       │ title            │       │ changedBy   │
│ dueDate     │       │ actorId (FK)     │       │ reason      │
└─────────────┘       └──────────────────┘       └─────────────┘

┌──────────────────┐       ┌──────────────────┐
│ SalesRepQuota    │       │ CommissionRule   │
├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │
│ orgId (FK)       │       │ orgId (FK)       │
│ userId (FK)      │       │ name             │
│ periodStart      │       │ basis            │
│ periodEnd        │       │ rateType         │
│ periodType       │       │ rateValue        │
│ metric           │       │ tierJson         │
│ targetValue      │       │ eligibleStages   │
└──────────────────┘       │ excludedSources  │
                           └────────┬─────────┘
                                    │ 1:N
                                    ▼
                           ┌──────────────────┐
                           │ CommissionRecord │
                           ├──────────────────┤
                           │ id (PK)          │
                           │ orgId (FK)       │
                           │ ruleId (FK)      │
                           │ dealId (FK)      │
                           │ userId (FK)      │
                           │ amount           │
                           │ basisAmount      │
                           │ rateApplied      │
                           │ calculationKey   │
                           │ status           │
                           └──────────────────┘

┌──────────────────┐       ┌──────────────────┐
│ CustomFieldDef   │       │ CustomFieldValue │
├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │
│ orgId (FK)       │       │ orgId (FK)       │
│ entityType       │       │ definitionId(FK) │
│ fieldKey         │       │ entityId         │
│ label            │       │ valueJson        │
│ fieldType        │       └──────────────────┘
│ optionsJson      │
│ isRequired       │
└──────────────────┘

┌──────────────────┐       ┌──────────────────┐
│ SavedView        │       │ AutomationRule   │
├──────────────────┤       ├──────────────────┤
│ id (PK)          │       │ id (PK)          │
│ orgId (FK)       │       │ orgId (FK)       │
│ userId (FK)      │       │ trigger          │
│ entityType       │       │ conditionsJson   │
│ name             │       │ actionType       │
│ filtersJson      │       │ actionConfigJson │
│ sortJson         │       │ isActive         │
│ isShared         │       └────────┬─────────┘
└──────────────────┘                │ 1:N
                                    ▼
                           ┌──────────────────┐
                           │ AutoExecLog      │
                           ├──────────────────┤
                           │ id (PK)          │
                           │ ruleId (FK)      │
                           │ executedAt       │
                           │ status           │
                           │ matchedCount     │
                           └──────────────────┘
```

---

## 2. Core Entity Definitions

### 2.1 Customer
```typescript
model Customer {
  id                String            @id @default(uuid())
  organizationId    String            // Tenant scoping
  branchId          String?           // Optional branch scoping
  customerCode      String            // Unique per organization
  name              String            // Trade name
  companyName       String?           // Legal entity name
  kraPin            String?           // KRA PIN (validated: ^[A-Z]\d{9}[A-Z]$)
  email             String?
  phone             String?
  billingAddress    String?
  creditLimit       Decimal           @default(0.00) @db.Decimal(14,2)
  paymentTermsDays  Int               @default(30)
  lifecycle         CustomerLifecycle @default(LEAD)  // LEAD | ACTIVE | INACTIVE
  type              CustomerType      @default(CORPORATE) // CORPORATE | INDIVIDUAL
  leadSource        String?           // Lead origin
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  // Relations
  organization      Organization      @relation(fields: [organizationId], references: [id])
  branch            Branch?           @relation(fields: [branchId], references: [id])
  deals             Deal[]
  contacts          CustomerContact[]
  tasks             Task[]
  activities        CRMActivity[]
  invoices          SalesInvoice[]
  salesOrders       SalesOrder[]

  // Indexes
  @@unique([organizationId, customerCode])
  @@index([organizationId, branchId, lifecycle, type])
}
```

**Lifecycle State Machine:**
```
LEAD → ACTIVE → INACTIVE
  ↑___________|
```
- LEAD: New prospect, no deals won
- ACTIVE: Has won deals or active pipeline
- INACTIVE: Archived (soft delete), retains history

### 2.2 CustomerContact
```typescript
model CustomerContact {
  id          String    @id @default(uuid())
  customerId  String
  firstName   String
  lastName    String
  email       String?
  phone       String?
  jobTitle    String?
  isPrimary   Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  customer    Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  activities  CRMActivity[]

  // Primary contact uniqueness per customer (partial unique index)
  @@index([customerId, isPrimary])
}
```

**Primary Contact Rule:** At most one `isPrimary=true` per customer. Enforced by application logic + partial unique index.

### 2.3 Deal
```typescript
model Deal {
  id                  String              @id @default(uuid())
  organizationId      String              // Denormalized for tenant scoping
  customerId          String
  assignedToId        String
  title               String
  value               Decimal             @db.Decimal(14,2)
  currency            CurrencyCode        @default(KES)
  stage               DealStage           @default(NEW_LEAD)
  closeOutcome        DealCloseOutcome?   // Set when stage = CLOSED
  winProbability      Int                 @default(20)  // 0-100
  expectedCloseDate   DateTime?
  lostReason          String?
  lostNotes           String?
  source              String?
  version             Int                 @default(1)   // Optimistic locking
  reopenedAt          DateTime?
  reopenedById        String?
  reopenReason        String?
  wonQuotationNumber  String?             // Set when quotation generated
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  // Relations
  organization        Organization        @relation(fields: [organizationId], references: [id])
  customer            Customer            @relation(fields: [customerId], references: [id])
  assignedTo          User                @relation(fields: [assignedToId], references: [id])
  reopenedBy          User?               @relation("DealReopenedBy", fields: [reopenedById], references: [id])
  tasks               Task[]
  quotations          Quotation[]
  stageHistory        DealStageHistory[]
  activities          CRMActivity[]

  // Indexes
  @@index([organizationId, stage, closeOutcome])
  @@index([customerId, assignedToId])
  @@index([expectedCloseDate])
}
```

**Stage Enum (6 stages):**
```typescript
enum DealStage {
  NEW_LEAD
  CONTACTED
  QUALIFIED
  PROPOSAL
  NEGOTIATION
  CLOSED        // Terminal stage; closeOutcome determines WON/LOST
}
```

**Close Outcome Enum:**
```typescript
enum DealCloseOutcome {
  WON
  LOST
}
```

**Stage Transition Rules:**
| From Stage | To Stage | Probability | Notes |
|---|---|---|---|
| NEW_LEAD | CONTACTED | 40 | |
| CONTACTED | QUALIFIED | 60 | |
| QUALIFIED | PROPOSAL | 75 | |
| PROPOSAL | NEGOTIATION | 90 | |
| NEGOTIATION | CLOSED | 100/0 | Requires closeOutcome |
| CLOSED | * | N/A | Reopen only (SALES_MANAGER+) |

**Optimistic Locking:** `version` field incremented on every update. Client must provide current version.

### 2.4 DealStageHistory
```typescript
model DealStageHistory {
  id            String           @id @default(uuid())
  organizationId  String
  dealId        String
  fromStage     DealStage?       // Null for initial creation
  toStage       DealStage
  closeOutcome  DealCloseOutcome?
  winProbability Int
  changedById   String
  reason        String?
  createdAt     DateTime         @default(now())

  deal          Deal             @relation(fields: [dealId], references: [id], onDelete: Cascade)
  changedBy     User             @relation(fields: [changedById], references: [id])

  @@index([organizationId, dealId, createdAt])
}
```

### 2.5 CRMActivity
```typescript
model CRMActivity {
  id            String            @id @default(uuid())
  organizationId  String
  customerId    String
  dealId        String?
  contactId     String?
  taskId        String?
  type          CRMActivityType
  title         String
  description   String?
  metadataJson  String?           @db.Text
  actorId       String
  occurredAt    DateTime          @default(now())
  createdAt     DateTime          @default(now())

  // Relations
  organization  Organization      @relation(fields: [organizationId], references: [id])
  customer      Customer          @relation(fields: [customerId], references: [id], onDelete: Cascade)
  deal          Deal?             @relation(fields: [dealId], references: [id])
  contact       CustomerContact?  @relation(fields: [contactId], references: [id])
  task          Task?             @relation(fields: [taskId], references: [id])
  actor         User              @relation("CRMActivityActor", fields: [actorId], references: [id])

  @@index([organizationId, customerId, occurredAt])
  @@index([dealId, occurredAt])
  @@index([type, occurredAt])
}
```

**Activity Types:**
```typescript
enum CRMActivityType {
  CALL
  MEETING
  NOTE
  EMAIL_LOGGED
  STAGE_CHANGE
  TASK_CREATED
  TASK_COMPLETED
  CONTACT_ADDED
  DEAL_CREATED
  DEAL_WON
  DEAL_LOST
  DEAL_REOPENED
  QUOTATION_GENERATED
}
```

### 2.6 Task (Extended)
```typescript
model Task {
  id              String         @id @default(uuid())
  organizationId  String         // Denormalized for tenant scoping
  title           String
  description     String?
  priority        TaskPriority   @default(MEDIUM)  // LOW | MEDIUM | HIGH | URGENT
  status          TaskStatus     @default(PENDING)  // PENDING | IN_PROGRESS | COMPLETED | CANCELLED
  dueDate         DateTime?
  completedAt     DateTime?
  assignedToId    String
  customerId      String?
  dealId          String?
  projectId       String?        // NEW: Cross-entity link
  salesOrderId    String?        // NEW: Cross-entity link
  reminderAt      DateTime?      // NEW: Reminder scheduling
  snoozedUntil    DateTime?      // NEW: Snooze support
  reminderSent    Boolean        @default(false)   // NEW: Idempotent reminders
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  // Relations
  organization    Organization   @relation(fields: [organizationId], references: [id])
  assignedTo      User           @relation(fields: [assignedToId], references: [id])
  customer        Customer?      @relation(fields: [customerId], references: [id])
  deal            Deal?          @relation(fields: [dealId], references: [id])
  activities      CRMActivity[]

  @@index([organizationId, assignedToId, status, dueDate])
  @@index([customerId, dealId, projectId, salesOrderId])
  @@index([reminderAt])
}
```

### 2.7 SalesRepQuota
```typescript
model SalesRepQuota {
  id              String         @id @default(uuid())
  organizationId  String
  userId          String         // Sales rep
  periodStart     DateTime
  periodEnd       DateTime
  periodType      String         // MONTHLY | QUARTERLY | ANNUAL
  metric          String         // REVENUE | DEALS_WON | WEIGHTED_PIPELINE
  targetValue     Decimal        @db.Decimal(14,2)
  currency        CurrencyCode   @default(KES)
  isActive        Boolean        @default(true)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  organization    Organization   @relation(fields: [organizationId], references: [id])
  user            User           @relation(fields: [userId], references: [id])

  // Prevent overlapping quotas for same rep/period/metric
  @@unique([organizationId, userId, periodStart, periodEnd, metric])
  @@index([organizationId, userId, periodStart, periodEnd])
}
```

### 2.8 CommissionRule
```typescript
model CommissionRule {
  id                  String      @id @default(uuid())
  organizationId      String
  name                String
  description         String?
  effectiveFrom       DateTime
  effectiveTo         DateTime?
  isActive            Boolean      @default(true)
  basis               String       // DEAL_VALUE | COLLECTED_AMOUNT
  rateType            String       // FLAT | TIERED
  rateValue           Decimal      @db.Decimal(5,2)  // Percentage or flat
  tierJson            String?      @db.Text          // [{min, max, rate}, ...]
  eligibleDealStages  String[]     // Deal stages that qualify
  excludedDealSources String[]     @default([])      // Sources to exclude
  requiresApproval    Boolean      @default(false)
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id])
  commissionRecords   CommissionRecord[]

  @@index([organizationId, effectiveFrom, effectiveTo, isActive])
}
```

### 2.9 CommissionRecord
```typescript
model CommissionRecord {
  id                  String      @id @default(uuid())
  organizationId      String
  ruleId              String
  dealId              String
  userId              String       // Sales rep earning commission
  amount              Decimal      @db.Decimal(14,2)
  currency            CurrencyCode @default(KES)
  basisAmount         Decimal      @db.Decimal(14,2)  // Deal value used
  rateApplied         Decimal      @db.Decimal(5,2)
  status              String       @default("PENDING") // PENDING | APPROVED | PAID | CANCELLED
  approvedAt          DateTime?
  approvedById        String?
  paidAt              DateTime?
  calculationKey      String       // Deterministic: prevents duplicates
  createdAt           DateTime     @default(now())
  updatedAt           DateTime     @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id])
  rule                CommissionRule @relation(fields: [ruleId], references: [id])
  deal                Deal         @relation(fields: [dealId], references: [id])
  user                User         @relation(fields: [userId], references: [id])
  approvedBy          User?        @relation("CommissionApprovedBy", fields: [approvedById], references: [id])

  @@unique([calculationKey])  // Idempotency
  @@index([organizationId, userId, status, createdAt])
  @@index([dealId])
}
```

**Calculation Key Format:** `comm_{dealId}_{ruleId}_{effectiveFromTimestamp}`

### 2.10 CustomFieldDefinition
```typescript
model CustomFieldDefinition {
  id              String      @id @default(uuid())
  organizationId  String
  entityType      String      // CUSTOMER | CONTACT | DEAL
  fieldKey        String      // snake_case, unique per entityType
  label           String
  fieldType       String      // TEXT | NUMBER | DATE | BOOLEAN | SELECT | MULTI_SELECT
  optionsJson     String?     @db.Text  // For SELECT/MULTI_SELECT
  isRequired      Boolean     @default(false)
  isActive        Boolean     @default(true)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])
  values          CustomFieldValue[]

  @@unique([organizationId, entityType, fieldKey])
  @@index([organizationId, entityType])
}
```

### 2.11 CustomFieldValue
```typescript
model CustomFieldValue {
  id                  String      @id @default(uuid())
  organizationId      String
  definitionId        String
  entityId            String      // Customer/Contact/Deal ID
  valueJson           String      @db.Text
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id])
  definition          CustomFieldDefinition @relation(fields: [definitionId], references: [id], onDelete: Cascade)

  @@unique([definitionId, entityId])
  @@index([organizationId, entityId])
}
```

### 2.12 SavedView
```typescript
model SavedView {
  id              String      @id @default(uuid())
  organizationId  String
  userId          String
  entityType      String      // CUSTOMER | DEAL | TASK
  name            String
  filtersJson     String      @db.Text
  sortJson        String      @db.Text
  columnsJson     String?     @db.Text
  isDefault       Boolean     @default(false)
  isShared        Boolean     @default(false)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([organizationId, userId, entityType])
}
```

### 2.13 AutomationRule
```typescript
model AutomationRule {
  id                  String      @id @default(uuid())
  organizationId      String
  name                String
  description         String?
  trigger             String      // DEAL_STAGE_CHANGED | DEAL_WON | DEAL_LOST | TASK_DUE_SOON | TASK_OVERDUE | CUSTOMER_LIFECYCLE_CHANGED | CONTACT_ADDED | CUSTOM_FIELD_CHANGED
  conditionsJson      String      @db.Text  // [{field, operator, value}, ...]
  actionType          String      // CREATE_TASK | CREATE_NOTIFICATION | SEND_EMAIL | UPDATE_FIELD | WEBHOOK
  actionConfigJson    String      @db.Text
  targetRole          String      @default("ALL")
  isActive            Boolean     @default(true)
  lastExecutedAt      DateTime?
  executionCount      Int         @default(0)
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  organization        Organization @relation(fields: [organizationId], references: [id])
  executionLogs       AutomationExecutionLog[]

  @@index([organizationId, trigger, isActive])
}
```

### 2.14 AutomationExecutionLog
```typescript
model AutomationExecutionLog {
  id                  String      @id @default(uuid())
  ruleId              String
  ruleName            String
  trigger             String
  executedAt          DateTime    @default(now())
  executedBy          String      // SYSTEM_TRIGGER or User Name
  status              String      // SUCCESS | WARNING | SKIPPED | FAILED
  matchedEntityCount  Int         @default(0)
  details             String
  actionSummary       String

  @@index([ruleId, executedAt])
  @@index([organizationId, executedAt])  // Via rule relation
}
```

### 2.15 ImportJob
```typescript
model ImportJob {
  id                  String      @id @default(uuid())
  organizationId      String
  entityType          String      // CUSTOMER | CONTACT | DEAL | TASK
  fileUrl             String
  mappingJson         String      @db.Text  // Column-to-field mapping
  optionsJson         String      @db.Text  // {dryRun, skipDuplicates, updateExisting}
  status              String      @default("PENDING") // PENDING | PROCESSING | COMPLETED | FAILED
  totalRows           Int         @default(0)
  processedRows       Int         @default(0)
  validRows           Int         @default(0)
  invalidRows         Int         @default(0)
  duplicateRows       Int         @default(0)
  errorDetailsJson    String?     @db.Text
  idempotencyKey      String?     @unique
  createdById         String
  createdAt           DateTime    @default(now())
  completedAt         DateTime?

  @@index([organizationId, entityType, status, createdAt])
}
```

---

## 3. Tenancy & Uniqueness Decisions

| Entity | Tenant Scope | Unique Constraints |
|---|---|---|
| Customer | `organizationId` | `(organizationId, customerCode)` |
| CustomerContact | via Customer | `(customerId, isPrimary)` partial where `isPrimary=true` |
| Deal | `organizationId` (denormalized) | — |
| Task | `organizationId` (denormalized) | — |
| DealStageHistory | `organizationId` | — |
| CRMActivity | `organizationId` | — |
| SalesRepQuota | `organizationId` | `(organizationId, userId, periodStart, periodEnd, metric)` |
| CommissionRule | `organizationId` | — |
| CommissionRecord | `organizationId` | `calculationKey` (global) |
| CustomFieldDefinition | `organizationId` | `(organizationId, entityType, fieldKey)` |
| CustomFieldValue | `organizationId` | `(definitionId, entityId)` |
| SavedView | `organizationId` | — |
| AutomationRule | `organizationId` | — |
| ImportJob | `organizationId` | `idempotencyKey` |

---

## 4. Lifecycle & State Machines

### 4.1 Customer Lifecycle
```
LEAD ──(first deal created)──► ACTIVE ──(archive)──► INACTIVE
     ▲                                                   │
     └──────────(reactivate)─────────────────────────────┘
```

### 4.2 Deal Stage
```
NEW_LEAD → CONTACTED → QUALIFIED → PROPOSAL → NEGOTIATION → CLOSED
                                                                    │
                                                                    ├── WON (closeOutcome=WON)
                                                                    └── LOST (closeOutcome=LOST, lostReason required)
                                                                    │
CLOSED ──(reopen, SALES_MANAGER+)──► NEGOTIATION (reopenReason)
```

### 4.3 Deal Close Outcome
- **WON**: Probability = 100, commission calculated, quotation optional
- **LOST**: Probability = 0, lostReason required, no commission

### 4.3 Task Status
```
PENDING → IN_PROGRESS → COMPLETED
    │                          ▲
    └──────────(reopen)────────┘
    │
    └── CANCELLED (terminal)
```

### 4.4 Commission Status
```
PENDING ──(manager approve)──► APPROVED ──(payroll)──► PAID
    │
    └── CANCELLED (if deal reversed)
```

---

## 5. Cross-Module Relationships

| From (CRM) | To (Existing) | Relationship |
|---|---|---|
| Customer | SalesInvoice | 1:N (via customerId) |
| Customer | SalesOrder | 1:N (via customerId) |
| Customer | Quotation | 1:N (via customerId) |
| Deal | Quotation | 1:1 (via dealId unique) |
| Deal | Task | 1:N |
| Deal | CRMActivity | 1:N |
| Task | Project | N:1 (via projectId) |
| Task | SalesOrder | N:1 (via salesOrderId) |
| CRMActivity | Customer | N:1 |
| CRMActivity | Deal | N:1 |
| CRMActivity | CustomerContact | N:1 |
| CRMActivity | Task | N:1 |
| CommissionRecord | Deal | N:1 |
| CommissionRecord | CommissionRule | N:1 |
| CustomFieldValue | Customer/Contact/Deal | N:1 (polymorphic via entityId) |

---

## 6. Financial Integrity

- **All monetary values:** Prisma `Decimal` / PostgreSQL `NUMERIC(14,2)`
- **Currency:** ISO 4217 codes (KES, USD, EUR, GBP)
- **No float arithmetic:** All calculations in Decimal
- **Commission:** Not posted to GL in Phase 3 (separate ledger)
- **Quotation generation:** Creates draft only, no stock reservation, no eTIMS submission