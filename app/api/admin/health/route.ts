import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { tickRuns } from "@/db/schema";
import { describeError } from "@/lib/db-safe";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Apps Script ticks every ~15 min. Allow 2× + buffer before calling the
// reconciler stale, so a single missed tick doesn't trip the alarm.
const STALE_AFTER_MS = 35 * 60 * 1000;

/**
 * Durable health read for the reconciler, backed by the `tick_run` table.
 * Answers "did the last tick run, and what last broke?" without depending on
 * Vercel Hobby's short-lived runtime logs. Same bearer auth as /api/admin/tick.
 *
 * 200 when the most recent tick succeeded and is recent; 503 when there are
 * no runs, the last run errored, or the last run is older than STALE_AFTER_MS.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if (!bearerOk(req)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const db = getDb();
    const [latest] = await db
      .select({
        startedAt: tickRuns.startedAt,
        finishedAt: tickRuns.finishedAt,
        ok: tickRuns.ok,
        errorName: tickRuns.errorName,
        errorCode: tickRuns.errorCode,
      })
      .from(tickRuns)
      .orderBy(desc(tickRuns.startedAt))
      .limit(1);

    if (!latest) {
      return NextResponse.json(
        { ok: false, healthy: false, reason: "no_runs", lastRunAt: null },
        { status: 503 }
      );
    }

    const ageMs = Date.now() - latest.startedAt.getTime();
    const stale = ageMs > STALE_AFTER_MS;
    const healthy = latest.ok && !stale;

    return NextResponse.json(
      {
        ok: true,
        healthy,
        lastRunAt: latest.startedAt.toISOString(),
        lastRunOk: latest.ok,
        ageSeconds: Math.round(ageMs / 1000),
        stale,
        errorName: latest.errorName,
        errorCode: latest.errorCode,
      },
      { status: healthy ? 200 : 503 }
    );
  } catch (err) {
    const meta = describeError(err);
    console.error("[admin/health] err=%s code=%s", meta.name, meta.code ?? "?");
    return NextResponse.json(
      { ok: false, error: `health check failed: ${meta.name}`, sqlstate: meta.code },
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
