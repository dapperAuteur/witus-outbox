import "server-only";

/**
 * Wraps a DB write that touches content-bearing columns
 * (`scheduled_post.caption`, `scheduled_post.media_urls`,
 * `publish_attempt.detail`). Per `plans/00-descriptions.md` §3:
 * Drizzle's default error shape includes the full query parameter
 * array; an unhandled throw leaks captions and media URLs into server
 * logs. This wrapper catches, logs only the error class name plus the
 * caller-supplied correlation IDs, and returns a typed result.
 *
 * Callers should NOT include `caption`, `media_urls`, or any other
 * content-bearing field in the `context` argument — those would leak
 * via the same logger this is meant to protect.
 */
export interface SafeDbContext {
  op: string;
  source?: string;
  scheduledPostId?: string;
  draftId?: string;
}

export type SafeDbResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorName: string };

export async function safeDbWrite<T>(
  ctx: SafeDbContext,
  fn: () => Promise<T>
): Promise<SafeDbResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "UnknownError";
    const fields = [`op=${ctx.op}`, `err=${errorName}`];
    if (ctx.source) fields.push(`source=${ctx.source}`);
    if (ctx.scheduledPostId) fields.push(`scheduled_post_id=${ctx.scheduledPostId}`);
    if (ctx.draftId) fields.push(`draft_id=${ctx.draftId}`);
    console.error("[db-safe] write failed %s", fields.join(" "));
    return { ok: false, errorName };
  }
}
