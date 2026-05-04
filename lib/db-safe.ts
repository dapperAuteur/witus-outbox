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
  | { ok: false; errorName: string; errorCode: string | null };

export async function safeDbWrite<T>(
  ctx: SafeDbContext,
  fn: () => Promise<T>
): Promise<SafeDbResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    const meta = describeError(err);
    const fields = [
      `op=${ctx.op}`,
      `err=${meta.name}`,
      `code=${meta.code ?? "?"}`,
    ];
    if (ctx.source) fields.push(`source=${ctx.source}`);
    if (ctx.scheduledPostId) fields.push(`scheduled_post_id=${ctx.scheduledPostId}`);
    if (ctx.draftId) fields.push(`draft_id=${ctx.draftId}`);
    console.error("[db-safe] write failed %s", fields.join(" "));
    return { ok: false, errorName: meta.name, errorCode: meta.code };
  }
}

export interface ErrorMeta {
  /** The error class name (`NeonDbError`, `Error`, `TypeError`, …). */
  name: string;
  /**
   * Postgres SQLSTATE code when the error came from a DB call. Common values:
   *   - `42P01` undefined_table (run `db:push`)
   *   - `42703` undefined_column (run `db:push`)
   *   - `23505` unique_violation
   *   - `23503` foreign_key_violation
   * `null` when the error isn't from Postgres or doesn't carry a code.
   */
  code: string | null;
}

/**
 * Pulls a {name, code} pair out of any thrown value safely. Drizzle's
 * `NeonDbError` exposes `code` directly; some Drizzle versions wrap the
 * underlying Neon error as `cause` instead. We check both.
 *
 * Crucially: never include `err.message` in the return — Drizzle's default
 * messages embed the SQL text + the parameter array, which can include
 * captions and media URLs. The `name + code` pair is content-free and
 * sufficient to diagnose schema drift, constraint violations, etc.
 */
export function describeError(err: unknown): ErrorMeta {
  if (!(err instanceof Error)) return { name: "UnknownError", code: null };
  const direct = pickCode(err);
  if (direct) return { name: err.name, code: direct };
  // drizzle-orm sometimes wraps the underlying NeonDbError as `cause`.
  const cause = (err as { cause?: unknown }).cause;
  const causeCode = pickCode(cause);
  return { name: err.name, code: causeCode };
}

function pickCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string") return null;
  // SQLSTATE is exactly 5 chars (e.g. "42P01"); guard against arbitrary
  // string codes from non-Postgres errors leaking through.
  if (!/^[0-9A-Z]{5}$/.test(code)) return null;
  return code;
}
