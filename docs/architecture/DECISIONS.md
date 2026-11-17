# Architecture Decision Records — Innowit One

Append-only. Format: `[YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...`

---

## ADR-0001 — Desktop shell: Tauri 2 around existing Vite/React renderer (not Next.js rewrite)

**[2026-11-17] DECISION:** Implement a Tauri 2 desktop shell around the existing React 19 + Vite + Tailwind v4 renderer, with a separately deployable Node.js API service and PostgreSQL + Prisma as the authoritative data layer. Do **not** migrate the renderer to Next.js 15. | **REASONING:** The 02-TECHNICAL-REQUIREMENTS document prescribes Next.js 15 App Router / Docker, but the actual repository is a Vite/React SPA (verified: `vite build` passes, 1732 modules). Master prompt §4 directs Tauri 2 as the default unless a concrete blocker is proven, and forbids Next.js migration solely because the earlier web TRD named it. The existing renderer is valuable and must be preserved (§0.4). Next.js SSR/Server Actions have no equivalent in a Tauri WebView client. | **CONTEXT:** Discrepancy items #1, #2, #9, #11 in `docs/audit/SPEC_ANALYSIS.md`. The prescribed Prisma schema (05-BACKEND-SCHEMA) remains valid as the starting data model — it is stack-neutral. TanStack Query/Zustand recommendations carry over to the client; Server Actions are replaced by versioned REST endpoints on the Node API.

## ADR-0002 — Auth: token-based sessions for the desktop client, HTTP cookie/JWT hybrid on the API

**[2026-11-17] DECISION:** The desktop client authenticates against the Node API using short-lived access tokens with refresh/session rotation, stored in OS secure storage (Tauri stronghold/keyring), not localStorage. Server-side sessions remain revocable. Demo role switching is compiled out of production builds. | **REASONING:** TRD's HTTP-only cookie model targets a browser; Tauri WebView token handling in OS secure storage is the standard equivalent. Master prompt §6 requires session expiry/revocation and removal of seeded Super Admin as production identity. | **CONTEXT:** Discrepancy #5 in SPEC_ANALYSIS.md.

## ADR-0003 — Baseline environment fixes recorded

**[2026-11-17] DECISION:** `package.json` devDependency `esbuild` bumped `^0.25.0` → `^0.28.2` to resolve the ERESOLVE conflict with `vite@8.3.8` (peerOptional `esbuild ^0.27.0 || ^0.28.0`). No other dependency versions changed. | **REASONING:** Minimal fix for the peer range; avoids `--legacy-peer-deps` silently accepting a broken tree. Verified by successful install + `vite build`. | **CONTEXT:** Baseline install log 2026-11-17; `docs/audit/BASELINE.md`.

## ADR-0004 — `npm run lint` is a typecheck

**[2026-11-17] DECISION:** Treat `npm run lint` as `tsc --noEmit` (typecheck). A real ESLint pass will be added in Phase 1 tooling; until then, reports must label the command as typecheck. | **REASONING:** Master prompt §11 instructs renaming/flagging when the script name misleads. | **CONTEXT:** `package.json` scripts.
