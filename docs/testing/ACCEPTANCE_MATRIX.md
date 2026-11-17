# Acceptance Matrix — Innowit One

Role × module × operation coverage, and the eight required end-to-end user journeys (master prompt §9). Status vocabulary: **Verified working** / **Partially working** / **UI-demo only** / **Missing** / **Blocked-unverified**.

This matrix is the Phase 0 seed. It is updated every phase as gates are exercised with real evidence. Currently **every workflow row is UI-demo only or Missing** — the app has no backend; only shell/render behavior is verified (see `docs/audit/REA_INNOWIT_INSPECTION.md`).

---

## 1. Eight user journeys (master prompt §9)

| # | Journey | Status | Evidence / Gate target |
|---|---|---|---|
| J1 | **Lead-to-cash:** lead → customer → deal → quote → approve → sales order → reserve/fulfil inventory → invoice → eTIMS sandbox submission → KRA ack or visible rejection → M-Pesa/bank payment → receipt allocation → balanced GL posting → customer statement → BI update | **Missing** (screens exist individually; no connected backend flow) | Phase 3/4/6 gate |
| J2 | **Procure-to-pay:** requisition → approval → PO → GRN + inspection → stock ledger/valuation → supplier bill → 3-way match → AP approval → payment → bank rec → balanced GL | **Missing** | Phase 5 gate |
| J3 | **Payroll-to-ledger:** employee data → effective-dated statutory calc → preview → dual approval → payslips → payment register → balanced payroll journal → statutory reports | **Missing** (payroll screen renders, "APPROVED / UNPOSTED TO GL"; statutory rules unverified) | Phase 6 gate |
| J4 | **Inventory correction:** variance → proposed adjustment → approval → stock movement → valuation adjustment → GL posting → audit; no negative/duplicate movement | **Missing** | Phase 5 gate |
| J5 | **Credit note:** approved reason → validate original invoice → reverse AR/tax/revenue/COGS → eTIMS queue → verified ack → reconcile | **Missing** (credit-note screen constructs accepted-looking queue data without real KRA response — prohibited) | Phase 4/6 gate |
| J6 | **Collaboration:** two users exchange message/thread/mention/file/task in authorized workspace; third unauthorized user denied | **Missing** (no real auth, no server) | Phase 2 gate |
| J7 | **Branch management:** Branch A user cannot read/mutate Branch B restricted records; HQ roles see consolidated with branch attribution | **Missing** (branch switcher is UI-only; no server-side scoping) | Phase 1 gate |
| J8 | **Backup & recovery:** admin selects backup version → preview → approve restore → isolated target/guarded mode → verify ledger/stock/audit invariants | **Missing** | Phase 8 gate |

## 2. Phase 1 gate checklist (desktop foundation, identity, data platform)

| Gate criterion | Status | Test plan |
|---|---|---|
| Desktop app launches from dev and packaged build | **Missing** (no Tauri host yet) | `npm run tauri dev` + installer smoke |
| Real user signs in; expired/revoked session denied | **Missing** (seeded Super Admin, no auth) | API-level session tests + UI sign-in flow |
| Unauthorized API requests denied when called directly | **Missing** | Direct HTTP calls without/with wrong token → 401/403 |
| Tenant/branch cross-access fails safely | **Missing** | Cross-branch record access attempt tests |
| Core entities survive restart; second client sees committed changes | **Missing** (COA proven memory-only — `ev_afe9a375…`/`ev_5d8cb24e…`) | Two-client restart test |
| Migration + seed repeatable and idempotent | **Missing** | Run `prisma migrate deploy` + seed twice; compare snapshots |

## 3. Role × module matrix (to be filled per-phase)

Roles: the 12-role RBAC matrix screen enumerates them; production roles will be server-enforced once auth lands (Phase 1). Rows = roles, columns = module operations (view / create / edit / approve / post / transmit). Until Phase 1 authorization exists, all client-side `canViewModule` checks are **usability only, not security** (D-002).

| Module | Operations | Server enforcement | UI affordance | Notes |
|---|---|---|---|---|
| Collaboration | view/post/attach/moderate | Missing | Partially working | Phase 2 |
| CRM & Sales | view/create/approve/convert | Missing | Partially working | Phase 3 |
| Accounting & Finance | create/post/reverse/lock/export | Missing | Partially working | Phase 4 |
| ERP Operations | receive/issue/transfer/approve | Missing | Partially working | Phase 5 |
| HR & Payroll | maintain/run/approve/lock | Missing | Partially working | Phase 6 |
| eTIMS | configure/queue/transmit/reconcile | Missing | Partially working | Phase 6; production transmit dual-controlled |
| BI & Automation | view/build/schedule | Missing | Partially working | Phase 7 |
| Governance/Audit | view/restore | Missing | Partially working | Phase 8 |

## 4. Prohibited behaviors (negative acceptance tests — must fail)

| # | Assertion | Test |
|---|---|---|
| N1 | No code path can fabricate a KRA acknowledgement/control number/signature | Static + dynamic test; Phase 6 |
| N2 | Production eTIMS host unreachable from dev/test/sandbox builds (incl. URL normalization / host substitution attempts) | Network-level deny test |
| N3 | No synthetic period multipliers or hardcoded KPI values in any financial report path | Property/report fixture tests |
| N4 | Unbalanced journal posting rejected atomically | Domain test |
| N5 | Negative stock prevented unless explicitly configured | Domain test |
| N6 | Unauthorized API call (no/invalid token, wrong branch) denied | API integration test |
| N7 | Demo role switching impossible in production builds | Build-config test |
| N8 | localStorage never authoritative for financial/regulated data | Code scan + runtime test |
