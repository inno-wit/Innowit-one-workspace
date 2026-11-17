# QuickBooks Advanced Feature Benchmark — Innowit One

Status: **skeleton — evidence collection in progress** (REA browser lane).
Checked date: 2026-11-17 · Region/plan caveat: US QBO Advanced features vary by geography and rollout; US-only rails (1099 e-filing, ACH, US sales tax, US payroll) are explicitly out of scope for the Kenyan product (master prompt §5.F).

## Evidence sources to use

1. REA browser inspection of authorized QuickBooks Online (demo/sample company preferred) — `inspect_web_page`, `capture_web_screenshot`, `capture_browser_scenario`, `list_browser_targets`.
2. Current official Intuit documentation (cite URL + checked date).
3. Kenyan localization from official KRA/statutory sources.

Evidence rules: record user goal, entry point, steps, states, validations, permissions, edge cases, resulting business objects, side effects, failure/retry behavior, evidence IDs. Redact tokens/PII/PINs/account numbers. No proprietary code/asset extraction; original Innowit implementations only.

## Benchmark rows (to fill: QuickBooks capability | Innowit equivalent | current status | gap | Kenya relevance | priority | dependencies | implementation phase | acceptance test)

### A. Accounting productivity & transaction throughput
- Batch invoice create/edit/send/import/duplicate
- Batch expenses/checks; spreadsheet-paste workflows
- Recurring invoices/transactions; automatic reminders & payment follow-ups
- Estimate → proposal/contract → signed acceptance/deposit → invoice
- AP hub: bill capture, approvals, payment status, execution adapter, reconciliation
- Automated categorization/matching with explainable suggestions + human review
- Expense capture/receipt attachment, validation, approval

### B. Reporting, dashboards & financial intelligence
- Custom report builder (dimensions/columns/filters/sorting/grouping/summaries/templates/exports)
- Customizable dashboard builder + KPI scorecards (comparison, targets, budgets, drill-through)
- Revenue streams/performance dashboard; cash-flow trends & period comparisons
- Budgeting, budget-vs-actual, forecasting, scenario modelling, cash runway, variance
- Finance AI assistant grounded in authorized tenant data
- Bookkeeping quality checks, anomaly detection, recommended corrections with approvals
- Management report packs with scheduled refresh + narrative

### C. Workflow, roles & data customization
- Trigger-based automations, reminders, approvals, task assignment, notification routing, execution logs
- Custom roles + fine-grained permission policies (view/create/update/approve/post/transmit)
- Enhanced custom fields across records; configurable search/report filters
- Task manager + workflow inbox (owners, due dates, escalation, comments, linked records)
- Classes/locations/departments/projects reporting dimensions

### D. Integrations, backup & collaboration
- Excel data sync/import/export; Google Sheets export patterns
- Public API/webhooks + integration ecosystem
- Automated backup/version history, point-in-time restore, restore audit
- Customer hub/CRM; contracts + e-signature integrations
- Team collaboration, accountant access, external read-only accountant

### E. Industry workflows (evaluate)
- Inventory multi-location, stock valuation, reorder controls
- Project/job costing: budget vs actual, milestones, change orders, progress invoicing, profitability
- Pick/pack/ship, landed cost, barcode/mobile scanning (if relevant)

### F. Kenya localization (mandatory — research official sources)
- KRA eTIMS + current tax handling
- KES base + multi-currency modelling with exchange gains/losses
- Kenya payroll: PAYE, NSSF, SHIF, Affordable Housing Levy — effective-dated versioned rules, no hardcoded rates
- M-Pesa + bank payment reconciliation via authorized providers; manual import fallback
- Kenyan bank statement imports, payment references, mobile-money reconciliation, audit trail
- Local invoice/credit/debit note, withholding/VAT treatment verified against KRA guidance

## Findings log

(empty — populated as REA evidence lands)

## Limitations

- No live KRA/QuickBooks production credentials in this environment; any QBO inspection must use user-authorized demo/sample data only.
