# Beacon

Beacon is a browser-based, client-only API testing tool — a Postman-style workspace for building, running, and **security-testing** HTTP requests, installable as a PWA, built entirely as a Next.js app with no backend/database of its own.

> **Why this doc exists:** this file is meant to be handed to another AI (ChatGPT, etc.) as project context so it can give informed suggestions. It describes what exists today, the architectural constraints that shaped it, and where things are intentionally incomplete.

## What it does

- **Request builder**: method/URL/params/headers/auth (Bearer, Basic, API Key, OAuth2 Client Credentials + Authorization Code/PKCE)/body (JSON, form-data with real file uploads, urlencoded, GraphQL, raw) — organized into collections with nested folders.
- **Scripting**: pre-request and post-response JavaScript, sandboxed in a Web Worker (network/global APIs stripped, not just blocklisted), with a Postman-like `pm`/`be` assertion API and a live console.
- **Assertions & seeding**: visual test assertions (status, response time, JSON path, headers, body text), plus a "repeat request N times" / "multiple JSON items" seeding mode with per-iteration pass/fail tracking — each request tracks its own run state independently, so two requests can execute concurrently without one's progress bleeding into the other's tab.
- **Collection Runner**: run every request in a collection in sequence with configurable iterations, separate from the single-request Builder flow.
- **Environments & variables**: environment/global/collection-scoped variables with cascading resolution and `{{templating}}`.
- **Import/export**:
  - Beacon's own JSON format (git-committable, redacts secrets/credentials on export).
  - Read-only Postman v2.1 collection import.
  - **OpenAPI 3.x / Swagger 2.0 import** (`src/lib/openApiImport.ts`) — by file upload (JSON or YAML) or by URL with optional credentials for a protected docs page. Per-operation auth resolution (a spec can freely mix public and protected endpoints; an explicit `security: []` on an operation means "public," overriding the document's default). Auto-discovers the real spec if given a Swagger UI *docs* page instead of the raw JSON (detects the HTML shell, finds the embedded config or init script, resolves relative `servers[].url` against wherever the spec was actually fetched from). The base URL is saved as an **environment variable** (`base_url`, auto-activated) rather than hardcoded per request, so switching servers is a one-line edit.
- **Security testing panel** (the newest and most actively developed part of the app):
  - Passive response analysis (missing security headers, CORS misconfig, secret/JWT leakage in the body, verbose error/stack-trace leakage, cache-control/rate-limit hygiene).
  - A full **OWASP API Security Top 10 (2023)** checklist per request, with automated hints/auto-fail wired from real findings for 5 of the 10 categories (never auto-"pass" — only ever nudges "not tested" to "fail" when there's real evidence).
  - Active probes: SQLi/XSS/command-injection/path-traversal/NoSQLi payloads (detection-only, never destructive) against a chosen field, plus file-upload-specific probes (double extensions, path traversal filenames, spoofed Content-Type, oversized files).
  - Auth/hygiene helpers: strip auth, send a malformed token, send an unsupported method, send a bogus Content-Type — each with an honest 5-way outcome classifier (properly rejected / accepted-when-it-shouldn't-be / blocked by an unrelated auth gate / server error / non-standard-but-plausible), not a naive 2xx-vs-not check.
  - An **Authorization Matrix**: define named auth "roles" (Anonymous/Regular User/Admin, seeded by default), run the same request as each, flag mismatches against an expected status or a saved baseline (regression detection).
  - **Fully automated by default**: the safe checks (response analysis, auth/hygiene helpers, Authorization Matrix) run automatically the instant a request's Execute finishes — no click required. The risky part (active injection + file-upload probes, which send real attack-shaped payloads) stays behind consent, but with two tiers: a per-run "I'm authorized" checkbox that's never remembered, or a persisted, one-time-per-request opt-in ("always run advanced probes automatically") for testers who want full automation without re-confirming every time.
  - Every finding includes a concrete "How to fix" recommendation, not just a description.
  - A results drawer with a **production-readiness verdict** ("Not Production Ready" / "Needs Review" / "No Blocking Issues Found" — a heuristic, not a certification), pass/fail gauges (test assertions + security checklist), a severity breakdown, and detailed findings — reachable from an always-visible "View Results" button next to the response stats, not buried in a tab.
  - An exportable Markdown security report (summary table, full OWASP checklist with fix guidance, every finding, matrix results).
- **Progressive Web App**: installable (manifest + icons + service worker with an offline app shell), with automatic update detection — polls for a new deploy (via the service worker's own update lifecycle and a `/version.json` fallback so it works even where a service worker can't run) and shows a premium "Update Available" banner with the actual changelog for the new build, not just a generic "refresh" prompt.

## Architecture

**Client-only, no backend/DB.** Everything lives in the browser. `src/app/api/seed/route.ts` is a thin, generic CORS-bypass proxy — the client sends `{url, method, headers, data}` (or multipart form-data with reserved `__beacon_*` metadata fields), the route relays it server-side with axios and returns the raw response. It has no knowledge of collections, auth, or security logic; all of that is client-side. The proxy is hardened against SSRF (`src/lib/egressGuard.ts`): blocks loopback/private/link-local ranges by default (via Node's `net.BlockList`), validates the *resolved* IP rather than just the hostname (defeats DNS rebinding and decimal/hex IP encoding tricks), re-validates on every redirect hop, and pins the TCP connection to the validated IP (defeats TOCTOU rebinding races). `src/app/api/demo/*` are mock endpoints (echo, fake auth, CRUD-ish posts/users, OAuth2 mock token/authorize) used for local development and the E2E suite, not part of the product.

**State**: two Zustand stores, both persisted to `localStorage` (behind a custom `storage` adapter that AES-GCM encrypts everything — see `src/lib/crypto.ts`):

- `src/store/collectionStore.ts` — the real data model: collections, folders, requests (with auth/body/assertions/scripts/security config), environments, history, auth profiles. Versioned with a `migrate()` function; every schema change adds a new `if (fromVersion < N)` backfill block, plus an unconditional safety-net pass at the end for fields that can drift out of sync with the version number during development.
- `src/store/seederStore.ts` — lightweight UI/session state (active view, open tabs, open modals/drawers, theme, a shared "is anything running" flag used to disable structural sidebar actions while a request executes).

**Encryption**: `src/lib/crypto.ts` generates a per-install, non-extractable AES-GCM `CryptoKey` stored in IndexedDB — not a hardcoded passphrase, so reading the source can't decrypt another install's data. Decryption failures (e.g., a key that no longer matches, or pre-encryption legacy data) fall back gracefully to `"null"`/raw-passthrough rather than crashing.

**Script sandboxing**: `src/lib/scriptRunner.ts` spins up `src/workers/scriptRunner.worker.ts`, which neuters `fetch`/`importScripts`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`indexedDB`/`caches` via `Object.defineProperty` (works even for getter-only globals) and communicates results back via a *tagged* `postMessage` so a sandbox-escaped script can't forge a fake result through the real `postMessage`. Verified against prototype-chain escape attempts.

**Security testing module** (`src/lib/securityAnalysis.ts`, `securityProbes.ts`, `jwtInspector.ts`, `fileUploadProbes.ts`, `owaspChecklist.ts`, `securityReport.ts`, `src/components/SecurityPanel.tsx`, `AuthMatrixSection.tsx`, `SecurityScanResultsDrawer.tsx`): built around one house rule — **passive analysis never sends a request; anything that sends attack-shaped payloads requires explicit consent** (either a per-run, non-remembered checkbox, or a persisted per-request opt-in the tester deliberately turns on), and payloads are detection-only (no destructive SQL, no real RCE, no fuzzing volume).

**App identity & config** (`app.json`, `src/lib/site.ts`): an Expo-style single source of truth for app name, description, author, theme colors, icons, and OG/screenshot assets — consumed by `layout.tsx` (metadata), `manifest.ts`, `robots.ts`, `sitemap.ts`, the `security.txt` route, `Header.tsx`, and `Footer.tsx`, so these can't drift out of sync with each other. Version is the one exception — deliberately *not* duplicated into `app.json`; it defers to `package.json`, the convention every npm tool already reads.

**PWA & update system** (`src/app/sw.js/route.ts`, `src/app/version.json/route.ts`, `src/components/PwaUpdateManager.tsx`, `src/lib/changelog.ts`, `next.config.ts`): the service worker is served from a Route Handler (not a static file) so a build identifier — `git rev-parse --short HEAD` at build time, overridable via `BEACON_BUILD_ID` — can be templated straight into its bytes; that byte-difference is what lets the browser (and Beacon's own polling) detect a new deploy. Update detection never auto-activates the new worker — control only hands over when the tester clicks "Reload Now" in the banner, so an in-progress request or scripted run is never yanked out from under them. `src/lib/changelog.ts` is a hand-maintained array of release highlights surfaced in that banner.

## SEO & discovery

`src/app/robots.ts` (explicit per-crawler rules — search engines and AI bots like GPTBot/ClaudeBot/PerplexityBot are welcomed, not blocked), `src/app/sitemap.ts`, `src/app/.well-known/security.txt/route.ts` (RFC 9116), `public/llms.txt` and `public/ai.txt` (AI-agent-facing summaries), and Open Graph/Twitter Card metadata with a generated share image (`public/og-image.png`) in `layout.tsx`.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Zustand (persisted stores) · antd v6 (UI components) · Tailwind v4 · axios (server-side proxy only) · js-yaml (OpenAPI/Swagger YAML parsing) · react-icons · sonner (toasts) · Vitest (unit) · Playwright (E2E).

## Project structure

```text
app.json                  # Expo-style app identity/config — see src/lib/site.ts
src/
  app/
    api/seed/              # generic CORS-bypass proxy, SSRF-guarded (the only "backend")
    api/demo/               # mock endpoints for local dev + E2E only
    oauth/callback/         # OAuth2 authorization-code popup callback page
    manifest.ts             # PWA web app manifest
    sw.js/route.ts          # service worker (build-id templated in, drives update detection)
    version.json/route.ts   # SW-independent update-detection endpoint
    robots.ts               # robots.txt (search + AI crawler rules)
    sitemap.ts              # sitemap.xml
    .well-known/security.txt/route.ts
  components/               # all UI; SeederWorkspace.tsx is the main request-builder screen
  lib/                       # pure logic: request prep, assertions, security checks, crypto,
                              #   import/export, OpenAPI import, egress guard, site config, changelog
  store/                     # Zustand stores (collectionStore = data, seederStore = UI/session state)
  workers/                    # sandboxed script execution
  tests/                      # Vitest unit tests (16 files, 222 tests)
e2e/                          # Playwright E2E specs
public/
  llms.txt, ai.txt            # AI-agent-facing site summaries
  og-image.png                # Open Graph share image
  icon-*.png, apple-touch-icon.png, screenshot-*.png   # PWA icons + install-prompt screenshots
```

## Running it

```bash
npm run dev        # http://localhost:3000
npm run build && npm run start
npm test           # vitest (unit)
npm run test:e2e   # playwright (E2E, needs `npx playwright install chromium` once)
npm run lint
```

No environment variables or external services are required to run it locally — the demo endpoints under `/api/demo/*` are enough to exercise every feature (OAuth2, file upload, security scanning) without a real API. Optional env vars: `NEXT_PUBLIC_SITE_URL` (overrides the default deployed URL used for absolute OG/sitemap links), `BEACON_BUILD_ID` (overrides the git-sha-derived build id), `BEACON_PROXY_ALLOW_PRIVATE=true` (dev-only escape hatch to let the proxy reach `localhost`/private IPs — never enable this in a public deployment).

## Known constraints / things worth knowing before suggesting changes

- **No backend by design.** This is a deliberate product decision (12-factor, client-only, git-committable collections for team sharing) — suggestions that assume a server-side database or user accounts would be a different product.
- **Security features are intentionally conservative.** They favor "honest not-tested / inconclusive" over false confidence — e.g., the OWASP checklist only auto-fails a category when there's real evidence, never auto-passes; probe outcomes distinguish "properly rejected" from "blocked by an unrelated gate" from "server error" rather than collapsing everything into pass/fail; the production-readiness verdict is explicitly a heuristic, not a certification. Any suggestion to make these more "automatic" should be weighed against that principle — the fully-automated safe-check pipeline already pushes hard in that direction and deliberately stops short of auto-running attack payloads without some form of consent.
- **CVSS-style scoring was deliberately not implemented** — a precise-looking score from these narrow checks would reintroduce the false-confidence problem the rest of the panel avoids.
- **No true multi-tenant/team backend** — collaboration happens via exporting/importing JSON files (e.g., through git), not a shared server.
- The store's `migrate()` function is the single most failure-prone piece of code in the app (every new persisted field needs both a `version` bump and a backfill block) — worth double-checking whenever the data model changes.
- **Deployed on AWS Amplify** (git-integration, auto-builds from `main`). `app.json`'s `url` field / `NEXT_PUBLIC_SITE_URL` should be updated if a custom domain replaces the default `*.amplifyapp.com` one.
