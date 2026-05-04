import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { defaultPublisherProfiles, socialProfiles } from "@/db/schema";

export interface ResolveArgs {
  publisherBackend: string;
  workspaceId: string | null;
  network: string;
  /**
   * Per-row override IDs (slice 20). Pass `row.publisherProfileIdsOverride`
   * verbatim — the resolver coerces non-array / empty values to "no
   * override" automatically. When non-empty, takes precedence over the
   * (workspace, network) default and the any-match fallback.
   */
  rowOverride?: unknown;
}

export interface ResolvedProfiles {
  /** The publisher's profile IDs to pass into createPost. */
  ids: string[];
  /** How the IDs were chosen. */
  source: "row_override" | "default" | "fallback" | "none";
}

/**
 * Single source of truth for "which publisher_profile_ids does this row
 * target?" — across every backend, every layer.
 *
 * Resolution order (top wins):
 *   1. row.publisherProfileIdsOverride         → "row_override"
 *   2. default_publisher_profile entry         → "default"
 *   3. social_profile any-match (most-recent)  → "fallback"
 *   4. empty                                   → "none"
 *
 * Workspace filter only applies when workspaceId is provided. When omitted
 * (legacy single-workspace setups, future cross-workspace sources), step 2
 * is skipped and step 3 runs without the workspace constraint.
 *
 * Slice 21 will add a higher layer: payload-specified IDs from the ingest
 * request body (option C from plans/future/profile-selection.md). Add it
 * above the row_override branch when that lands.
 */
export async function resolveProfileIds(
  args: ResolveArgs
): Promise<ResolvedProfiles> {
  const override = sanitizeIdArray(args.rowOverride);
  if (override.length > 0) {
    return { ids: override, source: "row_override" };
  }

  const db = getDb();

  if (args.workspaceId) {
    const cfg = await db.query.defaultPublisherProfiles.findFirst({
      where: and(
        eq(defaultPublisherProfiles.publisherBackend, args.publisherBackend),
        eq(defaultPublisherProfiles.workspaceId, args.workspaceId),
        eq(defaultPublisherProfiles.network, args.network)
      ),
      columns: { publisherProfileIds: true },
    });
    if (cfg) {
      const ids = sanitizeIdArray(cfg.publisherProfileIds);
      if (ids.length > 0) {
        return { ids, source: "default" };
      }
    }
  }

  const where = args.workspaceId
    ? and(
        eq(socialProfiles.publisherBackend, args.publisherBackend),
        eq(socialProfiles.network, args.network),
        eq(socialProfiles.workspaceId, args.workspaceId)
      )
    : and(
        eq(socialProfiles.publisherBackend, args.publisherBackend),
        eq(socialProfiles.network, args.network)
      );

  const fallback = await db.query.socialProfiles.findFirst({
    where,
    orderBy: [desc(socialProfiles.lastSyncedAt)],
    columns: { publisherProfileId: true },
  });

  if (fallback) {
    return { ids: [fallback.publisherProfileId], source: "fallback" };
  }
  return { ids: [], source: "none" };
}

/** Coerce arbitrary jsonb shapes to a clean string[]. Drops empties. */
function sanitizeIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
}
