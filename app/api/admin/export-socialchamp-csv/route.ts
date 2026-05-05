import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, inArray, ne, type SQL } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { describeError } from "@/lib/db-safe";
import {
  exportToSocialChampUniversalCsv,
  exportToSocialChampYouTubeCsv,
} from "@/lib/socialchamp-csv";

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

/**
 * GET /api/admin/export-socialchamp-csv?format=universal|youtube&status=queued,error
 *
 * SocialChamp ships TWO bulk-uploader templates: universal (covers every
 * network EXCEPT YouTube) and youtube (YT-only with VIDEO/SHORTS distinction
 * + per-channel privacy/category/license columns).
 *
 *   ?format=universal   → emits non-YT rows in the universal template.
 *                         Defaults to filtering OUT platform=youtube so
 *                         YT rows aren't lost in a wrong-shape upload.
 *   ?format=youtube     → emits ONLY platform=youtube rows in the YT
 *                         template. Defaults to VIDEO post type;
 *                         operator can re-edit per-row in SC's UI to
 *                         flip to SHORTS.
 *
 * `?status=` matches export-radaar-csv: defaults to queued,error.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const format = url.searchParams.get("format");
  if (format !== "universal" && format !== "youtube") {
    return NextResponse.json(
      {
        ok: false,
        error: "format query param must be 'universal' or 'youtube'",
      },
      { status: 400 }
    );
  }

  const statusParam = url.searchParams.get("status");
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

  const sourceParam = url.searchParams.get("source");
  const sourceFilter = sourceParam?.trim().slice(0, 100) || null;

  const conditions: SQL[] = [inArray(scheduledPosts.status, statuses)];
  if (format === "youtube") {
    conditions.push(eq(scheduledPosts.platform, "youtube"));
  } else {
    conditions.push(ne(scheduledPosts.platform, "youtube"));
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
      "[admin/export-socialchamp-csv] err=%s code=%s",
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

  const csv =
    format === "youtube"
      ? exportToSocialChampYouTubeCsv(rows)
      : exportToSocialChampUniversalCsv(rows);
  const filename = buildFilename({ format, statuses, source: sourceFilter });

  console.log(
    "[admin/export-socialchamp-csv] format=%s rows=%d statuses=%s source=%s filename=%s",
    format,
    rows.length,
    statuses.join(","),
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
  format: "universal" | "youtube";
  statuses: readonly RowStatus[];
  source: string | null;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const parts = ["socialchamp", args.format];
  if (args.source) parts.push(args.source.replace(/[^a-z0-9-]+/gi, "-").slice(0, 30));
  parts.push(args.statuses.join("+"));
  parts.push(stamp);
  return `${parts.join("_")}.csv`;
}
