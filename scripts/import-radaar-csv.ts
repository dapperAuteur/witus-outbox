#!/usr/bin/env tsx
/**
 * RADAAR-format CSV importer for witus-outbox.
 *
 * Reads the consultant's RADAAR-shaped CSV (default path:
 * gemini/witus/plans/social-media/consultant-response/
 *   she_clocked_in_radaar_import.csv), parses each row, signs an outbox
 * publish-request with the local INGEST_SOURCES secret, and POSTs to
 * /api/ingest. Idempotent on (source, external_ref) — safe to rerun.
 *
 * Usage:
 *   npm run import:radaar -- --dry-run --limit 5
 *   npm run import:radaar -- --limit 50 --filter-after 2026-05-01
 *   npm run import:radaar -- --csv /path/to/file.csv
 *
 * Required env (in .env.local):
 *   OUTBOX_INGEST_URL    e.g. http://localhost:3000/api/ingest
 *   OUTBOX_INGEST_SECRET HMAC secret matching INGEST_SOURCES on the receiver
 *   OUTBOX_SOURCE_SLUG   defaults to "radaar-csv-import"
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { config as loadEnv } from "dotenv";
import { sendToOutbox, type OutboxPlatform } from "../examples/sender";
import { parsePlatformPrefix } from "../lib/platform";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

interface CsvRow {
  date: string;
  type?: string;
  title: string;
  caption: string;
  medias?: string;
  links?: string;
  comments?: string;
  status?: string;
}

interface CliOptions {
  csvPath: string;
  dryRun: boolean;
  limit: number | null;
  filterAfter: Date | null;
  filterBefore: Date | null;
}

const DEFAULT_CSV_PATH =
  "../../gemini/witus/plans/social-media/consultant-response/she_clocked_in_radaar_import.csv";

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    csvPath: DEFAULT_CSV_PATH,
    dryRun: false,
    limit: null,
    filterAfter: null,
    filterBefore: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--csv":
        opts.csvPath = argv[++i] ?? "";
        break;
      case "--limit":
        opts.limit = Number.parseInt(argv[++i] ?? "", 10);
        if (!Number.isFinite(opts.limit) || opts.limit <= 0) {
          throw new Error(`--limit requires a positive integer`);
        }
        break;
      case "--filter-after":
        opts.filterAfter = new Date(argv[++i] ?? "");
        if (Number.isNaN(opts.filterAfter.getTime())) {
          throw new Error(`--filter-after requires an ISO date`);
        }
        break;
      case "--filter-before":
        opts.filterBefore = new Date(argv[++i] ?? "");
        if (Number.isNaN(opts.filterBefore.getTime())) {
          throw new Error(`--filter-before requires an ISO date`);
        }
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printUsage(): void {
  console.log(`Usage: npm run import:radaar -- [options]

Options:
  --csv <path>             CSV file path (default: ${DEFAULT_CSV_PATH})
  --dry-run                Parse + log; do NOT POST
  --limit <n>              Process at most n eligible rows
  --filter-after <iso>     Only rows whose scheduled date is >= iso
  --filter-before <iso>    Only rows whose scheduled date is <  iso
  --help                   Show this message

Required env (.env.local):
  OUTBOX_INGEST_URL        e.g. http://localhost:3000/api/ingest
  OUTBOX_INGEST_SECRET     matches the receiver's INGEST_SOURCES hmac_secret
  OUTBOX_SOURCE_SLUG       defaults to "radaar-csv-import"
`);
}

/**
 * Convert "YYYY-MM-DD HH:MM" assumed-Eastern-Time to a UTC Date.
 * If the input already has an explicit offset (Z or ±HH:MM), pass through.
 * DST boundary (the 2 AM jump) is not handled specially; consultant posts
 * land at 8 AM / 9:30 / 10 / 11 ET so we never sit on the boundary.
 */
function parseScheduledDate(raw: string): Date {
  const trimmed = raw.trim();
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    return new Date(trimmed);
  }
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) {
    throw new Error(`Bad date: "${raw}"`);
  }
  const [, y, mo, d, h, mi] = m;
  const naiveUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const tzPart =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offsetMatch = tzPart.match(/GMT([+-]?\d+)/);
  const offsetHours = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : -5;
  return new Date(naiveUtcMs - offsetHours * 3_600_000);
}

function externalRef(date: string, title: string, caption: string): string {
  return createHash("sha256")
    .update(`${date}|${title}|${caption}`)
    .digest("hex")
    .slice(0, 16);
}

function readRows(csvPath: string): CsvRow[] {
  const absolute = resolve(process.cwd(), csvPath);
  const content = readFileSync(absolute, "utf8");
  return parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as CsvRow[];
}

interface BuildResult {
  ok: true;
  externalRef: string;
  platform: OutboxPlatform;
  scheduledAt: Date;
  caption: string;
  mediaUrls: string[];
  links: string[];
}
interface BuildSkip {
  ok: false;
  reason: string;
}

function buildSubmission(
  row: CsvRow,
  opts: CliOptions
): BuildResult | BuildSkip {
  if (!row.title || !row.caption || !row.date) {
    return { ok: false, reason: "missing date/title/caption" };
  }
  const parsed = parsePlatformPrefix(row.title);
  if (!parsed) {
    return { ok: false, reason: `unknown platform prefix: "${row.title}"` };
  }
  let scheduledAt: Date;
  try {
    scheduledAt = parseScheduledDate(row.date);
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "bad date",
    };
  }
  if (scheduledAt.getTime() <= Date.now() + 5 * 60_000) {
    return {
      ok: false,
      reason: `scheduled_at is not >= now + 5min: ${scheduledAt.toISOString()}`,
    };
  }
  if (opts.filterAfter && scheduledAt < opts.filterAfter) {
    return { ok: false, reason: "before --filter-after" };
  }
  if (opts.filterBefore && scheduledAt >= opts.filterBefore) {
    return { ok: false, reason: "at-or-after --filter-before" };
  }

  const mediaUrls = row.medias?.trim() ? [row.medias.trim()] : [];
  const links = (row.links ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    ok: true,
    externalRef: externalRef(row.date, row.title, row.caption),
    platform: parsed.platform,
    scheduledAt,
    caption: row.caption,
    mediaUrls,
    links,
  };
}

interface RunCounts {
  total: number;
  sent: number;
  duplicate: number;
  skipped: number;
  failed: number;
}

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.OUTBOX_INGEST_URL;
  const secret = process.env.OUTBOX_INGEST_SECRET;
  const sourceSlug = process.env.OUTBOX_SOURCE_SLUG ?? "radaar-csv-import";

  if (!opts.dryRun) {
    if (!url) throw new Error("OUTBOX_INGEST_URL is required (or use --dry-run)");
    if (!secret) throw new Error("OUTBOX_INGEST_SECRET is required (or use --dry-run)");
  }

  const rows = readRows(opts.csvPath);
  const counts: RunCounts = {
    total: rows.length,
    sent: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
  };

  console.log(
    `[import] csv=${opts.csvPath} rows=${rows.length} dry=${opts.dryRun} limit=${opts.limit ?? "∞"} source=${sourceSlug}`
  );

  for (let i = 0; i < rows.length; i++) {
    if (opts.limit !== null && counts.sent + counts.duplicate >= opts.limit) {
      break;
    }
    const built = buildSubmission(rows[i], opts);
    if (!built.ok) {
      counts.skipped++;
      console.log(
        `[import] row=${i + 1} skip: ${built.reason}`
      );
      continue;
    }

    if (opts.dryRun) {
      counts.sent++;
      console.log(
        `[import:dry] row=${i + 1} platform=${built.platform} scheduled=${built.scheduledAt.toISOString()} ref=${built.externalRef} caption_len=${built.caption.length} media=${built.mediaUrls.length}`
      );
      continue;
    }

    try {
      const res = await sendToOutbox({
        outboxUrl: url!,
        sourceSlug,
        hmacSecret: secret!,
        submission: {
          external_ref: built.externalRef,
          platform: built.platform,
          caption: built.caption,
          media_urls: built.mediaUrls,
          links: built.links,
          scheduled_at: built.scheduledAt.toISOString(),
        },
      });
      if (res.ok) {
        counts.sent++;
        console.log(
          `[import] row=${i + 1} ok platform=${built.platform} ref=${built.externalRef} id=${res.id}`
        );
      } else {
        counts.failed++;
        console.error(
          `[import] row=${i + 1} fail status=${res.status} platform=${built.platform} ref=${built.externalRef}`
        );
      }
    } catch (err) {
      counts.failed++;
      const code = err instanceof Error ? err.name : "UnknownError";
      console.error(`[import] row=${i + 1} error err=${code}`);
    }
  }

  console.log(
    `[import] done total=${counts.total} sent=${counts.sent} duplicate=${counts.duplicate} skipped=${counts.skipped} failed=${counts.failed}`
  );

  if (counts.failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(`[import] fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
