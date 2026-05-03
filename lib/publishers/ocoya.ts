import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
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

interface OcoyaCredentials {
  apiKey: string;
  workspaceId: string;
}

function getCredentials(): OcoyaCredentials | null {
  const env = getEnv();
  if (!env.OCOYA_API_KEY || !env.OCOYA_WORKSPACE_ID) return null;
  return { apiKey: env.OCOYA_API_KEY, workspaceId: env.OCOYA_WORKSPACE_ID };
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
    return getCredentials() !== null;
  },

  async listProfiles(): Promise<PublisherSocialProfile[]> {
    const creds = getCredentials();
    if (!creds) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to list profiles: OCOYA_API_KEY/OCOYA_WORKSPACE_ID missing in production"
        );
        return [];
      }
      console.warn("[ocoya] credentials missing; dev-log fallback for listProfiles");
      return [];
    }
    const res = await ocoyaFetch(
      creds.apiKey,
      `/social-profiles?workspaceId=${encodeURIComponent(creds.workspaceId)}`
    );
    if (!res.ok) {
      console.error("[ocoya] listProfiles status=%d", res.status);
      return [];
    }
    const body = (await res.json()) as Array<{
      id: string | number;
      network?: string;
      displayName?: string;
      workspaceId?: string | number;
    }>;
    return body.map((p) => ({
      publisherProfileId: String(p.id),
      network: p.network ?? "unknown",
      displayName: p.displayName ?? null,
      workspaceId: p.workspaceId != null ? String(p.workspaceId) : null,
    }));
  },

  async createPost(input: PostInput): Promise<CreatePostResult> {
    const creds = getCredentials();
    if (!creds) {
      if (isProduction()) {
        console.error(
          "[ocoya] refusing to create post: OCOYA_API_KEY/OCOYA_WORKSPACE_ID missing in production"
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
        scheduledAt: input.scheduledAt.toISOString(),
      });
      return { ok: true, externalId: id };
    }

    const res = await ocoyaFetch(
      creds.apiKey,
      `/post?workspaceId=${encodeURIComponent(creds.workspaceId)}`,
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
      const body = (await res.json()) as { id?: string | number };
      const id = body.id != null ? String(body.id) : null;
      if (!id) {
        return { ok: false, status: res.status, detail: "ocoya-no-id-in-response" };
      }
      return { ok: true, externalId: id };
    }

    const detail = await readErrorDetail(res);
    return { ok: false, status: res.status, detail };
  },

  async getPost(externalId: string): Promise<PublisherPostStatus | null> {
    const creds = getCredentials();
    if (!creds) return null;
    const res = await ocoyaFetch(creds.apiKey, `/post/${encodeURIComponent(externalId)}`);
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
    page
  ): Promise<{ posts: PublisherPostStatus[]; hasMore: boolean }> {
    const creds = getCredentials();
    if (!creds) return { posts: [], hasMore: false };
    const ocoyaStatuses = statuses.map((s) => s.toUpperCase()).join(",");
    const res = await ocoyaFetch(
      creds.apiKey,
      `/post?statuses=${encodeURIComponent(ocoyaStatuses)}&perPage=50&page=${page}&workspaceId=${encodeURIComponent(creds.workspaceId)}`
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
    const creds = getCredentials();
    if (!creds) {
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
      creds.apiKey,
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
    const creds = getCredentials();
    if (!creds) {
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
      creds.apiKey,
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

export const ocoyaAdapter = adapter;
export type { PublisherTerminalStatus };
