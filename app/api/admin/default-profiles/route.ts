import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { getDb } from "@/db";
import {
  defaultPublisherProfiles,
  socialProfiles,
} from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { describeError } from "@/lib/db-safe";
import { getEnv } from "@/lib/env";
import { listConfiguredWorkspaces } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AvailableProfile {
  publisherProfileId: string;
  network: string;
  displayName: string | null;
}

interface WorkspaceGroup {
  /** Which backend's profiles populate this group. */
  backend: string;
  workspaceId: string;
  /** Operator-chosen symbolic name (Ocoya only — from OCOYA_WORKSPACE_IDS). */
  workspaceName: string | null;
  byNetwork: Record<
    string,
    {
      available: AvailableProfile[];
      defaults: string[];
    }
  >;
}

async function requireSession(): Promise<boolean> {
  const session = await getServerSession(getAuthOptions());
  return Boolean(session?.user?.email);
}

export async function GET(): Promise<NextResponse> {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();

  let profiles: Array<{
    publisherBackend: string;
    publisherProfileId: string;
    network: string;
    displayName: string | null;
    workspaceId: string | null;
  }>;
  let defaults: Array<{
    publisherBackend: string;
    workspaceId: string;
    network: string;
    publisherProfileIds: unknown;
  }>;
  try {
    profiles = await db
      .select({
        publisherBackend: socialProfiles.publisherBackend,
        publisherProfileId: socialProfiles.publisherProfileId,
        network: socialProfiles.network,
        displayName: socialProfiles.displayName,
        workspaceId: socialProfiles.workspaceId,
      })
      .from(socialProfiles)
      .orderBy(
        asc(socialProfiles.publisherBackend),
        asc(socialProfiles.workspaceId),
        asc(socialProfiles.network)
      );

    defaults = await db
      .select({
        publisherBackend: defaultPublisherProfiles.publisherBackend,
        workspaceId: defaultPublisherProfiles.workspaceId,
        network: defaultPublisherProfiles.network,
        publisherProfileIds: defaultPublisherProfiles.publisherProfileIds,
      })
      .from(defaultPublisherProfiles);
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/default-profiles GET] err=%s code=%s",
      meta.name,
      meta.code ?? "?"
    );
    const hint =
      meta.code === "42P01"
        ? "Run `npm run db:push` against this environment's Neon branch — a table is missing."
        : meta.code === "42703"
          ? "Run `npm run db:push` — a column is missing."
          : null;
    return NextResponse.json(
      {
        ok: false,
        error: `${meta.name}${meta.code ? ` (${meta.code})` : ""}`,
        sqlstate: meta.code,
        hint,
      },
      { status: 503 }
    );
  }

  const workspaceNameById = new Map<string, string>();
  for (const w of listConfiguredWorkspaces()) {
    workspaceNameById.set(w.id, w.name);
  }

  const groupKey = (backend: string, workspaceId: string) =>
    `${backend}|${workspaceId}`;

  const groups = new Map<string, WorkspaceGroup>();
  for (const p of profiles) {
    const wsId = p.workspaceId ?? "(no-workspace)";
    const key = groupKey(p.publisherBackend, wsId);
    let group = groups.get(key);
    if (!group) {
      group = {
        backend: p.publisherBackend,
        workspaceId: wsId,
        // Workspace names live in OCOYA_WORKSPACE_IDS so they only resolve
        // for the Ocoya backend. SocialChamp groups show the raw id.
        workspaceName:
          p.publisherBackend === "ocoya"
            ? workspaceNameById.get(wsId) ?? null
            : null,
        byNetwork: {},
      };
      groups.set(key, group);
    }
    if (!group.byNetwork[p.network]) {
      group.byNetwork[p.network] = { available: [], defaults: [] };
    }
    group.byNetwork[p.network].available.push({
      publisherProfileId: p.publisherProfileId,
      network: p.network,
      displayName: p.displayName,
    });
  }
  for (const d of defaults) {
    const group = groups.get(groupKey(d.publisherBackend, d.workspaceId));
    if (!group) continue;
    if (!group.byNetwork[d.network]) {
      group.byNetwork[d.network] = { available: [], defaults: [] };
    }
    const ids = Array.isArray(d.publisherProfileIds)
      ? d.publisherProfileIds.filter((v): v is string => typeof v === "string")
      : [];
    group.byNetwork[d.network].defaults = ids;
  }

  return NextResponse.json({
    ok: true,
    activeBackend: getEnv().PUBLISHER_BACKEND,
    workspaces: Array.from(groups.values()),
  });
}

const PutBody = z.object({
  /** Defaults to the env's active backend when omitted. Required when the
   *  panel shows multiple backends and the operator is editing a non-active
   *  backend's defaults. */
  backend: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  network: z.string().min(1),
  publisherProfileIds: z.array(z.string().min(1)).max(20),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!(await requireSession())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
  const backend = parsed.data.backend ?? getEnv().PUBLISHER_BACKEND;

  try {
    if (parsed.data.publisherProfileIds.length === 0) {
      await db
        .delete(defaultPublisherProfiles)
        .where(
          and(
            eq(defaultPublisherProfiles.publisherBackend, backend),
            eq(defaultPublisherProfiles.workspaceId, parsed.data.workspaceId),
            eq(defaultPublisherProfiles.network, parsed.data.network)
          )
        );
      return NextResponse.json({ ok: true, removed: true });
    }

    await db
      .insert(defaultPublisherProfiles)
      .values({
        publisherBackend: backend,
        workspaceId: parsed.data.workspaceId,
        network: parsed.data.network,
        publisherProfileIds: parsed.data.publisherProfileIds,
      })
      .onConflictDoUpdate({
        target: [
          defaultPublisherProfiles.publisherBackend,
          defaultPublisherProfiles.workspaceId,
          defaultPublisherProfiles.network,
        ],
        set: {
          publisherProfileIds: parsed.data.publisherProfileIds,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      ok: true,
      count: parsed.data.publisherProfileIds.length,
    });
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[admin/default-profiles PUT] err=%s code=%s",
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
