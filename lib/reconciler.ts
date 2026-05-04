import "server-only";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { publishAttempts, scheduledPosts, socialProfiles } from "@/db/schema";
import { sendOutboxAlert } from "@/lib/alerts";
import { retryPost } from "@/lib/admin-actions";
import { getPublisher } from "@/lib/publishers";
import type { PublisherTerminalStatus } from "@/lib/publishers/types";
import { syncSocialProfiles } from "@/lib/sync-profiles";
import { listConfiguredWorkspaces } from "@/lib/workspaces";

const TERMINAL_STATUSES: PublisherTerminalStatus[] = ["posted", "error"];
const PROFILE_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const QUEUED_RETRY_THRESHOLD_MS = 5 * 60 * 1000;
const PAGE_HARD_CAP = 20;

export interface ReconcileResult {
  ok: boolean;
  backend: string;
  profilesRefreshed: boolean;
  workspaces: Array<{
    name: string | null;
    id: string;
    pagesScanned: number;
    rowsScanned: number;
    rowsFlipped: number;
    freshErrorAlerts: number;
  }>;
  retriedQueued: number;
  notConfigured?: boolean;
}

/**
 * Single tick of the reconciler. Called by the Apps Script time trigger
 * every 15 min via /api/admin/tick. Steps:
 *   1. If the most recent social_profile.last_synced_at is older than 24h
 *      (or there are no rows at all), refresh from the publisher.
 *   2. Per configured workspace: page through publisher's POSTED/ERROR
 *      list and update matching local rows. Fire SMS+email alerts on
 *      fresh transitions to error.
 *   3. Optional retry pass: queued rows older than 5 minutes whose
 *      after()-submit must have transient-failed get a retry.
 */
export async function runReconciler(): Promise<ReconcileResult> {
  const publisher = getPublisher();
  const result: ReconcileResult = {
    ok: true,
    backend: publisher.backend,
    profilesRefreshed: false,
    workspaces: [],
    retriedQueued: 0,
  };

  if (!publisher.isLive) {
    result.notConfigured = true;
    return result;
  }

  const db = getDb();

  // Step 1 — refresh social profiles when stale.
  if (await profilesAreStale()) {
    await syncSocialProfiles();
    result.profilesRefreshed = true;
  }

  // Step 2 — page POSTED/ERROR per workspace.
  const workspaces = listConfiguredWorkspaces();
  for (const ws of workspaces) {
    const wsResult = {
      name: ws.name,
      id: ws.id,
      pagesScanned: 0,
      rowsScanned: 0,
      rowsFlipped: 0,
      freshErrorAlerts: 0,
    };

    let page = 0;
    while (page < PAGE_HARD_CAP) {
      const fetched = await publisher.getPostsByStatus(
        TERMINAL_STATUSES,
        page,
        ws.id
      );
      wsResult.pagesScanned++;
      wsResult.rowsScanned += fetched.posts.length;

      if (fetched.posts.length === 0) break;

      const externalIds = fetched.posts.map((p) => p.externalId);
      const localRows = await db
        .select({
          id: scheduledPosts.id,
          status: scheduledPosts.status,
          source: scheduledPosts.source,
          platform: scheduledPosts.platform,
          publisherPostId: scheduledPosts.publisherPostId,
          scheduledAt: scheduledPosts.scheduledAt,
        })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.publisherBackend, publisher.backend),
            inArray(scheduledPosts.publisherPostId, externalIds)
          )
        );

      const localByExternal = new Map<string, (typeof localRows)[number]>();
      for (const row of localRows) {
        if (row.publisherPostId) localByExternal.set(row.publisherPostId, row);
      }

      for (const remote of fetched.posts) {
        const local = localByExternal.get(remote.externalId);
        if (!local) continue;

        let nextStatus: typeof local.status = local.status;
        if (remote.status === "posted") nextStatus = "posted";
        else if (remote.status === "error") nextStatus = "error";

        if (nextStatus === local.status) {
          // No-op flip: just bump last_polled_at so we know the row was seen.
          await db
            .update(scheduledPosts)
            .set({ lastPolledAt: new Date() })
            .where(eq(scheduledPosts.id, local.id));
          continue;
        }

        await db
          .update(scheduledPosts)
          .set({
            status: nextStatus,
            postedAt: remote.postedAt ?? null,
            publisherErrorDetail:
              remote.status === "error" && remote.errorDetail
                ? { code: remote.errorDetail, http_status: null }
                : null,
            lastPolledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(scheduledPosts.id, local.id));

        await db.insert(publishAttempts).values({
          scheduledPostId: local.id,
          publisherBackend: publisher.backend,
          ok: nextStatus === "posted",
          detail:
            nextStatus === "error"
              ? remote.errorDetail ?? "publisher_error"
              : null,
          externalId: remote.externalId,
        });

        wsResult.rowsFlipped++;

        if (nextStatus === "error" && local.status !== "error") {
          void sendOutboxAlert({
            origin: "reconcile",
            scheduledPostId: local.id,
            source: local.source,
            platform: local.platform,
            status: "error",
            errorCode: remote.errorDetail ?? "publisher_error",
            externalId: remote.externalId,
            scheduledAt: local.scheduledAt.toISOString(),
          });
          wsResult.freshErrorAlerts++;
        }
      }

      if (!fetched.hasMore) break;
      page++;
    }
    result.workspaces.push(wsResult);
  }

  // Step 3 — retry queued rows that never got submitted.
  result.retriedQueued = await retryStuckQueued();

  return result;
}

async function profilesAreStale(): Promise<boolean> {
  const db = getDb();
  const oldest = await db.query.socialProfiles.findFirst({
    columns: { lastSyncedAt: true },
    orderBy: [asc(socialProfiles.lastSyncedAt)],
  });
  // No rows at all → first-run case.
  if (!oldest) return true;
  const cutoff = Date.now() - PROFILE_REFRESH_THRESHOLD_MS;
  return oldest.lastSyncedAt.getTime() < cutoff;
}

async function retryStuckQueued(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - QUEUED_RETRY_THRESHOLD_MS);
  const stuck = await db
    .select({ id: scheduledPosts.id })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "queued"),
        isNull(scheduledPosts.publisherPostId),
        or(isNull(scheduledPosts.submittedAt), lt(scheduledPosts.createdAt, cutoff))
      )
    )
    .limit(50);

  let attempted = 0;
  for (const row of stuck) {
    const r = await retryPost(row.id);
    if (r.ok) attempted++;
  }
  return attempted;
}
