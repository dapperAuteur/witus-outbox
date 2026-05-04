import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { publishAttempts, scheduledPosts } from "@/db/schema";
import { sendOutboxAlert } from "@/lib/alerts";
import { safeDbWrite } from "@/lib/db-safe";
import { verifySignature } from "@/lib/hmac";
import { getSourceSecret } from "@/lib/ingest-sources";
import { getSourceWorkspaceName } from "@/lib/ingest-workspaces";
import { resolveProfileIds } from "@/lib/profile-resolver";
import { getPublisher } from "@/lib/publishers";
import { PLATFORMS } from "@/lib/publishers/types";
import { getDefaultWorkspaceId, getWorkspaceIdByName } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCHEDULED_AT_MIN_LEAD_SECONDS = 5 * 60;

const IngestPayload = z.object({
  external_ref: z.string().min(1).max(255),
  platform: z.enum(PLATFORMS),
  caption: z.string().min(1).max(10_000),
  media_urls: z
    .array(z.string().url().regex(/^https:\/\//, "media URLs must be https"))
    .max(20)
    .default([]),
  links: z.array(z.string().url()).max(20).optional(),
  scheduled_at: z
    .string()
    .datetime({ offset: true })
    .refine(
      (v) => {
        const t = Date.parse(v);
        if (Number.isNaN(t)) return false;
        return t >= Date.now() + SCHEDULED_AT_MIN_LEAD_SECONDS * 1000;
      },
      "scheduled_at must be at least 5 minutes in the future"
    ),
});

function reject(status: number): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const source = request.headers.get("x-witus-source");
  const timestamp = request.headers.get("x-witus-timestamp");
  const signatureHeader = request.headers.get("x-witus-signature");

  if (!source || !timestamp || !signatureHeader) {
    return reject(401);
  }

  const secret = getSourceSecret(source);
  if (!secret) {
    console.warn("[ingest] unknown source");
    return reject(401);
  }

  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const rawBody = await request.text();

  if (!verifySignature({ secret, timestamp, rawBody, signature })) {
    console.warn("[ingest] hmac verify failed source=%s", source);
    return reject(401);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    console.warn("[ingest] invalid JSON source=%s", source);
    return reject(400);
  }

  const parsed = IngestPayload.safeParse(json);
  if (!parsed.success) {
    console.warn("[ingest] schema invalid source=%s", source);
    return reject(400);
  }

  const db = getDb();
  const publisher = getPublisher();
  const scheduledAt = new Date(parsed.data.scheduled_at);

  // Per-source workspace routing: each INGEST_SOURCES entry's optional
  // `workspace_name` resolves to an OCOYA_WORKSPACE_IDS entry. If unset,
  // fall back to the first configured workspace.
  const workspaceName = getSourceWorkspaceName(source);
  const workspaceId = workspaceName
    ? getWorkspaceIdByName(workspaceName)
    : getDefaultWorkspaceId();

  if (workspaceName && !workspaceId) {
    console.error(
      "[ingest] source=%s references workspace_name=%s with no matching OCOYA_WORKSPACE_IDS entry",
      source,
      workspaceName
    );
    return reject(500);
  }

  const existing = await db.query.scheduledPosts.findFirst({
    where: and(
      eq(scheduledPosts.source, source),
      eq(scheduledPosts.draftId, parsed.data.external_ref)
    ),
    columns: { id: true, status: true },
  });

  if (existing) {
    console.log(
      "[ingest] duplicate source=%s draft_id=%s id=%s status=%s",
      source,
      parsed.data.external_ref,
      existing.id,
      existing.status
    );
    return NextResponse.json(
      { ok: true, id: existing.id, status: existing.status },
      { status: 200 }
    );
  }

  const insertResult = await safeDbWrite(
    {
      op: "scheduled_post.insert",
      source,
      draftId: parsed.data.external_ref,
    },
    () =>
      db
        .insert(scheduledPosts)
        .values({
          source,
          draftId: parsed.data.external_ref,
          platform: parsed.data.platform,
          caption: parsed.data.caption,
          mediaUrls: parsed.data.media_urls,
          links: parsed.data.links ?? [],
          scheduledAt,
          status: "queued",
          publisherBackend: publisher.backend,
          publisherWorkspaceId: workspaceId,
        })
        .returning({ id: scheduledPosts.id })
  );

  if (!insertResult.ok) {
    return reject(500);
  }
  const id = insertResult.value[0]?.id;
  if (!id) {
    console.error("[ingest] insert returned no id source=%s", source);
    return reject(500);
  }

  console.log(
    "[ingest] accepted source=%s platform=%s id=%s",
    source,
    parsed.data.platform,
    id
  );

  after(() =>
    submitToPublisher({
      id,
      source,
      platform: parsed.data.platform,
      scheduledAt,
      caption: parsed.data.caption,
      mediaUrls: parsed.data.media_urls,
      workspaceId: workspaceId ?? undefined,
    })
  );

  return NextResponse.json(
    { ok: true, id, status: "queued" },
    { status: 200 }
  );
}

interface SubmitArgs {
  id: string;
  source: string;
  platform: string;
  scheduledAt: Date;
  caption: string;
  mediaUrls: string[];
  workspaceId?: string;
}

async function submitToPublisher(args: SubmitArgs): Promise<void> {
  const db = getDb();
  const publisher = getPublisher();

  const resolved = await resolveProfileIds({
    publisherBackend: publisher.backend,
    workspaceId: args.workspaceId ?? null,
    network: args.platform,
  });

  if (resolved.ids.length === 0 && publisher.isLive) {
    await markRowAsError(args.id, "no_social_profile", null);
    await db.insert(publishAttempts).values({
      scheduledPostId: args.id,
      publisherBackend: publisher.backend,
      ok: false,
      detail: "no_social_profile",
    });
    void sendOutboxAlert({
      origin: "ingest",
      scheduledPostId: args.id,
      source: args.source,
      platform: args.platform,
      status: "error",
      errorCode: "no_social_profile",
      scheduledAt: args.scheduledAt.toISOString(),
    });
    return;
  }

  const result = await publisher.createPost({
    caption: args.caption,
    mediaUrls: args.mediaUrls,
    socialProfileIds: resolved.ids,
    scheduledAt: args.scheduledAt,
    workspaceId: args.workspaceId,
  });

  await db.insert(publishAttempts).values({
    scheduledPostId: args.id,
    publisherBackend: publisher.backend,
    ok: result.ok,
    httpStatus: result.ok ? 200 : result.status,
    detail: result.ok ? null : result.detail,
    externalId: result.ok ? result.externalId : null,
  });

  if (result.ok) {
    await db
      .update(scheduledPosts)
      .set({
        status: "submitted",
        publisherPostId: result.externalId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduledPosts.id, args.id));
    console.log(
      "[ingest] submitted id=%s backend=%s external_id=%s",
      args.id,
      publisher.backend,
      result.externalId
    );
    return;
  }

  // 4xx → error. 5xx/network/429 → leave queued for the reconciler retry pass.
  if (result.status >= 400 && result.status < 500 && result.status !== 429) {
    await markRowAsError(args.id, result.detail, result.status);
    void sendOutboxAlert({
      origin: "ingest",
      scheduledPostId: args.id,
      source: args.source,
      platform: args.platform,
      status: "error",
      errorCode: result.detail,
      scheduledAt: args.scheduledAt.toISOString(),
    });
    return;
  }

  console.warn(
    "[ingest] submit transient-failed id=%s status=%d detail=%s",
    args.id,
    result.status,
    result.detail
  );
}

async function markRowAsError(
  id: string,
  errorCode: string,
  httpStatus: number | null
): Promise<void> {
  const db = getDb();
  await db
    .update(scheduledPosts)
    .set({
      status: "error",
      publisherErrorDetail: { code: errorCode, http_status: httpStatus },
      updatedAt: new Date(),
    })
    .where(eq(scheduledPosts.id, id));
}
