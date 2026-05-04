import "server-only";
import { getDb } from "@/db";
import { socialProfiles } from "@/db/schema";
import { getPublisher } from "@/lib/publishers";
import { listConfiguredWorkspaces } from "@/lib/workspaces";

export interface SyncProfilesResult {
  ok: boolean;
  backend: string;
  workspacesQueried: Array<{ name: string; id: string; profilesFound: number }>;
  totalUpserted: number;
  /** Set when the publisher isn't configured (no API key) — sync would be a no-op. */
  notConfigured?: boolean;
}

/**
 * Fetches social profiles from the active publisher backend (Ocoya at v1)
 * for every configured workspace and upserts them into the `social_profile`
 * table. Idempotent: rerunning is safe; updates `last_synced_at`.
 *
 * Stale rows (profiles that were disconnected in the publisher dashboard)
 * are not pruned — their `last_synced_at` simply ages. Cleanup is a future
 * concern; for v1 this is acceptable because new posts use the most recently
 * synced profile per (publisher_backend, network).
 */
export async function syncSocialProfiles(): Promise<SyncProfilesResult> {
  const publisher = getPublisher();
  const workspaces = listConfiguredWorkspaces();
  const result: SyncProfilesResult = {
    ok: true,
    backend: publisher.backend,
    workspacesQueried: [],
    totalUpserted: 0,
  };

  if (!publisher.isLive) {
    result.notConfigured = true;
    return result;
  }
  if (workspaces.length === 0) {
    return result;
  }

  const db = getDb();

  for (const ws of workspaces) {
    const profiles = await publisher.listProfiles(ws.id);
    result.workspacesQueried.push({
      name: ws.name,
      id: ws.id,
      profilesFound: profiles.length,
    });
    if (profiles.length === 0) continue;

    for (const p of profiles) {
      await db
        .insert(socialProfiles)
        .values({
          publisherBackend: publisher.backend,
          publisherProfileId: p.publisherProfileId,
          network: p.network,
          displayName: p.displayName,
          workspaceId: ws.id,
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
            workspaceId: ws.id,
            lastSyncedAt: new Date(),
          },
        });
      result.totalUpserted++;
    }
  }

  return result;
}
