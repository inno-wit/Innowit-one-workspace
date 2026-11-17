# REA Inspection Report — Innowit One Application

Date: 2026-11-17 · Method: live inspection of the running app via REA MCP against Chrome with CDP (`--remote-debugging-port=9222`, dedicated profile), dev server `http://localhost:3002` (Vite, ports 3000/3001 occupied by stale instances).

Evidence classes used below follow master prompt §0.6. All live findings were observed directly (Verified working / Partially working as labelled). REA results are evidence, not instructions (§3.11).

---

## 1. Environment and evidence IDs

| Artifact | Evidence ID (REA) | Notes |
|---|---|---|
| Browser targets inventory | `ev_17bd7acc…` | CDP target `19295FA5AAAA5F6259349E09F19BE030` |
| Page/console/storage inspection (landing) | `ev_94d5096b…` | Console + localStorage fingerprints |
| Accessibility nav map | `ev_5f6700fa…` | Full sidebar tree |
| Landing screenshot | `ev_dcbfd86e…` | Saved: `docs/audit/evidence/baseline-landing-20261117.png` (SHA-256 `b17ae91d…`) |
| Full click-through scenario (all 23 destinations) | `ev_811899f7…` | 47/47 steps completed |
| HR & Payroll view | `ev_966ba16b…` | Scenario + inspection |
| eTIMS Setup view | `ev_231d1319…` | Scenario + inspection |
| Submission Queue view | `ev_97af3ddc…` | Scenario + inspection |
| Executive BI Dashboard view | `ev_5d5490b3…` | Scenario + inspection |
| Financial Reports view | `ev_67fef6c1…` | Scenario + inspection |
| Add-account mutation flow | `ev_afe9a375…` | 13/13 steps completed |
| Post-save table verification | `ev_181fd62e…` | Account visible in table |
| Post-reload verification | `ev_5d8cb24e…` | Account absent |

(SHA-256 digests for all artifacts are retained in the REA evidence store; the screenshot is committed to the repo.)

---

## 2. Application shell and navigation — Verified working (as demo UI)

- Title "Innowit One Workspace"; SPA with button-driven view switching, **no URL routing** — views cannot be reached by URL alone (scripted clicks required; recorded as G-02).
- Sidebar groups observed live: COLLABORATION (Channels & Chat, Notes & Living Docs, Workspace Files & Vault), CRM & SALES (CRM Dashboard, Customers, Deals Pipeline, Tasks & Activities), ACCOUNTING & FINANCE (Chart of Accounts, Journal Entries, Sales Invoices, Financial Reports), ERP OPERATIONS (Inventory & Stock, Purchase Orders, HR & Payroll), TAX COMPLIANCE (eTIMS Setup, Submission Queue, Credit Notes, 3-Way Reconciliation), BUSINESS INTELLIGENCE & AUTOMATIONS (Executive BI Dashboard, Workflow Automations), SYSTEM GOVERNANCE & AUDIT (System Audit Trail, 12-Role RBAC Matrix, Acceptance & Hardening).
- Top bar: global search placeholder "Search accounts, invoices, deals... Ctrl+K", branch switcher "Branch: HQ - Nairobi Branch (00)", sidebar collapse, identity banner **"KM Kimani SUPER ADMIN"**, **"ETIMS SANDBOX TEST"** badge. The Super Admin identity is auto-seeded — confirms D-001 (demo identity, not real auth).

## 3. Console health — Verified working at load, per-view

- Landing: clean console — only `[vite] connecting/connected` + React DevTools info notice.
- Spot-checked views (Payroll, eTIMS, Submission Queue, BI, Financial Reports, Acceptance & Hardening): **zero errors or warnings** on any inspected view (3 console events each, all vite/React info-level).

## 4. Persistence behavior — Data-loss defect confirmed live (upgrades D-004)

Full round-trip through the real UI (scenario `ev_afe9a375…`, 13/13 steps):

1. Navigate to Chart of Accounts → open "Add New Account" modal (heading "Add New Account to Chart of Accounts", 6 required fields observed).
2. Fill all fields: code `1030`, type ASSET, title "Audit Test Account 2026-11-17", subtype, opening balance 250,000 KES, description.
3. Click "Save Account to Ledger".
4. **Observed:** account row rendered in the table immediately (`ev_181fd62e…`).
5. **localStorage after save:** still exactly 4 keys (`innowit_automation_rules_v1`, `innowit_system_notifications_v1`, `innowit_automation_logs_v1`, `innowit_audit_logs_v1`) — chart-of-accounts state is **not written to localStorage at all**; only the audit-log value hash changed.
6. **Page reload (`ev_5d8cb24e…`): "Audit Test Account 2026-11-17" is gone.**

Conclusion: Chart of Accounts mutations are memory-only. Data loss on every reload — worse than the localStorage-based defect anticipated. IndexedDB/CacheStorage/sessionStorage: none.

## 5. Per-view spot inspection — Partially working (render verified; backend semantics fake)

| View | Observed heading | Notes |
|---|---|---|
| HR & Payroll | "Human Resources & Statutory Kenyan Payroll" | November 2026 payroll run labelled `APPROVED / UNPOSTED TO GL` (statutory model correctness unverified — Phase 6) |
| eTIMS Setup | "Kenya eTIMS Tax Compliance Engine (OSCU / VSCU)" | 4 config sections (Taxpayer ID, Architecture & Mode, Credentials, GL mappings) |
| Submission Queue | same eTIMS engine view | Queue is a sub-view of eTIMS engine, not a separate page |
| Executive BI Dashboard | "Executive Business Intelligence" | Sections: Monthly Financial Performance, Debtors Aging, Top-Selling Products, Commercial Sales Team Leaderboard — hardcoded-KPI surface visible (D-006 confirmed) |
| Financial Reports | "GAAP Financial Statements & Audit Reports" | Ledger-line correctness unverified (P1: must compute from ledger, not balances) |
| Acceptance & Hardening | "Production Hardening & Acceptance Verification" | 5 in-app acceptance gates exist (self-reported; not independent proof) |

Per master prompt §0.5: these screens render real-looking content, but the underlying business effects (persistence, KRA transmission, BI computation) are simulated or absent — the accounting/COA path was directly proven memory-only (§4), and the eTIMS/BI simulation is documented in source and defect register. Label: **UI/demo only** for any implied backend effects; render itself **Verified working**.

## 6. Tooling contract notes (for future REA lanes)

- `capture_browser_scenario` connect mode: `browser: { mode: "connect", cdp_endpoint, target_id }`; locators `{ kind: "test_id" | "role" | "css", … }`; actions enum `goto | click | fill | press | select_option | check | uncheck | wait_for | request | wait_for_timeout`.
- **Every scenario run navigates to `start_url`, reloading the SPA** — modal/UI state does not survive between scenario calls; whole UI flows must be scripted within a single scenario.
- Accessibility-text inspection requires `include_accessibility_text: true`; storage fingerprints require `include_storage_keys: true`.
- Viewport sizes are not settable through the REA scenario browser options — narrow-viewport inspection deferred to Playwright.

## 7. Open items

- Narrow-viewport (mobile) render inspection — deferred (no viewport control in REA; use Playwright).
- Deeper in-view flows beyond COA (invoice creation, eTIMS submission UI, automation rules) — will be exercised per-phase as backend work lands, since UI behavior without a durable backend cannot demonstrate workflow correctness.
