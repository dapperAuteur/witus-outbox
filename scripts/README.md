# scripts/

Local-only CLI utilities. None of these run on Vercel.

| File | Purpose |
|---|---|
| [`import-radaar-csv.ts`](./import-radaar-csv.ts) | Reads the consultant's RADAAR-format CSV, signs each row, and POSTs to outbox `/api/ingest`. Idempotent on `(source, external_ref)` — safe to rerun. |
| [`sync-social-profiles.ts`](./sync-social-profiles.ts) | Triggers a profile sync from the active publisher backend (Ocoya at v1) into the local `social_profile` table. POSTs to outbox `/api/admin/sync-profiles` with a Bearer token; the publisher API key never touches your laptop. |

## `import-radaar-csv.ts`

Maps each CSV row → outbox publish-request. Platform key comes from the `[Platform]` prefix on the `title` column; scheduled_at comes from `date` (assumed Eastern Time when no timezone offset is present, ISO offsets respected when given).

### One-time wiring

In `.env.local`:

```
OUTBOX_INGEST_URL=http://localhost:3000/api/ingest
OUTBOX_INGEST_SECRET=<32-byte-hex matching the receiver's INGEST_SOURCES entry>
OUTBOX_SOURCE_SLUG=radaar-csv-import   # default; override if you registered a different slug
```

For the local loopback case, `OUTBOX_INGEST_SECRET` should equal the `hmac_secret` field of the `radaar-csv-import` entry in your `.env.local`'s `INGEST_SOURCES`. (Receiver-side and publisher-side env vars are split deliberately so cross-product publishers don't accidentally read the receiver's full registry.)

### Typical runs

```sh
# Smoke against a tiny slice without any network calls
npm run import:radaar -- --dry-run --limit 5

# Send the first 5 rows for real (server must be running)
npm run dev   # in another terminal
npm run import:radaar -- --limit 5

# Backfill one upcoming week, skipping anything already past
npm run import:radaar -- --filter-after 2026-05-01 --filter-before 2026-05-08

# Use a CSV outside the default path
npm run import:radaar -- --csv ~/Downloads/she_clocked_in_radaar_import.csv
```

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--csv <path>` | `../../gemini/witus/plans/social-media/consultant-response/she_clocked_in_radaar_import.csv` | CSV file path relative to repo root |
| `--dry-run` | off | Parse + log only; no POST, no env requirement |
| `--limit <n>` | unlimited | Cap on rows successfully processed |
| `--filter-after <iso>` | — | Drop rows whose `scheduled_at` is `<` iso |
| `--filter-before <iso>` | — | Drop rows whose `scheduled_at` is `>=` iso |

### Behavior

- **Idempotency.** `external_ref = sha256(date|title|caption).slice(0,16)`. Receiver's `(source, draft_id)` UNIQUE constraint makes duplicate POSTs no-ops; the importer counts duplicates separately from successes.
- **Past rows skipped.** Receiver requires `scheduled_at >= now + 5 minutes`. The importer drops earlier rows with a logged reason.
- **Unknown platforms skipped.** `[Threads]`, `[Mastodon]`, `[YouTube Shorts]` (no exact match) → row logged + skipped.
- **No PII in logs.** Output includes platform, scheduled time, the 16-char ref, caption length — never the caption text or media URLs.

### When to use this vs the publisher webhook

The CSV importer is for **bootstrapping** — seeding outbox from the consultant's static calendar. Once a publisher product (witus.online, centenarianos, etc.) is wired with `examples/sender.ts`, that product POSTs in real-time and the CSV importer is unused for its content.

You can run both in parallel — they use distinct source slugs (`radaar-csv-import` vs `witus-online`) so they don't collide.

### CSV format expected (importer)

Column order: `date, type, title, caption, medias, links, comments, status`.

- `date` — `YYYY-MM-DD HH:MM` assumed ET, or any ISO 8601 with explicit offset.
- `title` — must start with a bracketed platform prefix the parser recognizes ([lib/platform.ts](../lib/platform.ts)). Recognized: `[YouTube]`, `[LinkedIn]`, `[Twitter]` (or `[X]`, `[Twitter/X]`), `[Facebook]`, `[Instagram]`, `[BlueSky]` (or `[Blue Sky]`), `[TikTok]`, `[Pinterest]`. Aliases: `[YT]`, `[LI]`, `[FB]`, `[IG]`, `[Bsky]`, `[Pin]`.
- `caption` — full caption with hashtags inline.
- `medias` — single URL or empty.
- `links` — newline-separated URLs or empty.
- `type`, `comments`, `status` — ignored by the importer.

---

## `sync-social-profiles.ts`

Populates `social_profile` so the ingest path can resolve `(platform, workspace) → publisher_profile_id` at submit time. Without this, `lib/publishers/ocoya.ts` is "live" (real key) but the social-profile lookup fails for every row → `status='error'` with `code='no_social_profile'`.

The CLI is a thin HTTP wrapper. It POSTs to outbox's `/api/admin/sync-profiles` with a Bearer token. The publisher API key (Ocoya, RADAAR, etc.) **never touches your laptop**.

### One-time wiring

In `.env.local`:

```
APPS_SCRIPT_TOKEN=<32-byte-hex matching the target outbox's value>
OUTBOX_INGEST_URL=http://localhost:3000/api/ingest   # used to derive admin URL
```

For local-loopback runs, set the same `APPS_SCRIPT_TOKEN` in BOTH places (publisher = your shell + receiver = the running outbox's `.env.local`). For prod runs, your laptop's `APPS_SCRIPT_TOKEN` must equal the value set in Vercel Production env.

### Typical runs

```sh
# Local loopback (server must be running)
npm run dev               # in another terminal
npm run sync:profiles

# Against deployed outbox
npm run sync:profiles -- --url https://outbox.witus.online
```

### Pre-requisite — connect accounts in Ocoya first

Sync reads from Ocoya. If you haven't connected your social accounts inside an Ocoya workspace, Ocoya returns an empty list and the sync is a no-op. Sequence:

1. Sign in at https://app.ocoya.com/.
2. For each workspace listed in `OCOYA_WORKSPACE_IDS`: open Workspace → Social profiles, OAuth-connect each network (X, LinkedIn, BlueSky, Facebook, Instagram, etc.).
3. Then run `npm run sync:profiles`.
4. Confirm in the output: `profiles_upserted=N` where N matches the number of accounts you connected.
5. Re-run `npm run import:radaar -- --limit 5` — rows will now flip to `submitted` instead of `error`.

### From the deployed admin UI

The same sync is available as a button at `/outbox/setup` once you're signed in. No CLI required for routine refreshes.
