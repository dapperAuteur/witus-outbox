# scripts/

Local-only CLI utilities. None of these run on Vercel.

| File | Purpose |
|---|---|
| [`import-radaar-csv.ts`](./import-radaar-csv.ts) | Reads the consultant's RADAAR-format CSV, signs each row, and POSTs to outbox `/api/ingest`. Idempotent on `(source, external_ref)` — safe to rerun. |

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

### CSV format expected

Column order: `date, type, title, caption, medias, links, comments, status`.

- `date` — `YYYY-MM-DD HH:MM` assumed ET, or any ISO 8601 with explicit offset.
- `title` — must start with a bracketed platform prefix the parser recognizes ([lib/platform.ts](../lib/platform.ts)). Recognized: `[YouTube]`, `[LinkedIn]`, `[Twitter]` (or `[X]`, `[Twitter/X]`), `[Facebook]`, `[Instagram]`, `[BlueSky]` (or `[Blue Sky]`), `[TikTok]`, `[Pinterest]`. Aliases: `[YT]`, `[LI]`, `[FB]`, `[IG]`, `[Bsky]`, `[Pin]`.
- `caption` — full caption with hashtags inline.
- `medias` — single URL or empty.
- `links` — newline-separated URLs or empty.
- `type`, `comments`, `status` — ignored by the importer.
