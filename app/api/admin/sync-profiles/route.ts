import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { syncSocialProfiles } from "@/lib/sync-profiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Auth: either NextAuth admin session (UI button) OR
 * `Authorization: Bearer ${APPS_SCRIPT_TOKEN}` (CLI / future Apps Script).
 * Both routes are accepted because this endpoint is a one-job tool that
 * the operator triggers manually now and the reconciler will trigger
 * automatically later.
 */
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

async function sessionOk(): Promise<boolean> {
  const session = await getServerSession(getAuthOptions());
  return Boolean(session?.user?.email);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authorized = bearerOk(req) || (await sessionOk());
  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncSocialProfiles();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[admin/sync-profiles] err=%s", code);
    return NextResponse.json(
      { ok: false, error: `sync failed: ${code}` },
      { status: 500 }
    );
  }
}
