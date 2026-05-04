import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { defaultPublisherProfiles, socialProfiles } from "@/db/schema";

export interface ResolveArgs {
  publisherBackend: string;
  workspaceId: string | null;
  network: string;
}

export interface ResolvedProfiles {
  /** The publisher's profile IDs to pass into createPost. */
  ids: string[];
  /** How the IDs were chosen: "default" = operator-configured, "fallback" = any-match by lastSyncedAt, "none" = nothing matched. */
  source: "default" | "fallback" | "none";
}

/**
 * Single source of truth for "which publisher_profile_ids does this row target?"
 *
 * Resolution order:
 *   1. default_publisher_profile entry for (backend, workspace, network)
 *      → fan out to every ID in that entry's array.
 *   2. Any matching social_profile rows (most-recently-synced first)
 *      → pick exactly one.
 *   3. Empty.
 *
 * Workspace filter only applies when workspaceId is provided. When omitted
 * (legacy single-workspace setups, future cross-workspace sources), step 1
 * is skipped and step 2 runs without the workspace constraint.
 */
export async function resolveProfileIds(
  args: ResolveArgs
): Promise<ResolvedProfiles> {
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
    if (cfg && Array.isArray(cfg.publisherProfileIds)) {
      const ids = cfg.publisherProfileIds.filter(
        (v): v is string => typeof v === "string" && v.length > 0
      );
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
