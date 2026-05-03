import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OCOYA_BASE = "https://app.ocoya.com/api/_public/v1";

interface OcoyaWorkspace {
  id: string;
  name: string | null;
  raw: Record<string, unknown>;
}

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  if (!env.OCOYA_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "OCOYA_API_KEY is not set in this environment. Set it in Vercel (Production) and redeploy, then retry.",
      },
      { status: 412 }
    );
  }

  let res: Response;
  try {
    res = await fetch(`${OCOYA_BASE}/workspaces`, {
      method: "GET",
      headers: {
        "X-API-Key": env.OCOYA_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    const code = err instanceof Error ? err.name : "UnknownError";
    console.error("[ocoya-workspaces] fetch failed err=%s", code);
    return NextResponse.json(
      { ok: false, error: `Network error: ${code}` },
      { status: 502 }
    );
  }

  if (!res.ok) {
    let detail = `ocoya-${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      detail = body.message ?? body.error ?? detail;
    } catch {
      /* leave default */
    }
    console.error("[ocoya-workspaces] api status=%d", res.status);
    return NextResponse.json(
      { ok: false, error: detail, status: res.status },
      { status: 502 }
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Ocoya returned non-JSON" },
      { status: 502 }
    );
  }

  const list = Array.isArray(body) ? body : [];
  const workspaces: OcoyaWorkspace[] = list
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null
    )
    .map((entry) => {
      const id =
        typeof entry.id === "string" || typeof entry.id === "number"
          ? String(entry.id)
          : null;
      const name =
        typeof entry.name === "string"
          ? entry.name
          : typeof entry.title === "string"
            ? (entry.title as string)
            : null;
      return id ? { id, name, raw: entry } : null;
    })
    .filter((w): w is OcoyaWorkspace => w !== null);

  // Echo the configured OCOYA_WORKSPACE_IDS map so the UI can highlight
  // which workspaces are already wired up.
  const configured: Array<{ name: string; id: string }> = [];
  if (env.OCOYA_WORKSPACE_IDS) {
    try {
      const parsed = JSON.parse(env.OCOYA_WORKSPACE_IDS);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof entry.name === "string" &&
            typeof entry.id === "string"
          ) {
            configured.push({ name: entry.name, id: entry.id });
          }
        }
      }
    } catch {
      /* ignore — env.ts already logs malformed JSON via lib/workspaces */
    }
  }

  return NextResponse.json({
    ok: true,
    workspaces,
    configured,
  });
}
