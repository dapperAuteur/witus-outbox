# witus-outbox

Single-operator outbound publishing service for the WitUS ecosystem. Sibling to [witus-inbox](https://github.com/dapperAuteur/witus-inbox).

## What it does

- Accepts HMAC-signed "publish this" webhooks at `POST /api/ingest` from any registered ecosystem product.
- Accepts CSV imports from `scripts/import-radaar-csv.ts` (the consultant calendar at `gemini/witus/plans/social-media/consultant-response/she_clocked_in_radaar_import.csv`).
- Forwards each post to a **swappable publisher backend** (Ocoya at v1) via the `PublisherAdapter` interface in `lib/publishers/`. Switching backends = add an adapter file, flip one env var.
- Reconciles in-flight statuses via a publisher-agnostic Google Apps Script tick (every 15 min, runs in BAM's Workspace, no Vercel cron). Apps Script POSTs to outbox `/api/admin/tick`; outbox dispatches to the active adapter.
- Fires SMS + email alerts (Mobile Text Alerts + Mailgun) when the publisher rejects a submit or flips a row to `error` at publish time.
- Surfaces a triage UI at `/outbox` for manual retry / reschedule / cancel / reconcile-now.

## Modularity

DB columns are publisher-agnostic (`publisher_backend`, `publisher_post_id`, `publisher_profile_id`). Apps Script holds zero publisher credentials. Social-account changes need no code change — the next tick refreshes the cache from whichever adapter is active.

## Stack

- Next.js 16 (App Router) on Vercel
- Drizzle ORM + Neon Postgres
- NextAuth v4 (email magic link, single admin via `ADMIN_EMAIL`)
- Tailwind CSS v4
- Zod validation, Vitest tests
- Error monitoring via the `@sentry/nextjs` SDK pointed at **Better Stack**

## Uptime monitoring

**Point uptime monitors at `GET /api/health`, not at `/`.** The homepage can return a cached 200
while Postgres is down, so a green check there means nothing. `/api/health` is public,
unauthenticated, never cached (`force-dynamic` + `Cache-Control: no-store`) and runs one real
`select 1` against Neon on every request:

| Condition | Status | Body |
| --- | --- | --- |
| Database answers | `200` | `{"ok":true,"checkedAt":"<ISO 8601>"}` |
| Database unreachable, erroring, or slower than 4s | `503` | `{"ok":false,"error":"database_unreachable"}` |

The failure body is that fixed token and nothing else. Neon connection errors routinely embed the
connection string **including the password**, so the raw error never crosses the response boundary;
only the content-free error class name and SQLSTATE (via `lib/db-safe.ts`) go to the server log.

It checks the database and nothing else. It deliberately does **not** call Ocoya, SocialChamp,
Mailgun or Mobile Text Alerts, and reports nothing about which publisher backend is configured or
whether its token is valid: a vendor outage is not an outbox outage and must not turn the monitor
red, provider error bodies echo bearer tokens, and this endpoint is open to the internet.

Not to be confused with `GET /api/admin/health`, which is bearer-authed and answers a different
question: "did the Apps Script reconciler tick recently, and what last broke?"

The reconciler itself is watched by a **Better Stack heartbeat**: `/api/admin/tick` pings
`BETTERSTACK_HEARTBEAT_URL` only at the end of a *successful* tick. A missed heartbeat IS the
signal — it means Apps Script stopped calling or the tick started failing — so failure paths
deliberately do not ping. Inert until the env var is set; the ping is awaited with a short timeout
and can never fail the tick itself.

## Error monitoring

Server, edge and browser errors report through the `@sentry/nextjs` SDK to a Better Stack source. The
SDK is **guarded on the DSN**: with `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` unset, `init()` never runs
and the whole layer is inert (`__tests__/sentry-inert.test.ts` guards that). Set the vars listed in
`.env.example` to turn it on; `plans/user-tasks/16-error-monitoring-dsn.md` has the operator steps.

Because outbox holds the ecosystem's publishing credentials, `lib/sentry-scrub.ts` runs a strict
`beforeSend` pass on every runtime: request bodies are dropped outright, cookies and credentialed
headers are deleted, captured local variables are dropped, and publisher API keys, ingest HMAC
secrets, social-platform OAuth tokens, JWTs, connection-string passwords and email addresses are
redacted out of messages, exception values, breadcrumbs, tags and extras. `lib/sentry-scrub.test.ts`
asserts the serialized event contains none of them.

## Distributed tracing

Traces go to **Honeycomb** over OTLP via `@vercel/otel` (`otel.config.ts`, registered from
`instrumentation.ts` **before** the Sentry configs load — whoever registers the global tracer
provider first wins, and Sentry is told to stand down via `skipOpenTelemetrySetup` in
`sentry.server.config.ts`). Service name is `witus-outbox`.

- **Inert until the key is set**: `HONEYCOMB_INGEST_API_KEY_SECRET` (fallback `HONEYCOMB_API_KEY`).
  Same inert-until-provisioned pattern as the Sentry DSN — with neither var set, registration is
  skipped entirely.
- **`/api/health` spans are dropped at the sampler** — Better Stack probes it around the clock, and
  those requests must not spend Honeycomb's free-tier event budget. Everything else is recorded
  unsampled.
- `@vercel/otel` honors incoming W3C `traceparent` headers, so a publish request signed by a
  sending ecosystem app continues here as the same distributed trace.

## E2E + accessibility CI

Playwright specs live in `e2e/`; the gate runs in `.github/workflows/e2e.yml` on
`deployment_status` — it tests the **real Vercel deployment URL** (preview → full suite,
production → `@smoke` only), so CI needs no secrets, database, or env. The suite runs desktop plus
a 360px mobile project, and every covered page must pass an axe check with **zero serious or
critical WCAG A/AA violations** — the gate is strict on purpose; fix the page, not the gate.

- Local runs: `PLAYWRIGHT_BASE_URL=<url> npx playwright test` (drives installed Chrome via
  `channel: "chrome"`; Playwright's bundled chromium doesn't support macOS 13).
- If the Vercel project enables Deployment Protection, set the project's "Protection Bypass for
  Automation" secret as the `VERCEL_AUTOMATION_BYPASS_SECRET` Actions secret; public previews need
  nothing.
- **Synthetic traffic is tagged, not hidden**: every request the suite makes carries
  `x-witus-origin-test: playwright-synthetic`, which the OTel layer surfaces as the
  `witus.origin_test` span attribute — Honeycomb queries (and logs/analytics) can include or
  exclude test traffic. Absent header = attribute absent = real user.

## Sign in with WitUS (ecosystem SSO)

Optional. Set `WITUS_OIDC_CLIENT_ID` / `WITUS_OIDC_CLIENT_SECRET` (plus `NEXT_PUBLIC_WITUS_SSO` to
reveal the button) and `/auth/sign-in` offers "Sign in with WitUS" alongside the email magic link.
WitUS sign-ins still pass the `ADMIN_EMAIL` gate in `lib/auth.ts`, so only the admin's WitUS account
completes the flow.

Two behaviours ride on that config, and **both stay completely dark without `WITUS_OIDC_CLIENT_ID`**:

- **"Continue as &lt;name&gt;".** The sign-in form renders immediately and, in parallel, the page asks
  `<idp-origin>/api/ecosystem/session` (derived from `WITUS_OIDC_DISCOVERY_URL`, never hardcoded a
  second time) whether this browser already has a WitUS session. If it does, the button relabels to
  "Continue as &lt;name&gt;". A blocked, failed or timed-out probe is **invisible** — no error, no
  spinner, no layout shift — which is the common case on Safari and Firefox, where the IdP cookie is
  a partitioned third-party cookie. The name is display copy only: clicking still runs the real OIDC
  code flow, which is the only thing that establishes identity. A one-shot marker
  (`sessionStorage["witus.sso.attempted"]`, plus a `?sso=tried` query param) is written **before**
  the redirect so a stale IdP session cannot produce a sign-in loop.
- **Global sign-out.** With SSO configured, the header button reads "Sign out of WitUS" and signing
  out of Outbox ends the shared session at `accounts.witus.online` too. The local NextAuth session is
  destroyed **first**, then the browser is handed to the IdP's `end_session_endpoint` — so an
  unreachable or refusing IdP still leaves you signed out here. Without SSO configured the button is
  the plain local "Sign out" it has always been.

Design and reasoning: `lib/silent-sso.ts`. Tests: `lib/silent-sso.test.ts`.

## Status

**Phase 1 in progress.** Repo bootstrap. See `plans/01-witus-outbox-bootstrap.md` (local-only) for the full approved plan.

External steps that block Phase 1 smoke testing live in `plans/user-tasks/`.

## Why a separate repo

Inbox is *receive-only*; outbox is *send-only*. Mixing the two in one app would couple unrelated lifecycles, secrets, and rate-limit budgets. Separation lets each service own one job — matching the WitUS ecosystem's "every platform has one job" rule.

## License

See [LICENSE](LICENSE) when added.
# witus-outbox
