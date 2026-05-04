import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { getAuthOptions } from "@/lib/auth";
import {
  cancelPost,
  reconcileNowPost,
  retryPost,
  type ActionResult,
} from "@/lib/admin-actions";
import { describeError } from "@/lib/db-safe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BulkSchema = z.object({
  action: z.enum(["cancel", "retry", "reconcile"]),
  ids: z.array(z.string().regex(UUID_RE)).min(1).max(100),
});

type Action = z.infer<typeof BulkSchema>["action"];

interface PerRowResult {
  id: string;
  ok: boolean;
  error?: string;
  status?: string;
}

async function runOne(action: Action, id: string): Promise<ActionResult> {
  if (action === "cancel") return cancelPost(id);
  if (action === "retry") return retryPost(id);
  return reconcileNowPost(id);
}

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { action, ids } = parsed.data;
  const seen = new Set<string>();
  const unique = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  const results: PerRowResult[] = [];
  for (const id of unique) {
    try {
      const r = await runOne(action, id);
      results.push({ id, ok: r.ok, error: r.error, status: r.status });
    } catch (err) {
      const meta = describeError(err);
      console.error(
        "[admin/scheduled-posts/bulk] action=%s id=%s err=%s code=%s",
        action,
        id,
        meta.name,
        meta.code ?? "?"
      );
      results.push({
        id,
        ok: false,
        error: `${meta.name}${meta.code ? ` (${meta.code})` : ""}`,
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    action,
    total: results.length,
    ok_count: okCount,
    fail_count: results.length - okCount,
    results,
  });
}
