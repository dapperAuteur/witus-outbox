#!/usr/bin/env tsx
/**
 * Sync social profiles from the active publisher backend (Ocoya at v1) into
 * the local `social_profile` table. Required before the importer can resolve
 * `(publisher_backend, network) → publisher_profile_id` at submit time.
 *
 * The CLI does NOT talk to Ocoya or the DB directly. It POSTs to outbox's
 * /api/admin/sync-profiles endpoint with a Bearer token, and outbox does
 * the work. This keeps the publisher API key off your laptop AND matches
 * the auth model the future Apps Script reconciler will use.
 *
 * Usage:
 *   npm run sync:profiles                       (uses OUTBOX_INGEST_URL host)
 *   npm run sync:profiles -- --url https://outbox.witus.online
 *
 * Required env (.env.local):
 *   APPS_SCRIPT_TOKEN     bearer token (must equal target outbox's value)
 *   OUTBOX_INGEST_URL     used to derive the target host when --url omitted
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

interface SyncResult {
  ok: boolean;
  backend?: string;
  workspacesQueried?: Array<{ name: string; id: string; profilesFound: number }>;
  totalUpserted?: number;
  notConfigured?: boolean;
  error?: string;
}

function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") {
      url = argv[++i] ?? null;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        `Usage: npm run sync:profiles [-- --url <outbox-host>]

Options:
  --url <host>   Outbox base URL (e.g. https://outbox.witus.online).
                 When omitted, derived from OUTBOX_INGEST_URL.

Required env:
  APPS_SCRIPT_TOKEN    bearer token; must equal target outbox's value
  OUTBOX_INGEST_URL    used to derive target when --url omitted
`
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return { url };
}

function deriveTargetUrl(explicit: string | null): string {
  if (explicit) {
    return explicit.replace(/\/+$/, "") + "/api/admin/sync-profiles";
  }
  const ingestUrl = process.env.OUTBOX_INGEST_URL;
  if (!ingestUrl) {
    throw new Error(
      "Either --url or OUTBOX_INGEST_URL must be set so we know which outbox to call"
    );
  }
  // Replace the path with /api/admin/sync-profiles, keep host + scheme.
  const u = new URL(ingestUrl);
  u.pathname = "/api/admin/sync-profiles";
  u.search = "";
  u.hash = "";
  return u.toString();
}

async function run(): Promise<void> {
  const { url } = parseArgs(process.argv.slice(2));
  const target = deriveTargetUrl(url);
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!token) {
    throw new Error("APPS_SCRIPT_TOKEN is required");
  }

  console.log(`[sync] target=${target}`);

  const res = await fetch(target, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  });

  const text = await res.text();
  let body: SyncResult = {} as SyncResult;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }

  if (!res.ok || !body.ok) {
    console.error(
      `[sync] failed status=${res.status} error=${body.error ?? text.slice(0, 200)}`
    );
    process.exit(1);
  }

  if (body.notConfigured) {
    console.warn(
      `[sync] backend=${body.backend} is not configured (no API key in target env). Nothing to do.`
    );
    return;
  }

  console.log(
    `[sync] backend=${body.backend} workspaces=${body.workspacesQueried?.length ?? 0} profiles_upserted=${body.totalUpserted ?? 0}`
  );
  for (const w of body.workspacesQueried ?? []) {
    console.log(
      `[sync]   workspace=${w.name} id=${w.id} profiles_found=${w.profilesFound}`
    );
  }

  if ((body.totalUpserted ?? 0) === 0) {
    console.warn(
      "[sync] 0 profiles upserted. Connect your social accounts in Ocoya first:"
    );
    console.warn(
      "[sync]   https://app.ocoya.com → each workspace → Social profiles → connect each network"
    );
  }
}

run().catch((err) => {
  console.error(`[sync] fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
