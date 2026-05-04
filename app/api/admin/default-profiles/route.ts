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
import { getPublisher } from "@/lib/publishers";
import { listConfiguredWorkspaces } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AvailableProfile {
  publisherProfileId: string;
  network: string;
  displayName: string | null;
}

interface WorkspaceGroup {
  workspaceId: string;
  /** Operator-chosen symbolic name from OCOYA_WORKSPACE_IDS, when known. */
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
  const publisher = getPublisher();

  let profiles: Array<{
    publisherProfileId: string;
    network: string;
    displayName: string | null;
    workspaceId: string | null;
  }>;
  let defaults: Array<{
    workspaceId: string;
    network: string;
    publisherProfileIds: unknown;
  }>;
  try {
    profiles = await db
      .select({
        publisherProfileId: socialProfiles.publisherProfileId,
        network: socialProfiles.network,
        displayName: socialProfiles.displayName,
        workspaceId: socialProfiles.workspaceId,
      })
      .from(socialProfiles)
      .where(eq(socialProfiles.publisherBackend, publisher.backend))
      .orderBy(asc(socialProfiles.workspaceId), asc(socialProfiles.network));

    defaults = await db
      .select({
        workspaceId: defaultPublisherProfiles.workspaceId,
        network: defaultPublisherProfiles.network,
        publisherProfileIds: defaultPublisherProfiles.publisherProfileIds,
      })
      .from(defaultPublisherProfiles)
      .where(eq(defaultPublisherProfiles.publisherBackend, publisher.backend));
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

  const groups = new Map<string, WorkspaceGroup>();
  for (const p of profiles) {
    const wsId = p.workspaceId ?? "(no-workspace)";
    let group = groups.get(wsId);
    if (!group) {
      group = {
        workspaceId: wsId,
        workspaceName: workspaceNameById.get(wsId) ?? null,
        byNetwork: {},
      };
      groups.set(wsId, group);
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
    const group = groups.get(d.workspaceId);
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
    backend: publisher.backend,
    workspaces: Array.from(groups.values()),
  });
}

const PutBody = z.object({
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
  const publisher = getPublisher();

  try {
    if (parsed.data.publisherProfileIds.length === 0) {
      await db
        .delete(defaultPublisherProfiles)
        .where(
          and(
            eq(defaultPublisherProfiles.publisherBackend, publisher.backend),
            eq(defaultPublisherProfiles.workspaceId, parsed.data.workspaceId),
            eq(defaultPublisherProfiles.network, parsed.data.network)
          )
        );
      return NextResponse.json({ ok: true, removed: true });
    }

    await db
      .insert(defaultPublisherProfiles)
      .values({
        publisherBackend: publisher.backend,
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
