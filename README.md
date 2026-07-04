# Beacon API

Beacon API is a browser-based, client-only API testing tool — a Postman-style workspace for building, running, and **security-testing** HTTP requests, built entirely as a Next.js app with no backend/database of its own.

> **Why this doc exists:** this file is meant to be handed to another AI (ChatGPT, etc.) as project context so it can give informed suggestions. It describes what exists today, the architectural constraints that shaped it, and where things are intentionally incomplete.

## What it does

- **Request builder**: method/URL/params/headers/auth (Bearer, Basic, API Key, OAuth2 Client Credentials + Authorization Code/PKCE)/body (JSON, form-data with real file uploads, urlencoded, GraphQL, raw) — organized into collections with nested folders.
- **Scripting**: pre-request and post-response JavaScript, sandboxed in a Web Worker (network/global APIs stripped, not just blocklisted), with a Postman-like `pm`/`be` assertion API and a live console.
- **Assertions & seeding**: visual test assertions (status, response time, JSON path, headers, body text), plus a "repeat request N times" / "multiple JSON items" seeding mode with per-iteration pass/fail tracking — each request now tracks its own run state independently, so two requests can execute concurrently without one's progress bleeding into the other's tab.
- **Collection Runner**: run every request in a collection in sequence with configurable iterations, separate from the single-request Builder flow.
- **Environments & variables**: environment/global/collection-scoped variables with cascading resolution and `{{templating}}`.
- **Import/export**: Beacon's own JSON format (git-committable, redacts secrets/credentials on export) and read-only Postman v2.1 collection import.
- **Security testing panel** (the newest and most actively developed part of the app):
  - Passive response analysis (missing security headers, CORS misconfig, secret/JWT leakage in the body, verbose error/stack-trace leakage, cache-control/rate-limit hygiene).
  - A full **OWASP API Security Top 10 (2023)** checklist per request, with automated hints/auto-fail wired from real findings for 5 of the 10 categories (never auto-"pass" — only ever nudges "not tested" to "fail" when there's real evidence).
  - Active probes: SQLi/XSS/command-injection/path-traversal/NoSQLi payloads (detection-only, never destructive) against a chosen field, plus file-upload-specific probes (double extensions, path traversal filenames, spoofed Content-Type, oversized files).
  - Auth/hygiene helpers: strip auth, send a malformed token, send an unsupported method, send a bogus Content-Type — each with an honest 5-way outcome classifier (properly rejected / accepted-when-it-shouldn't-be / blocked by an unrelated auth gate / server error / non-standard-but-plausible), not a naive 2xx-vs-not check.
  - An **Authorization Matrix**: define named auth "roles" (Anonymous/Regular User/Admin, seeded by default), run the same request as each, flag mismatches against an expected status or a saved baseline (regression detection).
  - **One-click "Run Full Security Scan"**: given just a URL + endpoint, runs response analysis, auth/hygiene checks, active probes across every detected field, file-upload probes, and the Authorization Matrix in a single pass (real attack-shaped requests are gated behind an explicit, non-remembered "I'm authorized" checkbox).
  - Every finding includes a concrete "How to fix" recommendation, not just a description.
  - A results drawer with pass/fail gauges (test assertions + security checklist), a severity breakdown, and detailed findings — reachable from an always-visible "View Results" button next to the response stats, not buried in a tab.
  - An exportable Markdown security report (summary table, full OWASP checklist with fix guidance, every finding, matrix results).

## Architecture

**Client-only, no backend/DB.** Everything lives in the browser. `src/app/api/seed/route.ts` is a thin, generic CORS-bypass proxy — the client sends `{url, method, headers, data}` (or multipart form-data with reserved `__beacon_*` metadata fields), the route relays it server-side with axios and returns the raw response. It has no knowledge of collections, auth, or security logic; all of that is client-side. `src/app/api/demo/*` are mock endpoints (echo, fake auth, CRUD-ish posts/users, OAuth2 mock token/authorize) used for local development and the E2E suite, not part of the product.

**State**: two Zustand stores, both persisted to `localStorage` (behind a custom `storage` adapter that AES-GCM encrypts everything — see `src/lib/crypto.ts`):

- `src/store/collectionStore.ts` — the real data model: collections, folders, requests (with auth/body/assertions/scripts/security config), environments, history, auth profiles. Versioned with a `migrate()` function (currently v5); every schema change adds a new `if (fromVersion < N)` backfill block, plus an unconditional safety-net pass at the end for fields that can drift out of sync with the version number during development.
- `src/store/seederStore.ts` — lightweight UI/session state (active view, open tabs, a shared "is anything running" flag used to disable structural sidebar actions while a request executes).

**Encryption**: `src/lib/crypto.ts` generates a per-install, non-extractable AES-GCM `CryptoKey` stored in IndexedDB — not a hardcoded passphrase, so reading the source can't decrypt another install's data. Decryption failures (e.g., a key that no longer matches, or pre-encryption legacy data) fall back gracefully to `"null"`/raw-passthrough rather than crashing.

**Script sandboxing**: `src/lib/scriptRunner.ts` spins up `src/workers/scriptRunner.worker.ts`, which neuters `fetch`/`importScripts`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`indexedDB`/`caches` via `Object.defineProperty` (works even for getter-only globals) and communicates results back via a *tagged* `postMessage` so a sandbox-escaped script can't forge a fake result through the real `postMessage`. Verified against prototype-chain escape attempts.

**Security testing module** (`src/lib/securityAnalysis.ts`, `securityProbes.ts`, `jwtInspector.ts`, `fileUploadProbes.ts`, `owaspChecklist.ts`, `securityReport.ts`, `src/components/SecurityPanel.tsx`, `AuthMatrixSection.tsx`, `SecurityScanResultsDrawer.tsx`): built around one house rule — **passive analysis never sends a request; anything that sends attack-shaped payloads requires an explicit, non-remembered "I'm authorized" checkbox every time**, and payloads are detection-only (no destructive SQL, no real RCE, no fuzzing volume).

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Zustand (persisted stores) · antd v6 (UI components) · Tailwind v4 · axios (server-side proxy only) · react-icons · Vitest (unit) · Playwright (E2E).

## Project structure

```text
src/
  app/
    api/seed/          # generic CORS-bypass proxy (the only "backend")
    api/demo/           # mock endpoints for local dev + E2E only
    oauth/callback/     # OAuth2 authorization-code popup callback page
  components/           # all UI; SeederWorkspace.tsx is the main request-builder screen
  lib/                   # pure logic: request prep, assertions, security checks, crypto, import/export
  store/                 # Zustand stores (collectionStore = data, seederStore = UI/session state)
  workers/                # sandboxed script execution
  tests/                  # Vitest unit tests (14 files, 159 tests)
e2e/                      # Playwright E2E specs
```

## Running it

```bash
npm run dev        # http://localhost:3000
npm run build && npm run start
npm test           # vitest (unit)
npm run test:e2e   # playwright (E2E, needs `npx playwright install chromium` once)
npm run lint
```

No environment variables or external services are required to run it locally — the demo endpoints under `/api/demo/*` are enough to exercise every feature (OAuth2, file upload, security scanning) without a real API.

## Known constraints / things worth knowing before suggesting changes

- **No backend by design.** This is a deliberate product decision (12-factor, client-only, git-committable collections for team sharing) — suggestions that assume a server-side database or user accounts would be a different product.
- **Security features are intentionally conservative.** They favor "honest not-tested / inconclusive" over false confidence — e.g., the OWASP checklist only auto-fails a category when there's real evidence, never auto-passes; probe outcomes distinguish "properly rejected" from "blocked by an unrelated gate" from "server error" rather than collapsing everything into pass/fail. Any suggestion to make these more "automatic" should be weighed against that principle.
- **CVSS-style scoring was deliberately not implemented** — a precise-looking score from these narrow checks would reintroduce the false-confidence problem the rest of the panel avoids.
- **No true multi-tenant/team backend** — collaboration happens via exporting/importing JSON files (e.g., through git), not a shared server.
- The store's `migrate()` function is the single most failure-prone piece of code in the app (every new persisted field needs both a `version` bump and a backfill block) — worth double-checking whenever the data model changes.
