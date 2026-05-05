import "server-only";
import { z } from "zod";
import { getEnv } from "./env";

/**
 * Outbox-only sidecar to lib/ingest-sources.ts (slice 28).
 *
 * Reads the same INGEST_SOURCES env value and extracts an optional
 * outbox-only field — `publisher_backend` — that lets each source slug
 * pin its posts to a specific publisher backend, regardless of the
 * global `PUBLISHER_BACKEND` env default.
 *
 * Why a sidecar (option B from plans/future/per-source-backend-routing.md):
 * lib/ingest-sources.ts is byte-for-byte verbatim with witus-inbox per
 * AGENTS.md "do not let diverge". Inbox has no publisher concept. Rather
 * than mutate the shared schema, this file defines a passthrough Zod
 * schema (mirrors lib/ingest-workspaces.ts) so extra keys ride along
 * without rejection on either side.
 *
 * Resolution at ingest time (top wins):
 *   1. INGEST_SOURCES[slug].publisher_backend  (this file)
 *   2. process.env.PUBLISHER_BACKEND           (env.ts default)
 *   3. "ocoya"                                  (zod default in env.ts)
 *
 * The ALLOWED_BACKENDS list is the runtime-validating bound — an unknown
 * value (typo, removed adapter) is treated as "no override" and the slug
 * falls through to the env default. We deliberately don't crash the
 * parser on bad values: the operator should see a console.error and
 * fall through, not lose every other slug's config because one slug had
 * a typo.
 */
const ALLOWED_BACKENDS = ["ocoya", "socialchamp"] as const;
type Backend = (typeof ALLOWED_BACKENDS)[number];

const Entry = z
  .object({
    slug: z.string().min(1),
    publisher_backend: z.string().min(1).optional(),
  })
  .passthrough();
const Schema = z.array(Entry);

let cached: Map<string, Backend | null> | null = null;

function load(): Map<string, Backend | null> {
  if (cached) return cached;
  const raw = getEnv().INGEST_SOURCES;
  const map = new Map<string, Backend | null>();
  if (!raw) {
    cached = map;
    return map;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cached = map;
    return map;
  }
  const result = Schema.safeParse(parsed);
  if (!result.success) {
    cached = map;
    return map;
  }
  for (const entry of result.data) {
    const requested = entry.publisher_backend;
    if (!requested) {
      map.set(entry.slug, null);
      continue;
    }
    if (
      ALLOWED_BACKENDS.includes(requested as Backend)
    ) {
      map.set(entry.slug, requested as Backend);
    } else {
      console.error(
        "[ingest-publisher-backends] slug=%s publisher_backend=%s not in ALLOWED_BACKENDS — falling back to env default",
        entry.slug,
        requested
      );
      map.set(entry.slug, null);
    }
  }
  cached = map;
  return cached;
}

/**
 * Returns the per-source backend override for `slug`, or null when the
 * slug is unknown or has no override. Callers fall through to
 * `getEnv().PUBLISHER_BACKEND` on null.
 */
export function getSourcePublisherBackend(slug: string): string | null {
  return load().get(slug) ?? null;
}
