import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { getAuthOptions } from "@/lib/auth";
import { createComposedRows } from "@/lib/composer-actions";
import { describeError } from "@/lib/db-safe";
import { PLATFORMS } from "@/lib/publishers/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ComposeSchema = z.object({
  caption: z.string().min(1).max(10_000),
  mediaUrls: z
    .array(z.string().url().regex(/^https:\/\//, "media URLs must be https"))
    .max(20)
    .default([]),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(8),
  scheduledAt: z.string().datetime({ offset: true }),
  asDraft: z.boolean().default(false),
  profileIdsByPlatform: z
    .record(z.enum(PLATFORMS), z.array(z.string().min(1)).max(20))
    .optional(),
});

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
  const parsed = ComposeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await createComposedRows({
      caption: parsed.data.caption,
      mediaUrls: parsed.data.mediaUrls,
      platforms: parsed.data.platforms,
      scheduledAt: new Date(parsed.data.scheduledAt),
      asDraft: parsed.data.asDraft,
      profileIdsByPlatform: parsed.data.profileIdsByPlatform,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/compose] err=%s code=%s",
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
