import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { getAuthOptions } from "@/lib/auth";
import { editPost } from "@/lib/admin-actions";
import { describeError } from "@/lib/db-safe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EditSchema = z.object({
  caption: z.string().min(1).max(10_000).optional(),
  mediaUrls: z
    .array(z.string().url().regex(/^https:\/\//, "media URLs must be https"))
    .max(20)
    .optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = EditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await editPost(id, parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/scheduled-posts/edit] id=%s err=%s code=%s",
      id,
      meta.name,
      meta.code ?? "?"
    );
    return NextResponse.json(
      {
        ok: false,
        error: `${meta.name}${meta.code ? ` (${meta.code})` : ""}`,
        sqlstate: meta.code,
      },
      { status: 503 }
    );
  }
}
