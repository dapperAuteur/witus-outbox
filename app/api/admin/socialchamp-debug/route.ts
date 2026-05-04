import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOCIALCHAMP_BASE = "https://api.socialchamp.com";

/**
 * Admin-gated proxy that forwards a GET to SocialChamp's API and returns
 * the verbatim JSON response. The `SOCIAL_CHAMP_API_KEY` lives only in
 * server env; the operator never has to paste it into a curl. Use it to
 * pin down endpoint paths and response shapes for slice 19b
 * (lib/publishers/socialchamp.ts createPost / getPost / etc.).
 *
 * Usage:
 *   GET /api/admin/socialchamp-debug?path=v1/rest/profile
 *   GET /api/admin/socialchamp-debug?path=v1/rest/post/<id>
 *
 * `path` is the portion AFTER api.socialchamp.com/. We prepend the host
 * ourselves so the operator can't accidentally hit a different host.
 *
 * GET-only by design — write methods (POST/DELETE/PATCH) deliberately
 * blocked here. Slice 19b implements those properly inside the adapter
 * once response shapes are known.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json(
      {
        ok: false,
        error: "path query param required",
        examples: [
          "?path=v1/rest/profile",
          "?path=v1/rest/post/<id>",
        ],
      },
      { status: 400 }
    );
  }

  // Disallow control characters, leading slashes, or attempts to escape
  // the base host.
  if (
    path.startsWith("/") ||
    path.startsWith("http") ||
    path.includes("..") ||
    /[\r\n\0]/.test(path)
  ) {
    return NextResponse.json(
      { ok: false, error: "path must be relative under api.socialchamp.com/" },
      { status: 400 }
    );
  }

  const env = getEnv();
  if (!env.SOCIAL_CHAMP_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "SOCIAL_CHAMP_API_KEY missing in this environment" },
      { status: 412 }
    );
  }

  const target = `${SOCIALCHAMP_BASE}/${path}`;
  let res: Response;
  try {
    res = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.SOCIAL_CHAMP_API_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[socialchamp-debug] fetch failed err=%s", code);
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
      {
        ok: res.ok,
        status: res.status,
        path,
        raw: text.slice(0, 8000),
        error: "non-JSON response",
      },
      { status: 200 }
    );
  }

  console.log(
    "[socialchamp-debug] path=%s status=%d",
    path,
    res.status
  );

  return NextResponse.json(
    {
      ok: res.ok,
      status: res.status,
      path,
      body: parsed,
    },
    { status: 200 }
  );
}
