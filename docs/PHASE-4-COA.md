# Phase 4 — Chart of Accounts Hierarchy & Classification (F4.0 supplement)

## Account Model Extensions
| Field | Type | Purpose |
|-------|------|---------|
| `parentId` | String? | Self-referential FK for hierarchy |
| `subtype` | String? | Granular classification (e.g. `CURRENT_ASSET`, `COST_OF_SALES`, `PAYROLL_EXPENSE`) |
| `normalBalance` | `AccountNormalBalance` | `DEBIT` for Asset/Expense, `CREDIT` for Liability/Equity/Revenue |
| `isPostable` | Boolean | `false` for summary/header accounts that aggregate children |
| `isControl` | Boolean | `true` for AR/AP/Bank/VAT/WHT/FX/Inventory/Payroll control accounts |
| `controlType` | `AccountControlType` | Which subledger owns this account (see below) |
| `isSystem` | Boolean | Seeded control accounts cannot be deleted |

## Control Types (`AccountControlType`)
| Type | Typical Account Number | Subledger | Posting Rule |
|------|----------------------|-----------|--------------|
| `CUSTOMER_AR` | 1100, 1200 | AR | Only via `postSalesInvoice`, `postCustomerPayment`, `postCreditNote` |
| `SUPPLIER_AP` | 2100, 2200 | AP | Only via `postSupplierBill`, `postSupplierPayment` |
| `BANK` | 1000, 1010 | Banking | Only via bank reconciliation / M-Pesa link |
| `CASH` | 1011 | Banking | Only via cash receipt/payment |
| `MPESA` | 1020 | M-Pesa | Only via `linkMpesaToPayment` |
| `VAT_OUTPUT` | 2210 | Tax | Only via `postSalesInvoice` / `postCreditNote` |
| `VAT_INPUT` | 1120 | Tax | Only via `postSupplierBill` (if VAT-registered) |
| `WHT_PAYABLE` | 2300 | AP | Only via `postSupplierBill` / `postSupplierPayment` |
| `INVENTORY` | 1300 | Inventory | Only via stock movements |
| `PAYROLL` | 2400 | Payroll | Only via payroll posting |
| `RETAINED_EARNINGS` | 3000 | Year-end | Only via year-end close |
| `FX_GAIN_LOSS` | 4900 / 5900 | FX | Only via realized/unrealized FX journals |
| `SUSPENSE` | 9999 | Exception | Manual journal only |

## Hierarchy Rules
- A parent account is **never postable** (`isPostable=false`)
- Children inherit the parent's `type` and `normalBalance`
- `Account.currentBalance` = sum of children's balances (validated by `reconcileAccountBalances`)

## Seeded Structure (Kenyan SME)
```
1000  ASSETS (header)
  1000  Current Assets (header)
    1010  Cash & Cash Equivalents (CASH control)
    1020  M-Pesa (MPESA control)
    1100  Trade Receivables (CUSTOMER_AR control)
    1120  VAT Input (VAT_INPUT control)
    1300  Inventory (INVENTORY control)
  1500  Non-Current Assets (header)
    1510  Property & Equipment
2000  LIABILITIES (header)
  2000  Current Liabilities (header)
    2100  Trade Payables (SUPPLIER_AP control)
    2200  VAT Output (VAT_OUTPUT control)
    2300  WHT Payable (WHT_PAYABLE control)
    2400  Payroll Liabilities (PAYROLL control)
  2500  Non-Current Liabilities (header)
3000  EQUITY (header)
  3000  Share Capital
  3100  Retained Earnings (RETAINED_EARNINGS control)
4000  REVENUE (header)
  4000  Sales Revenue
  4100  Other Income
5000  EXPENSES (header)
  5000  Cost of Sales
  5100  Operating Expenses
  5900  FX Loss (FX_GAIN_LOSS control)
6000  OTHER (header)
  6100  FX Gain (FX_GAIN_LOSS control)
9999  SUSPENSE (SUSPENSE control)
```

## Migration Backfill
`20261125_phase4_audit_scope/migration.sql`:
- `normalBalance='CREDIT'` for all Liability/Equity/Revenue accounts
- `isControl=true, isPostable=false, controlType` for well-known numbers 1100/2100
- Profile mappings from seeded accounts where present