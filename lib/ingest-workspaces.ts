import "server-only";
import { z } from "zod";
import { getEnv } from "./env";

/**
 * Outbox-only sidecar to lib/ingest-sources.ts.
 *
 * lib/ingest-sources.ts is kept byte-for-byte verbatim with witus-inbox per
 * AGENTS.md "do not let diverge" rule. This file reads the same INGEST_SOURCES
 * env var but extracts an outbox-only optional field — `workspace_name` — that
 * maps each publisher slug to a configured Ocoya workspace. Inbox's parser
 * tolerates the extra key (Zod's default loose parsing strips unknowns), so
 * publishers that POST to both receivers can share a single INGEST_SOURCES
 * value per environment without breakage.
 *
 * Resolution chain at submit time:
 *   1. Source slug → workspace_name (this file)
 *   2. workspace_name → workspace id (lib/workspaces.ts)
 *   3. workspace id → Ocoya API call (lib/publishers/ocoya.ts)
 *
 * If a slug has no workspace_name, the publisher falls back to the first
 * configured workspace (lib/workspaces.ts getDefaultWorkspaceId).
 */
const Entry = z
  .object({
    slug: z.string().min(1),
    workspace_name: z.string().min(1).optional(),
  })
  .passthrough();
const Schema = z.array(Entry);

let cached: Map<string, string | null> | null = null;

function load(): Map<string, string | null> {
  if (cached) return cached;
  const raw = getEnv().INGEST_SOURCES;
  const map = new Map<string, string | null>();
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
    map.set(entry.slug, entry.workspace_name ?? null);
  }
  cached = map;
  return cached;
}

export function getSourceWorkspaceName(slug: string): string | null {
  return load().get(slug) ?? null;
}
