import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { retryPost } from "@/lib/admin-actions";
import { safeDbWrite } from "@/lib/db-safe";
import { getEnv } from "@/lib/env";
import { getDefaultWorkspaceId } from "@/lib/workspaces";
import type { Platform } from "@/lib/publishers/types";

/**
 * Source slug stamped on every row the in-outbox composer creates
 * (slice 31). Distinct from any INGEST_SOURCES entry — the composer
 * bypasses HMAC verification (admin-gated, same NextAuth as the rest
 * of /outbox), so no shared secret is needed. The slug is just metadata.
 *
 * Use it to filter: `/outbox?source=outbox-composer`.
 */
export const COMPOSER_SOURCE = "outbox-composer";

export interface ComposeArgs {
  caption: string;
  mediaUrls: string[];
  platforms: readonly Platform[];
  scheduledAt: Date;
  asDraft: boolean;
  /**
   * Optional per-platform profile selection. Map keys must match entries in
   * `platforms`; missing keys / empty arrays mean "no override — fall back
   * to (workspace, network) default at submit time."
   */
  profileIdsByPlatform?: Partial<Record<Platform, string[]>>;
}

export interface ComposeResult {
  ok: boolean;
  rowIds?: string[];
  error?: string;
}

/**
 * Creates one scheduled_post row per selected platform and (when
 * `asDraft=false`) fires the publish pipeline for each via after().
 *
 * Why fan out at the row level rather than at the publisher level: the
 * existing reconciliation, retry, cancel, and per-row profile-override
 * UIs all assume one row per (source, draft_id). Splitting at insert
 * means each platform gets its own status, its own retry budget, and
 * its own audit trail — same shape an external publisher would produce.
 *
 * `draft_id` shape: `composer-{baseUuid}-{platform}` so the (source,
 * draft_id) UNIQUE constraint holds even if the operator rapid-fires
 * the same caption twice (different baseUuid each click).
 */
export async function createComposedRows(
  args: ComposeArgs
): Promise<ComposeResult> {
  if (args.platforms.length === 0) {
    return { ok: false, error: "no_platforms_selected" };
  }
  if (!args.asDraft && args.scheduledAt.getTime() < Date.now() + 5 * 60_000) {
    return { ok: false, error: "must_be_5min_in_future" };
  }

  const db = getDb();
  const baseId = randomUUID().slice(0, 8);
  const status: "draft" | "queued" = args.asDraft ? "draft" : "queued";
  const publisherBackend = getEnv().PUBLISHER_BACKEND;
  const workspaceId = getDefaultWorkspaceId();

  const insertResult = await safeDbWrite(
    {
      op: "scheduled_post.insert",
      source: COMPOSER_SOURCE,
      draftId: `composer-${baseId}-${args.platforms.length}p`,
    },
    () =>
      db
        .insert(scheduledPosts)
        .values(
          args.platforms.map((platform) => {
            const ids = args.profileIdsByPlatform?.[platform];
            return {
              source: COMPOSER_SOURCE,
              draftId: `composer-${baseId}-${platform}`,
              platform,
              caption: args.caption,
              mediaUrls: args.mediaUrls,
              links: [],
              scheduledAt: args.scheduledAt,
              status,
              publisherBackend,
              publisherWorkspaceId: workspaceId,
              publisherProfileIdsOverride:
                ids && ids.length > 0 ? ids : null,
            };
          })
        )
        .returning({ id: scheduledPosts.id })
  );

  if (!insertResult.ok) {
    return { ok: false, error: "insert_failed" };
  }

  const rowIds = insertResult.value.map((r) => r.id);

  // For "submit now" mode, delegate to retryPost via after() so the same
  // resolve → createPost → log → update path the ingest route uses fires
  // here too. Sequenced (not Promise.all) to keep the publisher rate-limit
  // budget linear; 1–8 platforms is small enough that latency is fine.
  if (!args.asDraft) {
    after(async () => {
      for (const id of rowIds) {
        try {
          await retryPost(id);
        } catch (err) {
          const code = err instanceof Error ? err.name : "UnknownError";
          console.error(
            "[composer] submit-now failed id=%s err=%s",
            id,
            code
          );
        }
      }
    });
  }

  console.log(
    "[composer] created rows count=%d status=%s platforms=%s",
    rowIds.length,
    status,
    args.platforms.join(",")
  );

  return { ok: true, rowIds };
}
