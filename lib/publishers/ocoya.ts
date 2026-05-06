import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import {
  getDefaultWorkspaceId,
  listConfiguredWorkspaces,
} from "@/lib/workspaces";
import type {
  CreatePostResult,
  PostInput,
  PublisherAdapter,
  PublisherPostStatus,
  PublisherSocialProfile,
  PublisherTerminalStatus,
} from "./types";

// Ocoya API. Auth: X-API-Key header. Base URL + endpoints from
// https://docs.ocoya.com/. 60 req/min rate limit per key.
const OCOYA_BASE = "https://app.ocoya.com/api/_public/v1";

interface OcoyaContext {
  apiKey: string;
  workspaceId: string;
}

/**
 * Resolve the credentials + workspace for a single call. Workspace lookup
 * order: explicit `workspaceId` arg → first configured `OCOYA_WORKSPACE_IDS`
 * entry → null (triggers dev-log or production-guard).
 */
function getContext(workspaceId?: string): OcoyaContext | null {
  const env = getEnv();
  if (!env.OCOYA_API_KEY) return null;
  const ws = workspaceId ?? getDefaultWorkspaceId();
  if (!ws) return null;
  return { apiKey: env.OCOYA_API_KEY, workspaceId: ws };
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function devLogId(): string {
  return `dev-log-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

interface OcoyaErrorBody {
  message?: string;
  error?: string;
  code?: string;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as OcoyaErrorBody;
    return body.message ?? body.error ?? body.code ?? `ocoya-${res.status}`;
  } catch {
    return `ocoya-${res.status}`;
  }
}

async function ocoyaFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${OCOYA_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

const adapter: PublisherAdapter = {
  backend: "ocoya",

  get isLive() {
    return Boolean(getEnv().OCOYA_API_KEY) && getDefaultWorkspaceId() !== null;
  },

  async listProfiles(workspaceId?: string): Promise<PublisherSocialProfile[]> {
    const ctx = getContext(workspaceId);
    if (!ctx) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to list profiles: OCOYA_API_KEY/OCOYA_WORKSPACE_IDS missing in production"
        );
        return [];
      }
      console.warn("[ocoya] credentials missing; dev-log fallback for listProfiles");
      return [];
    }
    const res = await ocoyaFetch(
      ctx.apiKey,
      `/social-profiles?workspaceId=${encodeURIComponent(ctx.workspaceId)}`
    );
    if (!res.ok) {
      // Read the error detail so the operator can tell apart 401/403 (bad key)
      // from 5xx (Ocoya outage) from 404 (workspace doesn't exist) etc.
      // Same pattern createPost uses; previously listProfiles swallowed the
      // body and dropped the diagnostic on the floor.
      const detail = await readErrorDetail(res);
      console.error(
        "[ocoya] listProfiles status=%d workspace=%s detail=%s",
        res.status,
        ctx.workspaceId,
        detail
      );
      return [];
    }
    const body = (await res.json()) as Array<Record<string, unknown>>;
    return body
      .map((p) => {
        const idRaw = p.id;
        if (typeof idRaw !== "string" && typeof idRaw !== "number") return null;
        const network = pickNetworkField(p);
        const workspaceIdRaw = p.workspaceId;
        return {
          publisherProfileId: String(idRaw),
          network: normalizeOcoyaNetwork(network),
          displayName: pickProfileName(p),
          workspaceId:
            typeof workspaceIdRaw === "string" || typeof workspaceIdRaw === "number"
              ? String(workspaceIdRaw)
              : null,
        };
      })
      .filter((p): p is PublisherSocialProfile => p !== null);
  },

  /**
   * Iterates every configured Ocoya workspace and concatenates results.
   * The workspace_id field on each returned profile reflects the workspace
   * the call was scoped to, so the sync-profiles upserter can land each
   * profile under its correct workspace.
   */
  async syncAllProfiles(): Promise<PublisherSocialProfile[]> {
    const workspaces = listConfiguredWorkspaces();
    if (workspaces.length === 0) return [];
    const all: PublisherSocialProfile[] = [];
    for (const ws of workspaces) {
      const profiles = await this.listProfiles(ws.id);
      // Force the workspace_id we asked about onto each profile — Ocoya's
      // /social-profiles response sometimes omits it, but we know it
      // because we just queried for it.
      for (const p of profiles) {
        all.push({ ...p, workspaceId: p.workspaceId ?? ws.id });
      }
    }
    return all;
  },

  async createPost(input: PostInput): Promise<CreatePostResult> {
    const ctx = getContext(input.workspaceId);
    if (!ctx) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to create post: OCOYA_API_KEY/OCOYA_WORKSPACE_IDS missing in production"
        );
        return {
          ok: false,
          status: 0,
          detail: "ocoya creds missing in production",
        };
      }
      const id = devLogId();
      console.warn("[ocoya] credentials missing; dev-log fallback for createPost");
      console.log("[ocoya:dev]", {
        externalId: id,
        captionLength: input.caption.length,
        mediaCount: input.mediaUrls.length,
        socialProfileCount: input.socialProfileIds.length,
        workspaceId: input.workspaceId ?? null,
        scheduledAt: input.scheduledAt.toISOString(),
      });
      return { ok: true, externalId: id };
    }

    const res = await ocoyaFetch(
      ctx.apiKey,
      `/post?workspaceId=${encodeURIComponent(ctx.workspaceId)}`,
      {
        method: "POST",
        body: JSON.stringify({
          caption: input.caption,
          mediaUrls: input.mediaUrls,
          socialProfileIds: input.socialProfileIds,
          scheduledAt: input.scheduledAt.toISOString(),
        }),
      }
    );

    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const id = extractCreatePostId(body, res.headers.get("location"));
      if (!id) {
        // Log the response shape (keys only — body values may echo caption /
        // media which is PII per charter §3) so we can adjust the extractor
        // without round-tripping through BAM. The 201 means Ocoya created
        // the post; we just couldn't find the id where we looked. This is
        // correctness-critical because without the id the reconciler can't
        // poll for status, and a retry would create a duplicate.
        console.error(
          "[ocoya] createPost succeeded (status=%d) but id not extractable; bodyKeys=%s locationHeader=%s",
          res.status,
          JSON.stringify(Object.keys(body)),
          res.headers.get("location") ?? "(none)"
        );
        return { ok: false, status: res.status, detail: "ocoya-no-id-in-response" };
      }
      return { ok: true, externalId: id };
    }

    const detail = await readErrorDetail(res);
    return { ok: false, status: res.status, detail };
  },

  async getPost(externalId: string): Promise<PublisherPostStatus | null> {
    const env = getEnv();
    if (!env.OCOYA_API_KEY) return null;
    const res = await ocoyaFetch(
      env.OCOYA_API_KEY,
      `/post/${encodeURIComponent(externalId)}`
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      id?: string | number;
      status?: string;
      error?: string;
      postedAt?: string;
    };
    return mapOcoyaPost(body);
  },

  async getPostsByStatus(
    statuses,
    page,
    workspaceId?: string
  ): Promise<{ posts: PublisherPostStatus[]; hasMore: boolean }> {
    const ctx = getContext(workspaceId);
    if (!ctx) return { posts: [], hasMore: false };
    const ocoyaStatuses = statuses.map((s) => s.toUpperCase()).join(",");
    const res = await ocoyaFetch(
      ctx.apiKey,
      `/post?statuses=${encodeURIComponent(ocoyaStatuses)}&perPage=50&page=${page}&workspaceId=${encodeURIComponent(ctx.workspaceId)}`
    );
    if (!res.ok) return { posts: [], hasMore: false };
    const body = (await res.json()) as {
      data?: Array<{
        id?: string | number;
        status?: string;
        error?: string;
        postedAt?: string;
      }>;
      hasMore?: boolean;
    };
    const posts = (body.data ?? [])
      .map(mapOcoyaPost)
      .filter((p): p is PublisherPostStatus => p !== null);
    return { posts, hasMore: body.hasMore ?? false };
  },

  async updateScheduledAt(externalId, scheduledAt): Promise<void> {
    const env = getEnv();
    if (!env.OCOYA_API_KEY) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to update post: credentials missing in production"
        );
        return;
      }
      console.warn(
        "[ocoya] credentials missing; dev-log fallback for updateScheduledAt"
      );
      console.log("[ocoya:dev] updateScheduledAt", {
        externalId,
        scheduledAt: scheduledAt.toISOString(),
      });
      return;
    }
    const res = await ocoyaFetch(
      env.OCOYA_API_KEY,
      `/post/${encodeURIComponent(externalId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
      }
    );
    if (!res.ok) {
      console.error(
        "[ocoya] updateScheduledAt failed externalId=%s status=%d",
        externalId,
        res.status
      );
    }
  },

  async deletePost(externalId): Promise<void> {
    const env = getEnv();
    if (!env.OCOYA_API_KEY) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to delete post: credentials missing in production"
        );
        return;
      }
      console.warn("[ocoya] credentials missing; dev-log fallback for deletePost");
      console.log("[ocoya:dev] deletePost", { externalId });
      return;
    }
    const res = await ocoyaFetch(
      env.OCOYA_API_KEY,
      `/post/${encodeURIComponent(externalId)}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      console.error(
        "[ocoya] deletePost failed externalId=%s status=%d",
        externalId,
        res.status
      );
    }
  },
};

/**
 * Pulls the network identifier out of an Ocoya social-profile entry.
 * Ocoya's actual response uses `provider` (verified via
 * /api/admin/ocoya-profile-debug 2026-05-04). Older docs and other
 * adapters may use `network`, `platform`, etc. — we try the common
 * shapes in order so the cache populates correctly regardless. The
 * value still flows through normalizeOcoyaNetwork() before storage.
 */
function pickNetworkField(p: Record<string, unknown>): string | null {
  const candidates = ["provider", "network", "platform", "service", "type"];
  for (const k of candidates) {
    const v = p[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Pulls a human-readable display name out of an Ocoya social-profile
 * entry. The exact field name isn't pinned in the published docs —
 * different network types may use `displayName`, `name`, `username`,
 * `handle`, or a nested `account.name`. We try the most common shapes
 * in order and fall back to null (which surfaces as "(unnamed)" in the
 * UI). When that happens, use the /api/admin/ocoya-profile-debug
 * endpoint to inspect the actual response shape and add the missing
 * field below.
 */
function pickProfileName(p: Record<string, unknown>): string | null {
  const flat = [
    "displayName",
    "display_name",
    "name",
    "title",
    "username",
    "handle",
    "screenName",
    "screen_name",
    "label",
    "profileName",
    "profile_name",
  ];
  for (const k of flat) {
    const v = p[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Nested account / profile objects.
  for (const wrapper of ["account", "profile", "user"]) {
    const inner = p[wrapper];
    if (inner && typeof inner === "object") {
      const innerObj = inner as Record<string, unknown>;
      for (const k of flat) {
        const v = innerObj[k];
        if (typeof v === "string" && v.length > 0) return v;
      }
    }
  }
  return null;
}

/**
 * Maps whatever Ocoya returns in the `network` field to the canonical
 * lowercase platform key the rest of outbox uses (matches the Platform
 * type in lib/publishers/types.ts and the `platform` column on
 * scheduled_post). Without this, profile lookups fail because the
 * cached `network` column ends up uppercase or otherwise non-canonical.
 */
function normalizeOcoyaNetwork(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  switch (lower) {
    case "twitter":
    case "x":
    case "twitter_x":
      return "twitter";
    case "facebook":
    case "facebook_page":
    case "facebook_group":
    case "facebook_business":
      return "facebook";
    case "instagram":
    case "instagram_business":
    case "instagram_personal":
      return "instagram";
    case "linkedin":
    case "linkedin_company":
    case "linkedin_personal":
    case "linkedin_business":
      return "linkedin";
    case "youtube":
    case "youtube_channel":
      return "youtube";
    case "bluesky":
    case "blue_sky":
    case "bsky":
      return "bluesky";
    case "tiktok":
    case "tik_tok":
      return "tiktok";
    case "pinterest":
    case "pin":
      return "pinterest";
    default:
      return lower;
  }
}

function mapOcoyaPost(body: {
  id?: string | number;
  status?: string;
  error?: string;
  postedAt?: string;
}): PublisherPostStatus | null {
  if (body.id == null) return null;
  const ocoyaStatus = (body.status ?? "").toUpperCase();
  let status: PublisherPostStatus["status"];
  switch (ocoyaStatus) {
    case "POSTED":
      status = "posted";
      break;
    case "ERROR":
      status = "error";
      break;
    case "SCHEDULED":
      status = "scheduled";
      break;
    case "DRAFT":
      status = "draft";
      break;
    case "PENDING_APPROVAL":
    case "PENDING_USER_APPROVAL":
    case "PENDING_PROFILE_APPROVAL":
      status = "pending_approval";
      break;
    default:
      status = "scheduled";
  }
  return {
    externalId: String(body.id),
    status,
    errorDetail: body.error ?? null,
    postedAt: body.postedAt ? new Date(body.postedAt) : null,
  };
}

/**
 * Extract a post id from Ocoya's createPost response. Probes multiple paths
 * because Ocoya's documented response shape isn't reliably surfacing in
 * production traffic — slice 37 (BAM 2026-05-06) hit a 201 Created where
 * `body.id` was undefined. Defensive over-extraction is cheap; missing the
 * id is correctness-critical (reconciler can't poll without it; retries
 * would create duplicates).
 *
 * Probe order:
 *   1. body.id                               (original assumption)
 *   2. body.postId, body.post_id             (camel/snake variants)
 *   3. body.data?.id, body.data?.postId      (data-wrapped responses)
 *   4. body.post?.id                         (post-wrapped responses)
 *   5. Location response header              (RFC 7231 standard for 201)
 *
 * Returns the first match coerced to string. Null when nothing matched.
 *
 * Exported for unit testing.
 */
export function extractCreatePostId(
  body: Record<string, unknown>,
  locationHeader: string | null
): string | null {
  // Direct top-level fields
  for (const key of ["id", "postId", "post_id"] as const) {
    const v = body[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }

  // Nested under .data
  const data = body.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["id", "postId", "post_id"] as const) {
      const v = d[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (typeof v === "number") return String(v);
    }
  }

  // Nested under .post
  const post = body.post;
  if (post && typeof post === "object") {
    const p = post as Record<string, unknown>;
    for (const key of ["id", "postId", "post_id"] as const) {
      const v = p[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (typeof v === "number") return String(v);
    }
  }

  // Location header. Ocoya may set Location: /post/{id} or a full URL.
  // Strip query/fragment, then take the last non-empty path segment.
  if (locationHeader && locationHeader.length > 0) {
    const withoutQuery = locationHeader.split(/[?#]/)[0];
    const segments = withoutQuery.split("/").filter((s) => s.length > 0);
    const last = segments[segments.length - 1];
    if (last && last.length > 0) return last;
  }

  return null;
}

export const ocoyaAdapter = adapter;
export type { PublisherTerminalStatus };
