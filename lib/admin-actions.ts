import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { publishAttempts, scheduledPosts } from "@/db/schema";
import { sendOutboxAlert } from "@/lib/alerts";
import { resolveProfileIds } from "@/lib/profile-resolver";
import { getPublisher } from "@/lib/publishers";

export interface ActionResult {
  ok: boolean;
  error?: string;
  status?: string;
  publisherPostId?: string | null;
}

const MIN_LEAD_MS = 5 * 60_000;

/**
 * Re-runs the after()-style submit flow for an existing row. Safe to call
 * on rows in `queued`, `error`, or `submitted` (idempotent — doesn't double-
 * insert). Refuses to retry rows that are already terminal (`posted`,
 * `cancelled`).
 */
export async function retryPost(id: string): Promise<ActionResult> {
  const db = getDb();
  const publisher = getPublisher();

  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "posted" || row.status === "cancelled") {
    return { ok: false, error: `cannot_retry_${row.status}` };
  }
  if (row.publisherPostId) {
    return { ok: false, error: "already_submitted" };
  }

  const resolved = await resolveProfileIds({
    publisherBackend: row.publisherBackend,
    workspaceId: row.publisherWorkspaceId,
    network: row.platform,
    rowOverride: row.publisherProfileIdsOverride,
  });

  if (resolved.ids.length === 0 && publisher.isLive) {
    await db
      .update(scheduledPosts)
      .set({
        status: "error",
        publisherErrorDetail: { code: "no_social_profile", http_status: null },
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id));
    await db.insert(publishAttempts).values({
      scheduledPostId: id,
      publisherBackend: publisher.backend,
      ok: false,
      detail: "no_social_profile",
    });
    void sendOutboxAlert({
      origin: "ingest",
      scheduledPostId: id,
      source: row.source,
      platform: row.platform,
      status: "error",
      errorCode: "no_social_profile",
      scheduledAt: row.scheduledAt.toISOString(),
    });
    return { ok: false, error: "no_social_profile", status: "error" };
  }

  const result = await publisher.createPost({
    caption: row.caption,
    mediaUrls: Array.isArray(row.mediaUrls)
      ? row.mediaUrls.filter((v): v is string => typeof v === "string")
      : [],
    socialProfileIds: resolved.ids,
    scheduledAt: row.scheduledAt,
    workspaceId: row.publisherWorkspaceId ?? undefined,
  });

  await db.insert(publishAttempts).values({
    scheduledPostId: id,
    publisherBackend: publisher.backend,
    ok: result.ok,
    httpStatus: result.ok ? 200 : result.status,
    detail: result.ok ? null : result.detail,
    externalId: result.ok ? result.externalId : null,
  });

  if (result.ok) {
    await db
      .update(scheduledPosts)
      .set({
        status: "submitted",
        publisherPostId: result.externalId,
        publisherErrorDetail: null,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id));
    return { ok: true, status: "submitted", publisherPostId: result.externalId };
  }

  if (result.status >= 400 && result.status < 500 && result.status !== 429) {
    await db
      .update(scheduledPosts)
      .set({
        status: "error",
        publisherErrorDetail: { code: result.detail, http_status: result.status },
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id));
    void sendOutboxAlert({
      origin: "ingest",
      scheduledPostId: id,
      source: row.source,
      platform: row.platform,
      status: "error",
      errorCode: result.detail,
      scheduledAt: row.scheduledAt.toISOString(),
    });
    return { ok: false, error: result.detail, status: "error" };
  }

  return {
    ok: false,
    error: `transient_${result.status}: ${result.detail}`,
    status: row.status,
  };
}

/**
 * Promotes a draft row to queued + immediately submits to the publisher
 * (slice 30). Validates the row is `status=draft`, that the supplied
 * `scheduledAt` is at least 5 min in the future, then sets the new
 * scheduled time + status=queued and runs the same submit flow as
 * `retryPost`. Used by the operator's Schedule UI on /outbox/[id] for
 * draft rows arriving from FlyWitUS (and, eventually, the in-outbox
 * composer's "save as draft → schedule later" path).
 */
export async function promoteDraftPost(
  id: string,
  scheduledAt: Date
): Promise<ActionResult> {
  if (scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) {
    return { ok: false, error: "must_be_5min_in_future" };
  }
  const db = getDb();

  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "draft") {
    return { ok: false, error: `cannot_promote_${row.status}` };
  }

  // Flip to queued FIRST so retryPost's "non-terminal + no publisherPostId"
  // guard accepts the row. retryPost owns the submit pipeline (resolver,
  // createPost, attempt logging, alert wiring) — promote shouldn't fork
  // that logic. Update scheduled_at at the same time so the publisher
  // call uses the operator-chosen time, not the placeholder.
  await db
    .update(scheduledPosts)
    .set({ status: "queued", scheduledAt, updatedAt: new Date() })
    .where(eq(scheduledPosts.id, id));

  return retryPost(id);
}

/**
 * Marks a row cancelled, deleting from the publisher's side first if the
 * row has already been submitted there. Idempotent: cancelling an already-
 * cancelled row is a no-op.
 */
export async function cancelPost(id: string): Promise<ActionResult> {
  const db = getDb();
  const publisher = getPublisher();

  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "cancelled") {
    return { ok: true, status: "cancelled" };
  }
  if (row.status === "posted") {
    return { ok: false, error: "cannot_cancel_posted" };
  }

  if (row.publisherPostId) {
    await publisher.deletePost(row.publisherPostId);
  }

  await db
    .update(scheduledPosts)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(scheduledPosts.id, id));

  return { ok: true, status: "cancelled" };
}

/**
 * Updates the row's `scheduled_at`. If the row has been submitted, also
 * PATCHes the publisher (the only field Ocoya allows changing post-submit).
 */
export async function reschedulePost(
  id: string,
  newAt: Date
): Promise<ActionResult> {
  if (newAt.getTime() < Date.now() + MIN_LEAD_MS) {
    return { ok: false, error: "must_be_5min_in_future" };
  }
  const db = getDb();
  const publisher = getPublisher();

  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "cancelled" || row.status === "posted") {
    return { ok: false, error: `cannot_reschedule_${row.status}` };
  }

  if (row.publisherPostId) {
    await publisher.updateScheduledAt(row.publisherPostId, newAt);
  }

  await db
    .update(scheduledPosts)
    .set({ scheduledAt: newAt, updatedAt: new Date() })
    .where(eq(scheduledPosts.id, id));

  return { ok: true, status: row.status, publisherPostId: row.publisherPostId };
}

/**
 * Re-fetches the matching publisher post by externalId and writes its
 * current status back to the local row. Useful between Apps Script ticks
 * for a row the operator wants up-to-date *now*.
 */
export async function reconcileNowPost(id: string): Promise<ActionResult> {
  const db = getDb();
  const publisher = getPublisher();

  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (!row.publisherPostId) {
    return { ok: false, error: "not_yet_submitted" };
  }

  const remote = await publisher.getPost(row.publisherPostId);
  if (!remote) {
    return { ok: false, error: "publisher_returned_nothing" };
  }

  let nextStatus: typeof row.status = row.status;
  if (remote.status === "posted") nextStatus = "posted";
  else if (remote.status === "error") nextStatus = "error";
  else if (remote.status === "scheduled") nextStatus = "scheduled";

  await db
    .update(scheduledPosts)
    .set({
      status: nextStatus,
      postedAt: remote.postedAt,
      publisherErrorDetail:
        remote.status === "error" && remote.errorDetail
          ? { code: remote.errorDetail, http_status: null }
          : null,
      lastPolledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(scheduledPosts.id, id));

  if (
    remote.status === "error" &&
    row.status !== "error" /* fresh transition */
  ) {
    void sendOutboxAlert({
      origin: "reconcile",
      scheduledPostId: id,
      source: row.source,
      platform: row.platform,
      status: "error",
      errorCode: remote.errorDetail ?? "publisher_error",
      externalId: row.publisherPostId,
      scheduledAt: row.scheduledAt.toISOString(),
    });
  }

  return {
    ok: true,
    status: nextStatus,
    publisherPostId: row.publisherPostId,
  };
}

const EDITABLE_STATUSES = new Set([
  "draft",
  "queued",
  "error",
  "cancelled",
]);

export interface EditPostArgs {
  caption?: string;
  mediaUrls?: string[];
}

/**
 * Edits a row's caption and/or mediaUrls (slice 33). Allowed only when
 * the row's status is in EDITABLE_STATUSES — once a post is in the
 * publisher's queue (submitted / scheduled / posted), the publisher owns
 * the content and the local row is frozen. Reschedule is the separate
 * lever for time changes that the publisher CAN honor post-submit.
 *
 * Returns ok=false with cannot_edit_<status> when blocked. Returns
 * not_found when the id doesn't exist.
 */
export async function editPost(
  id: string,
  args: EditPostArgs
): Promise<ActionResult> {
  const db = getDb();
  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };
  if (!EDITABLE_STATUSES.has(row.status)) {
    return { ok: false, error: `cannot_edit_${row.status}` };
  }
  if (args.caption === undefined && args.mediaUrls === undefined) {
    return { ok: false, error: "no_changes" };
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.caption !== undefined) update.caption = args.caption;
  if (args.mediaUrls !== undefined) update.mediaUrls = args.mediaUrls;

  await db
    .update(scheduledPosts)
    .set(update)
    .where(eq(scheduledPosts.id, id));

  return { ok: true, status: row.status };
}

/**
 * Clones a row into a fresh draft (slice 33). Works on any status — even
 * `posted` rows can be copied to "post this again" or "post a variation."
 * The new row carries:
 *   - same caption, mediaUrls, links, platform, publisher_backend,
 *     publisher_workspace_id, publisher_profile_ids_override
 *   - source = original.source (so filtering by source still groups them)
 *   - draft_id = `copy-{shortuuid}-{platform}` so the (source, draft_id)
 *     UNIQUE constraint holds
 *   - status = "draft"
 *   - scheduledAt = now + 7 days (placeholder; operator picks at promote)
 *   - publisher_post_id = null (it's a fresh row; reconciler doesn't
 *     touch the original publisher post)
 *
 * Returns the new row id so the caller can navigate the operator there.
 */
export async function copyPost(
  id: string
): Promise<ActionResult & { newId?: string }> {
  const db = getDb();
  const row = await db.query.scheduledPosts.findFirst({
    where: eq(scheduledPosts.id, id),
  });
  if (!row) return { ok: false, error: "not_found" };

  const newDraftId = `copy-${randomUUID().slice(0, 8)}-${row.platform}`;
  const newScheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);

  const inserted = await db
    .insert(scheduledPosts)
    .values({
      source: row.source,
      draftId: newDraftId,
      platform: row.platform,
      caption: row.caption,
      mediaUrls: row.mediaUrls,
      links: row.links,
      scheduledAt: newScheduledAt,
      status: "draft",
      publisherBackend: row.publisherBackend,
      publisherWorkspaceId: row.publisherWorkspaceId,
      publisherProfileIdsOverride: row.publisherProfileIdsOverride,
    })
    .returning({ id: scheduledPosts.id });

  const newId = inserted[0]?.id;
  if (!newId) {
    return { ok: false, error: "insert_failed" };
  }
  return { ok: true, status: "draft", newId };
}
