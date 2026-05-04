import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  defaultPublisherProfiles,
  scheduledPosts,
  socialProfiles,
} from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { describeError } from "@/lib/db-safe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AvailableProfile {
  publisherProfileId: string;
  displayName: string | null;
}

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(getAuthOptions());
  return Boolean(session?.user?.email);
}

/**
 * GET /api/admin/scheduled-posts/[id]/profiles
 *
 * Returns the per-row override + the (backend, workspace, network)
 * default + the available profiles the operator can pick from. Powers
 * the RowProfileOverride client component on the detail page.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     row: { id, publisher_backend, publisher_workspace_id, network },
 *     available: [{ publisherProfileId, displayName }],
 *     default: { publisherProfileIds: string[] } | null,
 *     override: string[] | null
 *   }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  const db = getDb();

  try {
    const row = await db.query.scheduledPosts.findFirst({
      where: eq(scheduledPosts.id, id),
      columns: {
        id: true,
        publisherBackend: true,
        publisherWorkspaceId: true,
        platform: true,
        publisherProfileIdsOverride: true,
      },
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const availableWhere = row.publisherWorkspaceId
      ? and(
          eq(socialProfiles.publisherBackend, row.publisherBackend),
          eq(socialProfiles.network, row.platform),
          eq(socialProfiles.workspaceId, row.publisherWorkspaceId)
        )
      : and(
          eq(socialProfiles.publisherBackend, row.publisherBackend),
          eq(socialProfiles.network, row.platform)
        );

    const available: AvailableProfile[] = await db
      .select({
        publisherProfileId: socialProfiles.publisherProfileId,
        displayName: socialProfiles.displayName,
      })
      .from(socialProfiles)
      .where(availableWhere)
      .orderBy(desc(socialProfiles.lastSyncedAt));

    let defaultIds: string[] | null = null;
    if (row.publisherWorkspaceId) {
      const cfg = await db.query.defaultPublisherProfiles.findFirst({
        where: and(
          eq(defaultPublisherProfiles.publisherBackend, row.publisherBackend),
          eq(defaultPublisherProfiles.workspaceId, row.publisherWorkspaceId),
          eq(defaultPublisherProfiles.network, row.platform)
        ),
        columns: { publisherProfileIds: true },
      });
      if (cfg && Array.isArray(cfg.publisherProfileIds)) {
        defaultIds = cfg.publisherProfileIds.filter(
          (v): v is string => typeof v === "string" && v.length > 0
        );
      }
    }

    const override = sanitizeOverride(row.publisherProfileIdsOverride);

    return NextResponse.json({
      ok: true,
      row: {
        id: row.id,
        publisher_backend: row.publisherBackend,
        publisher_workspace_id: row.publisherWorkspaceId,
        network: row.platform,
      },
      available,
      default: defaultIds && defaultIds.length > 0 ? { publisherProfileIds: defaultIds } : null,
      override,
    });
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/scheduled-posts/profiles GET] id=%s err=%s code=%s",
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

const PutBody = z.object({
  /** Pass empty array to clear the override (return to defaults / fallback). */
  publisherProfileIds: z.array(z.string().min(1)).max(20),
});

/**
 * PUT /api/admin/scheduled-posts/[id]/profiles
 *
 * Sets the per-row override. Empty array clears the override.
 * Validates that every requested ID is a real social_profile row for
 * this row's (backend, workspace) — operators can't write through to
 * arbitrary publisher IDs that the cache doesn't know about.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const db = getDb();

  try {
    const row = await db.query.scheduledPosts.findFirst({
      where: eq(scheduledPosts.id, id),
      columns: {
        id: true,
        publisherBackend: true,
        publisherWorkspaceId: true,
        platform: true,
      },
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    if (parsed.data.publisherProfileIds.length === 0) {
      await db
        .update(scheduledPosts)
        .set({
          publisherProfileIdsOverride: null,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, id));
      return NextResponse.json({ ok: true, override: null });
    }

    // Validate every requested ID is a real social_profile row for this
    // row's (backend, workspace). Prevents operators from overriding to
    // an ID the cache doesn't know about (which the publisher would
    // reject anyway).
    const validWhere = row.publisherWorkspaceId
      ? and(
          eq(socialProfiles.publisherBackend, row.publisherBackend),
          eq(socialProfiles.workspaceId, row.publisherWorkspaceId)
        )
      : eq(socialProfiles.publisherBackend, row.publisherBackend);
    const valid = await db
      .select({ publisherProfileId: socialProfiles.publisherProfileId })
      .from(socialProfiles)
      .where(validWhere);
    const validSet = new Set(valid.map((v) => v.publisherProfileId));
    const unknown = parsed.data.publisherProfileIds.filter(
      (id) => !validSet.has(id)
    );
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "unknown_profile_ids",
          unknown,
        },
        { status: 400 }
      );
    }

    await db
      .update(scheduledPosts)
      .set({
        publisherProfileIdsOverride: parsed.data.publisherProfileIds,
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, id));

    return NextResponse.json({
      ok: true,
      override: parsed.data.publisherProfileIds,
    });
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/scheduled-posts/profiles PUT] id=%s err=%s code=%s",
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

function sanitizeOverride(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  return ids.length > 0 ? ids : null;
}
