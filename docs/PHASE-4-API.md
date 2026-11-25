# Phase 4 — API Surface & Route Map

## New Routes (mounted at `/api/accounting`)
| Method | Path | Service | Purpose |
|--------|------|---------|---------|
| GET | `/profile` | — | Load/create accounting profile |
| PUT | `/profile` | — | Update profile (mappings, thresholds) |
| GET | `/fiscal-years` | — | List fiscal years |
| POST | `/fiscal-years` | — | Create fiscal year + 12 periods |
| GET | `/periods` | `periods.ts` | List periods with filters |
| POST | `/periods/:id/close` | `periods.ts` | Close period |
| POST | `/periods/:id/reopen` | `periods.ts` | Reopen (SUPER_ADMIN) |
| GET | `/cost-centres` | — | List cost centres |
| POST | `/cost-centres` | — | Create cost centre |
| PUT | `/cost-centres/:id` | — | Update cost centre |
| GET | `/tax-codes` | `taxService.ts` | List tax codes |
| POST | `/tax-codes` | `taxService.ts` | Create tax code |
| PUT | `/tax-codes/:id` | `taxService.ts` | Update tax code |
| POST | `/tax-codes/seed-kenya` | `taxService.ts` | Seed Kenyan VAT catalogue |
| GET | `/exchange-rates` | `fxService.ts` | List FX rates |
| POST | `/exchange-rates` | `fxService.ts` | Capture rate |
| GET | `/exchange-rates/convert` | `fxService.ts` | Preview conversion |
| GET | `/bank-accounts` | `bankService.ts` | List bank accounts |
| POST | `/bank-accounts` | `bankService.ts` | Create bank account |
| GET | `/bank-accounts/:id` | `bankService.ts` | Get bank account + recent statements |
| POST | `/bank-statements/import` | `bankService.ts` | Import CSV statement |
| GET | `/bank-statements` | `bankService.ts` | List statements |
| POST | `/bank-reconciliation` | `bankService.ts` | Start reconciliation |
| POST | `/bank-reconciliation/:id/auto-match` | `bankService.ts` | Run auto-match rules |
| POST | `/bank-reconciliation/:id/finalize` | `bankService.ts` | Finalize (preparer ≠ finalizer) |
| GET | `/bank-reconciliation` | `bankService.ts` | List reconciliations |
| POST | `/mpesa/callback` | `bankService.ts` | Record M-Pesa callback |
| POST | `/mpesa/:id/link-payment` | `bankService.ts` | Link M-Pesa to receipt |
| GET | `/mpesa` | `bankService.ts` | List M-Pesa transactions |
| POST | `/budgets` | — | Create budget + lines |
| GET | `/budgets` | — | List budgets |
| GET | `/reports/trial-balance` | `reportService.ts` | Trial balance |
| GET | `/reports/profit-and-loss` | `reportService.ts` | P&L |
| GET | `/reports/balance-sheet` | `reportService.ts` | Balance sheet |
| GET | `/reports/ar-ageing` | `reportService.ts` | AR ageing |
| GET | `/reports/ap-ageing` | `apService.ts` | AP ageing |
| GET | `/reports/cash-flow` | `reportService.ts` | Cash flow |
| GET | `/reports/budget-variance/:budgetId` | `reportService.ts` | Budget vs actual |
| GET | `/reports/fx-revaluation` | `fxService.ts` | Unrealized FX computation |

## Rewritten Routes (existing paths, new engine)
| Method | Path | Engine |
|--------|------|--------|
| POST | `/api/journal` | `journal.ts` (canonical) |
| PUT | `/api/journal/:id` | `journal.ts` (draft-only) |
| POST | `/api/journal/:id/post` | `journal.ts` (draft→ledger) |
| POST | `/api/journal/:id/reverse` | `journal.ts` (exact reversal) |
| GET | `/api/journal/balance-reconciliation` | `journal.ts` (drift report) |
| POST | `/api/journal/balance-reconciliation/apply` | `journal.ts` (write corrections) |
| POST | `/api/invoices/:id/post` | `arService.postSalesInvoice` |
| POST | `/api/payments` | create draft → `POST /:id/post` → `arService.postCustomerPayment` |
| POST | `/api/payments/:id/allocate` | `arService.allocateCustomerPayment` |
| POST | `/api/credit-notes` | create draft → `POST /:id/post` → `arService.postCreditNote` |
| POST | `/api/suppliers/bills` | create draft → `POST /:id/post` → `apService.postSupplierBill` |
| POST | `/api/suppliers/payments` | create draft → `POST /:id/post` → `apService.postSupplierPayment` |
| POST | `/api/suppliers/payments/:id/allocate` | `apService.allocateSupplierPayment` |

## Authorization Matrix
| Role | Journal | AR | AP | Banking | Tax/FX | Reports | Periods |
|------|---------|-----|----|---------|--------|---------|---------|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| FINANCE_MANAGER | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ACCOUNTANT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| PROCUREMENT_OFFICER | — | — | ✅ | — | — | — | — |
| EXECUTIVE | Read | Read | Read | Read | Read | ✅ | Read |
| SALES_MANAGER | — | Read | — | — | — | — | — |
| SALES_REP | — | Create | — | — | — | — | — |

Segregation of duties:
- Period close ≠ reopen
- Reconciliation prepare ≠ finalize
- Self-approval blocked where `allowSelfApproval=false` (default)