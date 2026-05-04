import "server-only";
import { getDb } from "@/db";
import { socialProfiles } from "@/db/schema";
import { listConfiguredAdapters } from "@/lib/publishers";

export interface SyncProfilesResult {
  ok: boolean;
  /** One entry per configured backend the sync ran against. */
  backends: Array<{
    backend: string;
    profilesUpserted: number;
    workspaces: Array<{ workspaceId: string | null; profilesFound: number }>;
  }>;
  /** Total profiles upserted across all backends. */
  totalUpserted: number;
  /** True when no backend is configured at all (every adapter's isLive=false). */
  notConfigured?: boolean;
}

/**
 * Pulls profiles from EVERY configured publisher backend and upserts them
 * into `social_profile`. The `publisher_backend` column already
 * differentiates rows from different vendors, so the upsert is safe
 * across backends — Ocoya and SocialChamp profiles coexist without
 * collision (UNIQUE constraint is on `(publisher_backend,
 * publisher_profile_id)`).
 *
 * Each adapter encapsulates its own iteration via syncAllProfiles():
 *   - Ocoya iterates configured workspaces.
 *   - SocialChamp returns its full tenant in one call.
 *
 * Stale rows (profiles disconnected in the publisher dashboard) are not
 * pruned here — their `last_synced_at` simply ages. Cleanup deferred.
 */
export async function syncSocialProfiles(): Promise<SyncProfilesResult> {
  const adapters = listConfiguredAdapters();
  const result: SyncProfilesResult = {
    ok: true,
    backends: [],
    totalUpserted: 0,
  };

  if (adapters.length === 0) {
    result.notConfigured = true;
    return result;
  }

  const db = getDb();

  for (const adapter of adapters) {
    const profiles = await adapter.syncAllProfiles();
    const byWorkspace = new Map<string | null, number>();
    let upserted = 0;

    for (const p of profiles) {
      await db
        .insert(socialProfiles)
        .values({
          publisherBackend: adapter.backend,
          publisherProfileId: p.publisherProfileId,
          network: p.network,
          displayName: p.displayName,
          workspaceId: p.workspaceId,
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            socialProfiles.publisherBackend,
            socialProfiles.publisherProfileId,
          ],
          set: {
            network: p.network,
            displayName: p.displayName,
            workspaceId: p.workspaceId,
            lastSyncedAt: new Date(),
          },
        });
      upserted++;
      byWorkspace.set(
        p.workspaceId,
        (byWorkspace.get(p.workspaceId) ?? 0) + 1
      );
    }

    result.backends.push({
      backend: adapter.backend,
      profilesUpserted: upserted,
      workspaces: Array.from(byWorkspace.entries()).map(([workspaceId, count]) => ({
        workspaceId,
        profilesFound: count,
      })),
    });
    result.totalUpserted += upserted;
  }

  return result;
}
