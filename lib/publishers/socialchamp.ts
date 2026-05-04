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

// SocialChamp API. Auth: `Authorization: Bearer YOUR_API_KEY`.
// Base URL + auth confirmed via developers.socialchamp.com/docs/authentication.
// Endpoint paths and response shapes for create/list/update/delete are NOT
// pinned to documentation — Redoc renders client-side and isn't fetchable
// as plaintext. The methods that hit real endpoints throw a clear error
// pointing at /api/admin/socialchamp-debug, which the operator uses to
// inspect verbatim API responses and feed shapes back. Slice 19b will
// fill in the throw'd methods once shapes are known.
const SOCIALCHAMP_BASE = "https://api.socialchamp.com/api/v1";

const TODO_MARKER =
  "SocialChamp endpoint shape unverified — use /api/admin/socialchamp-debug?path=… to inspect";

function getApiKey(): string | null {
  return getEnv().SOCIAL_CHAMP_API_KEY ?? null;
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function devLogId(): string {
  return `dev-log-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

interface ScErrorBody {
  message?: string;
  error?: string;
  code?: string;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ScErrorBody;
    return body.message ?? body.error ?? body.code ?? `socialchamp-${res.status}`;
  } catch {
    return `socialchamp-${res.status}`;
  }
}

async function scFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${SOCIALCHAMP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      // Idempotency-Key per SocialChamp's API standards docs. Every retry
      // of a write should keep the same value; the adapter itself doesn't
      // retry, so generating one per call is fine.
      "Idempotency-Key": randomUUID(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

const adapter: PublisherAdapter = {
  backend: "socialchamp",

  get isLive() {
    return Boolean(getApiKey());
  },

  /**
   * GET /accounts is the one endpoint visible from the developer-docs
   * landing page; it appears to return the connected social accounts for
   * the API key's owning workspace. Response shape inferred from
   * SocialChamp's API-standards page:
   *   { data: [...], paging: { nextCursor, hasMore } }
   * Once slice 19b confirms the per-account field names from a real
   * response, normalize them through pickProfileName / pickNetworkField
   * the same way Ocoya's adapter does.
   */
  async listProfiles(_workspaceId?: string): Promise<PublisherSocialProfile[]> {
    void _workspaceId;
    const apiKey = getApiKey();
    if (!apiKey) {
      if (isProduction()) {
        console.error(
          "[socialchamp] refusing to list profiles: SOCIAL_CHAMP_API_KEY missing in production"
        );
        return [];
      }
      console.warn("[socialchamp] credentials missing; dev-log fallback for listProfiles");
      return [];
    }

    const res = await scFetch(apiKey, "/accounts");
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      console.error(
        "[socialchamp] listProfiles status=%d detail=%s",
        res.status,
        detail
      );
      return [];
    }

    const body = (await res.json()) as
      | { data?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>;
    const list = Array.isArray(body)
      ? body
      : Array.isArray(body.data)
        ? body.data
        : [];
    const profiles: PublisherSocialProfile[] = [];
    for (const p of list) {
      const idRaw = p.id ?? p.accountId ?? p.account_id;
      if (typeof idRaw !== "string" && typeof idRaw !== "number") continue;
      const networkRaw =
        (typeof p.platform === "string" ? p.platform : null) ??
        (typeof p.network === "string" ? p.network : null) ??
        (typeof p.provider === "string" ? p.provider : null) ??
        (typeof p.type === "string" ? p.type : null);
      const nameRaw =
        (typeof p.displayName === "string" ? p.displayName : null) ??
        (typeof p.name === "string" ? p.name : null) ??
        (typeof p.username === "string" ? p.username : null) ??
        (typeof p.handle === "string" ? p.handle : null);
      profiles.push({
        publisherProfileId: String(idRaw),
        network: networkRaw ? networkRaw.toLowerCase() : "unknown",
        displayName: nameRaw,
        workspaceId: null,
      });
    }
    return profiles;
  },

  async createPost(input: PostInput): Promise<CreatePostResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      if (isProduction()) {
        console.error(
          "[socialchamp] refusing to create post: SOCIAL_CHAMP_API_KEY missing in production"
        );
        return {
          ok: false,
          status: 0,
          detail: "socialchamp creds missing in production",
        };
      }
      const id = devLogId();
      console.warn("[socialchamp] credentials missing; dev-log fallback for createPost");
      console.log("[socialchamp:dev]", {
        externalId: id,
        captionLength: input.caption.length,
        mediaCount: input.mediaUrls.length,
        socialProfileCount: input.socialProfileIds.length,
        scheduledAt: input.scheduledAt.toISOString(),
      });
      return { ok: true, externalId: id };
    }
    return {
      ok: false,
      status: 0,
      detail: `${TODO_MARKER} (createPost)`,
    };
  },

  async getPost(_externalId: string): Promise<PublisherPostStatus | null> {
    void _externalId;
    if (!getApiKey()) return null;
    throw new Error(`${TODO_MARKER} (getPost)`);
  },

  async getPostsByStatus(
    _statuses,
    _page,
    _workspaceId?: string
  ): Promise<{ posts: PublisherPostStatus[]; hasMore: boolean }> {
    void _statuses;
    void _page;
    void _workspaceId;
    if (!getApiKey()) return { posts: [], hasMore: false };
    throw new Error(`${TODO_MARKER} (getPostsByStatus)`);
  },

  async updateScheduledAt(_externalId, _scheduledAt): Promise<void> {
    void _externalId;
    void _scheduledAt;
    if (!getApiKey()) {
      if (isProduction()) {
        console.error(
          "[socialchamp] refusing to update post: credentials missing in production"
        );
        return;
      }
      console.warn(
        "[socialchamp] credentials missing; dev-log fallback for updateScheduledAt"
      );
      return;
    }
    throw new Error(`${TODO_MARKER} (updateScheduledAt)`);
  },

  async deletePost(_externalId): Promise<void> {
    void _externalId;
    if (!getApiKey()) {
      if (isProduction()) {
        console.error(
          "[socialchamp] refusing to delete post: credentials missing in production"
        );
        return;
      }
      console.warn(
        "[socialchamp] credentials missing; dev-log fallback for deletePost"
      );
      return;
    }
    throw new Error(`${TODO_MARKER} (deletePost)`);
  },
};

export const socialChampAdapter = adapter;
export type { PublisherTerminalStatus };
