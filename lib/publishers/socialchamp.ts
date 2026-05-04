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
//
// Endpoint paths confirmed via the Redoc-rendered API reference (saved
// as plans/validate/Social Champ API Reference _ Social Champ Developer
// Docs.pdf). Base host is api.socialchamp.com; documented paths are
// /v1/rest/profile and /v1/rest/post (NOT /api/v1/... which the
// authentication landing page hinted at — that page's example was
// either stale or a different surface).
//
// What the PDF documents:
//   GET  /v1/rest/profile  → list all profiles for the API key
//   POST /v1/rest/post     → create one or more scheduled/queued posts
//
// What it does NOT document (so the corresponding adapter methods
// throw until BAM shares additional pages):
//   getPost(id), getPostsByStatus, updateScheduledAt, deletePost
const SOCIALCHAMP_BASE = "https://api.socialchamp.com";

const TODO_MARKER =
  "SocialChamp endpoint not yet documented — add the PDF page or curl response and I'll wire it up";

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
  status?: boolean | number;
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
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Maps SocialChamp's `type` enum to outbox's canonical platform key.
 * Source: PDF page 1, Get All Profiles response schema.
 *
 * SocialChamp values: FB_PAGE | FB_GROUP | IN | IN_PAGE | TW | IG |
 * IG_BUSINESS | G_BUSINESS | PINIT_PAGE | TIKTOK | MST
 *
 * Outbox canonical keys: twitter | instagram | facebook | linkedin |
 * youtube | bluesky | tiktok | pinterest (lib/publishers/types.ts).
 *
 * G_BUSINESS (Google Business) and MST (Mastodon) don't exist in the
 * outbox enum yet — pass through lowercased so they're at least
 * inspectable; ingest will reject any post targeting them until the
 * enum grows.
 */
function normalizeSocialChampType(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  switch (raw) {
    case "FB_PAGE":
    case "FB_GROUP":
      return "facebook";
    case "IN":
    case "IN_PAGE":
      return "linkedin";
    case "TW":
      return "twitter";
    case "IG":
    case "IG_BUSINESS":
      return "instagram";
    case "PINIT_PAGE":
      return "pinterest";
    case "TIKTOK":
      return "tiktok";
    case "G_BUSINESS":
      return "google_business";
    case "MST":
      return "mastodon";
    default:
      return raw.toLowerCase();
  }
}

const adapter: PublisherAdapter = {
  backend: "socialchamp",

  get isLive() {
    return Boolean(getApiKey());
  },

  /**
   * GET /v1/rest/profile — returns every profile the API key can see.
   * Response shape (PDF page 1):
   *   [{ id, name, type, profileImg }]
   * No pagination is documented for this endpoint, no workspace param.
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

    const res = await scFetch(apiKey, "/v1/rest/profile");
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      console.error(
        "[socialchamp] listProfiles status=%d detail=%s",
        res.status,
        detail
      );
      return [];
    }

    const body = (await res.json()) as Array<{
      id?: string;
      name?: string;
      type?: string;
      profileImg?: string | null;
    }>;
    if (!Array.isArray(body)) {
      console.error("[socialchamp] listProfiles returned non-array body");
      return [];
    }

    const profiles: PublisherSocialProfile[] = [];
    for (const p of body) {
      if (typeof p.id !== "string" || p.id.length === 0) continue;
      profiles.push({
        publisherProfileId: p.id,
        network: normalizeSocialChampType(p.type),
        displayName: typeof p.name === "string" && p.name.length > 0 ? p.name : null,
        // SocialChamp's profile API doesn't expose a workspace concept; the
        // API key already implies the workspace.
        workspaceId: null,
      });
    }
    return profiles;
  },

  /**
   * POST /v1/rest/post — creates one or more posts. The body is an
   * ARRAY (the docs are explicit about this). One profileId per post
   * object — to fan out to N profiles, send N items in the array.
   *
   * Body shape per item (PDF page 3):
   *   profileId   (required) — one Profile ID from listProfiles
   *   postType    (required) — SCHEDULE | NEXT | LAST | NOW
   *   post        — text body
   *   imageUrls   — array of image URLs
   *   videoUrls   — array of video URLs
   *   dateTime    — ISO string, required only when postType=SCHEDULE
   *
   * Response (PDF page 4): { status: 200, message: "Success" }.
   * The docs do NOT show the response carrying back any per-post id
   * (e.g. no "postIds" array). This means outbox can't track an
   * external_id for SocialChamp-created rows — getPost / reconcile
   * are blind without it. Slice 19c will need to figure out post
   * tracking (probably another endpoint we haven't seen yet).
   */
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

    if (input.socialProfileIds.length === 0) {
      return {
        ok: false,
        status: 0,
        detail: "no_social_profile",
      };
    }

    const { imageUrls, videoUrls } = splitMedia(input.mediaUrls);
    const dateTime = input.scheduledAt.toISOString();
    const items = input.socialProfileIds.map((profileId) => ({
      profileId,
      postType: "SCHEDULE" as const,
      post: input.caption,
      imageUrls,
      videoUrls,
      dateTime,
    }));

    const res = await scFetch(apiKey, "/v1/rest/post", {
      method: "POST",
      body: JSON.stringify(items),
    });

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      return { ok: false, status: res.status, detail };
    }

    // Per the PDF, the success response is { status: 200, message: "Success" }
    // with no per-post id. We synthesize a stable external id from the
    // request payload so the row has SOMETHING to display, and so the
    // reconciler doesn't double-submit. This is best-effort until
    // SocialChamp exposes real post ids in the response or via a list-by-
    // status endpoint.
    const synthId = `sc-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return { ok: true, externalId: synthId };
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

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|bmp)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)(?:[?#].*)?$/i;

/**
 * SocialChamp expects images and videos in separate arrays per the
 * createPost body schema. We split outbox's single mediaUrls list by
 * file extension. Anything we can't classify falls into imageUrls
 * (the more common case for posts) and the operator can re-edit in
 * SocialChamp's UI if SocialChamp rejects it.
 */
function splitMedia(mediaUrls: string[]): {
  imageUrls: string[];
  videoUrls: string[];
} {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  for (const url of mediaUrls) {
    if (VIDEO_EXT.test(url)) videoUrls.push(url);
    else if (IMAGE_EXT.test(url)) imageUrls.push(url);
    else imageUrls.push(url); // unknown ext → treat as image (conservative)
  }
  return { imageUrls, videoUrls };
}

export const socialChampAdapter = adapter;
export type { PublisherTerminalStatus };
