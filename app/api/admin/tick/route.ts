import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { runReconciler } from "@/lib/reconciler";

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
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authorized = bearerOk(req);
  if (!authorized) {
    console.warn("[admin/tick] unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReconciler();
    console.log(
      "[admin/tick] backend=%s profiles_refreshed=%s retried_queued=%d workspaces=%d",
      result.backend,
      result.profilesRefreshed,
      result.retriedQueued,
      result.workspaces.length
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
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[admin/tick] err=%s", code);
    return NextResponse.json(
      { ok: false, error: `tick failed: ${code}` },
      { status: 500 }
    );
  }
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
