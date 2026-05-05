import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { describeError } from "@/lib/db-safe";
import { exportToRadaarCsv } from "@/lib/radaar-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = [
  "queued",
  "submitted",
  "scheduled",
  "posted",
  "error",
  "cancelled",
] as const;
type RowStatus = (typeof ALLOWED_STATUSES)[number];

const PLATFORMS = [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "tiktok",
  "pinterest",
] as const;

/**
 * GET /api/admin/export-radaar-csv?status=queued,error&platform=facebook
 *
 * Streams a RADAAR-format CSV the operator can upload directly to RADAAR's
 * bulk-import flow. Default filter is `status=queued,error` so the export
 * is naturally the "rows outbox couldn't ship to Ocoya" set; override with
 * `?status=all` or comma-separated explicit values.
 *
 * Filter `?platform=<key>` narrows to one canonical platform key (RADAAR's
 * import has no platform column, so a per-platform CSV is what an operator
 * uploads when they want to schedule to one network at a time).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const statusParam = url.searchParams.get("status");
  const platformParam = url.searchParams.get("platform");
  const sourceParam = url.searchParams.get("source");

  let statuses: readonly RowStatus[] = ["queued", "error"];
  if (statusParam === "all") {
    statuses = ALLOWED_STATUSES;
  } else if (statusParam) {
    const requested = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is RowStatus =>
        ALLOWED_STATUSES.includes(s as RowStatus)
      );
    if (requested.length === 0) {
      return NextResponse.json(
        { ok: false, error: "invalid_status" },
        { status: 400 }
      );
    }
    statuses = requested;
  }

  let platformFilter: string | null = null;
  if (platformParam) {
    if (!PLATFORMS.includes(platformParam as (typeof PLATFORMS)[number])) {
      return NextResponse.json(
        { ok: false, error: "invalid_platform" },
        { status: 400 }
      );
    }
    platformFilter = platformParam;
  }

  const sourceFilter = sourceParam?.trim().slice(0, 100) || null;

  const conditions: SQL[] = [inArray(scheduledPosts.status, statuses)];
  if (platformFilter) {
    conditions.push(eq(scheduledPosts.platform, platformFilter));
  }
  if (sourceFilter) {
    conditions.push(eq(scheduledPosts.source, sourceFilter));
  }

  let rows: Array<{
    source: string;
    draftId: string;
    platform: string;
    caption: string;
    mediaUrls: unknown;
    links: unknown;
    scheduledAt: Date;
    status: string;
  }>;
  try {
    rows = await getDb()
      .select({
        source: scheduledPosts.source,
        draftId: scheduledPosts.draftId,
        platform: scheduledPosts.platform,
        caption: scheduledPosts.caption,
        mediaUrls: scheduledPosts.mediaUrls,
        links: scheduledPosts.links,
        scheduledAt: scheduledPosts.scheduledAt,
        status: scheduledPosts.status,
      })
      .from(scheduledPosts)
      .where(and(...conditions))
      .orderBy(asc(scheduledPosts.scheduledAt));
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/export-radaar-csv] err=%s code=%s",
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

  const csv = exportToRadaarCsv(rows);
  const filename = buildFilename({
    statuses,
    platform: platformFilter,
    source: sourceFilter,
  });

  console.log(
    "[admin/export-radaar-csv] rows=%d statuses=%s platform=%s source=%s filename=%s",
    rows.length,
    statuses.join(","),
    platformFilter ?? "all",
    sourceFilter ?? "all",
    filename
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function buildFilename(args: {
  statuses: readonly RowStatus[];
  platform: string | null;
  source: string | null;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const parts = ["radaar"];
  if (args.source) parts.push(args.source.replace(/[^a-z0-9-]+/gi, "-").slice(0, 30));
  if (args.platform) parts.push(args.platform);
  parts.push(args.statuses.join("+"));
  parts.push(stamp);
  return `${parts.join("_")}.csv`;
}
