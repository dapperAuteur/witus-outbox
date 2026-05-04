import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-gated GET that returns the RAW Ocoya social-profiles response for a
 * given workspace ID. Useful when sync ends up with `display_name=null`
 * because Ocoya's actual JSON shape doesn't match the field names
 * `lib/publishers/ocoya.ts pickProfileName` tries. Inspect the response,
 * spot the right field, add it to the candidate list.
 *
 * Usage: /api/admin/ocoya-profile-debug?workspaceId=<id>
 *
 * Returns the JSON unmodified. Admin-only, never publicly cached.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { ok: false, error: "workspaceId query param is required" },
      { status: 400 }
    );
  }

  const env = getEnv();
  if (!env.OCOYA_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "OCOYA_API_KEY is not set in this environment" },
      { status: 412 }
    );
  }

  let res: Response;
  try {
    res = await fetch(
      `https://app.ocoya.com/api/_public/v1/social-profiles?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        headers: {
          "X-API-Key": env.OCOYA_API_KEY,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    return NextResponse.json(
      { ok: false, error: `Network error: ${code}` },
      { status: 502 }
    );
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Ocoya returned non-JSON", raw: text.slice(0, 4000) },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    workspaceId,
    body: parsed,
  });
}
