import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { tickRuns } from "@/db/schema";
import { describeError, isRetryable, safeDbWrite } from "@/lib/db-safe";
import { getEnv } from "@/lib/env";
import { runReconciler, type ReconcileResult } from "@/lib/reconciler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The reconciler can run for tens of seconds when many rows have flipped.
// Bump the function timeout from the default. Charter §"Cron-free design"
// ratifies that this is the only periodic endpoint outbox exposes.
export const maxDuration = 300;

/**
 * Apps Script reconciler tick. Auth: Authorization: Bearer ${APPS_SCRIPT_TOKEN}.
 *
 * Apps Script (BAM's free Workspace tier) hits this every 15 min. Outbox
 * does the work — pages publisher's POSTED/ERROR list per workspace,
 * updates local rows, fires fresh-error alerts, retries stuck queued rows,
 * and refreshes social_profile cache when stale. The publisher API key
 * never lives in Apps Script's Script Properties — only this bearer
 * token does.
 *
 * Reliability contract (see plans/got-an-error-email-*.md): the ENTIRE body
 * runs inside one try/catch — including the auth/env read — so a failure can
 * never escape as an unlogged Vercel platform 500. Transient connection blips
 * get one retry. Every tick (success or failure) writes a durable `tick_run`
 * row so the outcome survives Hobby's short log retention.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = new Date();
  let attempts = 0;

  try {
    if (!bearerOk(req)) {
      console.warn("[admin/tick] unauthorized");
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // Self-heal transient DB blips (Neon cold-start / connection reset) with a
    // single retry before surfacing a 500.
    let result: ReconcileResult;
    for (;;) {
      attempts++;
      try {
        result = await runReconciler();
        break;
      } catch (err) {
        const meta = describeError(err);
        if (attempts < 2 && isRetryable(err)) {
          console.warn(
            "[admin/tick] retryable err=%s code=%s; retrying",
            meta.name,
            meta.code ?? "?"
          );
          continue;
        }
        throw err;
      }
    }

    console.log(
      "[admin/tick] backend=%s profiles_refreshed=%s retried_queued=%d workspaces=%d attempts=%d",
      result.backend,
      result.profilesRefreshed,
      result.retriedQueued,
      result.workspaces.length,
      attempts
    );
    for (const ws of result.workspaces) {
      if (ws.rowsFlipped > 0 || ws.freshErrorAlerts > 0) {
        console.log(
          "[admin/tick]   ws=%s pages=%d scanned=%d flipped=%d alerts=%d",
          ws.name ?? ws.id,
          ws.pagesScanned,
          ws.rowsScanned,
          ws.rowsFlipped,
          ws.freshErrorAlerts
        );
      }
    }

    await recordTickRun({ startedAt, ok: true, attempts, result });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const meta = describeError(err);
    console.error("[admin/tick] err=%s code=%s", meta.name, meta.code ?? "?");
    await recordTickRun({ startedAt, ok: false, attempts: attempts || 1, error: meta });
    return NextResponse.json(
      {
        ok: false,
        error: `tick failed: ${meta.name}${meta.code ? ` (${meta.code})` : ""}`,
        sqlstate: meta.code,
      },
      { status: 500 }
    );
  }
}

/**
 * Durable record of one tick. Wrapped in safeDbWrite so a logging-table
 * failure can never itself crash the tick (the very bug this guards against).
 * Metadata only — error name/code come from describeError, never message.
 */
async function recordTickRun(args: {
  startedAt: Date;
  ok: boolean;
  attempts: number;
  result?: ReconcileResult;
  error?: { name: string; code: string | null };
}): Promise<void> {
  const { startedAt, ok, attempts, result, error } = args;
  await safeDbWrite({ op: "tick_run.insert" }, async () => {
    const db = getDb();
    await db.insert(tickRuns).values({
      startedAt,
      finishedAt: new Date(),
      ok,
      attempts,
      backend: result?.backend ?? null,
      errorName: error?.name ?? null,
      errorCode: error?.code ?? null,
      workspacesScanned: result?.workspaces.length ?? 0,
      rowsFlipped:
        result?.workspaces.reduce((sum, ws) => sum + ws.rowsFlipped, 0) ?? 0,
      retriedQueued: result?.retriedQueued ?? 0,
      profilesRefreshed: result?.profilesRefreshed ?? false,
    });
  });
}

function bearerOk(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  const expected = getEnv().APPS_SCRIPT_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
