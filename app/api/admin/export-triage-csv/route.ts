import { NextResponse, type NextRequest } from "next/server";
import { and, desc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { describeError } from "@/lib/db-safe";
import { parseTriageFilters } from "@/lib/triage-query";
import { exportToTriageCsv, type TriageCsvRow } from "@/lib/triage-csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HARD_CAP = 10_000;

/**
 * GET /api/admin/export-triage-csv?status=&source=&q=
 *
 * Streams a CSV of the same filtered rows visible on /outbox. Distinct from
 * the per-vendor exporters (export-radaar-csv, export-socialchamp-csv) —
 * this is for **operator review**, not vendor-import.
 *
 * No LIMIT 100 cap (the page applies that for render); this is for review,
 * so let the operator pull everything that matches. Hard cap at 10k rows
 * for safety; over → 413 with a "narrow your filters" hint.
 *
 * PII guards live in lib/triage-csv.ts: caption is truncated to 120 chars,
 * media URLs are reduced to a count, publisher_error_detail is summarized
 * to one short field. Charter §3.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const filters = parseTriageFilters({
    status: url.searchParams.get("status"),
    source: url.searchParams.get("source"),
    q: url.searchParams.get("q"),
  });

  let rows: TriageCsvRow[];
  try {
    const baseQuery = getDb()
      .select({
        id: scheduledPosts.id,
        status: scheduledPosts.status,
        scheduledAt: scheduledPosts.scheduledAt,
        platform: scheduledPosts.platform,
        source: scheduledPosts.source,
        publisherBackend: scheduledPosts.publisherBackend,
        publisherPostId: scheduledPosts.publisherPostId,
        caption: scheduledPosts.caption,
        mediaUrls: scheduledPosts.mediaUrls,
        draftId: scheduledPosts.draftId,
        createdAt: scheduledPosts.createdAt,
        lastPolledAt: scheduledPosts.lastPolledAt,
        publisherErrorDetail: scheduledPosts.publisherErrorDetail,
      })
      .from(scheduledPosts)
      .orderBy(desc(scheduledPosts.scheduledAt))
      .limit(HARD_CAP + 1);
    rows =
      filters.conditions.length > 0
        ? await baseQuery.where(and(...filters.conditions))
        : await baseQuery;
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/export-triage-csv] err=%s code=%s",
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

  if (rows.length > HARD_CAP) {
    return NextResponse.json(
      {
        ok: false,
        error: "too_many_rows",
        hint: `Result exceeds ${HARD_CAP} rows. Narrow filters (status / source / q) and retry.`,
        cap: HARD_CAP,
      },
      { status: 413 }
    );
  }

  const csv = exportToTriageCsv(rows);
  const filename = buildFilename(filters);

  console.log(
    "[admin/export-triage-csv] rows=%d status=%s source=%s q_len=%d filename=%s",
    rows.length,
    filters.status ?? "all",
    filters.source ?? "all",
    filters.q?.length ?? 0,
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

function buildFilename(filters: {
  status?: string;
  source?: string;
  q?: string;
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const parts = ["outbox-triage"];
  if (filters.status) parts.push(filters.status);
  if (filters.source) parts.push(slugify(filters.source));
  if (filters.q) parts.push("search");
  parts.push(stamp);
  return `${parts.join("_")}.csv`;
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9-]+/gi, "-").slice(0, 40).replace(/^-+|-+$/g, "");
}
