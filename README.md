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

## Status

**Phase 1 in progress.** Repo bootstrap. See `plans/01-witus-outbox-bootstrap.md` (local-only) for the full approved plan.

External steps that block Phase 1 smoke testing live in `plans/user-tasks/`.

## Why a separate repo

Inbox is *receive-only*; outbox is *send-only*. Mixing the two in one app would couple unrelated lifecycles, secrets, and rate-limit budgets. Separation lets each service own one job — matching the WitUS ecosystem's "every platform has one job" rule.

## License

See [LICENSE](LICENSE) when added.
