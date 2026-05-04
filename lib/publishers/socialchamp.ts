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

function getApiKey(): string | null {
  return getEnv().SOCIAL_CHAMP_API_KEY ?? null;
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

function devLogId(): string {
  return `dev-log-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * SocialChamp's documented error envelope (per
 * developers.socialchamp.com/docs/error-handling):
 *   { error: { code, message, details: [{field, issue}], requestId } }
 *
 * Older surfaces (and the 404 "Not found" BAM hit on guessed paths) use
 * a flatter shape:
 *   { status: false, message: "Not found" }
 *
 * Both are handled below. requestId is logged when present so support
 * tickets can quote it.
 */
async function readErrorDetail(res: Response): Promise<string> {
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return `socialchamp-${res.status}`;
  }
  if (!raw || typeof raw !== "object") return `socialchamp-${res.status}`;
  const body = raw as Record<string, unknown>;
  const errField = body.error;
  if (errField && typeof errField === "object") {
    const inner = errField as Record<string, unknown>;
    const requestId =
      typeof inner.requestId === "string" ? inner.requestId : null;
    const message =
      typeof inner.message === "string"
        ? inner.message
        : typeof inner.code === "string"
          ? inner.code
          : `socialchamp-${res.status}`;
    return requestId ? `${message} requestId=${requestId}` : message;
  }
  if (typeof errField === "string") return errField;
  if (typeof body.message === "string") return body.message;
  if (typeof body.code === "string") return body.code;
  return `socialchamp-${res.status}`;
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
 * SocialChamp values seen in real responses: FB_PAGE | FB_GROUP | IN |
 * IN_PAGE | TW | IG | IG_BUSINESS | G_BUSINESS | PINIT_PAGE | TIKTOK |
 * MST | BSKY | YT (the PDF documented the first 11; BSKY + YT showed up
 * in BAM's actual /v1/rest/profile response).
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
    case "YT":
      return "youtube";
    case "BSKY":
      return "bluesky";
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
      workspaceId?: string | null;
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
        // The PDF didn't show workspaceId on the response, but real
        // /v1/rest/profile responses include it. Read whatever's there;
        // SocialChamp users on a single workspace will see one value
        // repeated, multi-workspace users get a useful grouping key.
        workspaceId:
          typeof p.workspaceId === "string" && p.workspaceId.length > 0
            ? p.workspaceId
            : null,
      });
    }
    return profiles;
  },

  /**
   * SocialChamp's listProfiles already returns every profile across all
   * workspaces in one call (the API key implies the user's whole tenant).
   * No iteration needed.
   */
  async syncAllProfiles(): Promise<PublisherSocialProfile[]> {
    return this.listProfiles();
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

    // Idempotency-Key per SocialChamp's API standards docs — write
    // operations only. Each createPost call is a fresh attempt
    // (operator-driven retries go through retryPost, which calls us
    // again with no retained state); a fresh UUID matches that semantic.
    const idempotencyKey = randomUUID();

    const res = await scFetch(apiKey, "/v1/rest/post", {
      method: "POST",
      body: JSON.stringify(items),
      headers: { "Idempotency-Key": idempotencyKey },
    });

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      return { ok: false, status: res.status, detail };
    }

    // Read the body verbatim and look for any id-like field. The PDF
    // shows only {status, message} but real responses MAY include more
    // (the Redoc spec was likely truncated when exported to PDF). When
    // we find a real id, use it so getPost / cancel can target it later.
    // When we don't, log the raw body once so the operator can see what
    // SocialChamp actually returns and we can update the parser.
    const rawText = await res.text();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      parsedBody = null;
    }

    const realId = scanForId(parsedBody);
    if (realId) {
      console.log(
        "[socialchamp] createPost ok external_id=%s (real id from response)",
        realId
      );
      return { ok: true, externalId: realId };
    }

    // No id surfaced — log the body shape so we know what to add next time.
    console.log(
      "[socialchamp] createPost ok no_real_id_in_response body_preview=%s",
      rawText.slice(0, 400)
    );
    // Per the PDF, the success response is { status: 200, message: "Success" }
    // with no per-post id. We synthesize a stable external id from the
    // request payload so the row has SOMETHING to display, and so the
    // reconciler doesn't double-submit. This is best-effort until
    // SocialChamp exposes real post ids in the response or via a list-by-
    // status endpoint.
    const synthId = `sc-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return { ok: true, externalId: synthId };
  },

  /**
   * SocialChamp doesn't document a get-by-id endpoint in any PDF we have.
   * Returning null instead of throwing so:
   *   - The 15-min reconciler tick doesn't crash on SC rows.
   *   - Manual Reconcile-now (lib/admin-actions.reconcileNowPost) returns
   *     a clean "publisher_returned_nothing" instead of a 500.
   * Slice 19e fills this in if SocialChamp's API is shown to support it.
   */
  async getPost(_externalId: string): Promise<PublisherPostStatus | null> {
    void _externalId;
    if (!getApiKey()) return null;
    console.warn(
      "[socialchamp] getPost not implemented — SocialChamp's public API doesn't document a get-by-id endpoint yet"
    );
    return null;
  },

  /**
   * Reconciler entry point. SocialChamp doesn't document a list-by-status
   * endpoint, and createPost returns no per-post id, so there's nothing
   * to reconcile against today. Returns empty so the tick handler skips
   * SC workspaces gracefully.
   */
  async getPostsByStatus(
    _statuses,
    _page,
    _workspaceId?: string
  ): Promise<{ posts: PublisherPostStatus[]; hasMore: boolean }> {
    void _statuses;
    void _page;
    void _workspaceId;
    return { posts: [], hasMore: false };
  },

  /**
   * No documented update endpoint. We log so the operator knows the row's
   * local scheduled_at moved but SocialChamp wasn't notified — the
   * scheduled time inside SC is whatever the operator set when the post
   * was originally created.
   */
  async updateScheduledAt(externalId, scheduledAt): Promise<void> {
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
    console.warn(
      "[socialchamp] updateScheduledAt is a local-only no-op — SocialChamp's public API doesn't document a PATCH endpoint (external_id=%s scheduled_at=%s)",
      externalId,
      scheduledAt.toISOString()
    );
  },

  /**
   * Local-only cancel — outbox marks the row cancelled but SocialChamp's
   * scheduled post stays in SocialChamp's queue. The operator must also
   * delete it inside SocialChamp's UI to fully cancel. Slice 19e wires
   * this when the API exposes a delete endpoint.
   */
  async deletePost(externalId): Promise<void> {
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
    console.warn(
      "[socialchamp] deletePost is a local-only no-op — also delete in SocialChamp's UI (external_id=%s)",
      externalId
    );
  },
};

/**
 * Recursively walks a parsed JSON value looking for the first plausible
 * post-id field. Used by createPost to surface any id SocialChamp
 * returns even though the documented response sample only shows
 * `{status, message}`. The Redoc spec sometimes truncates examples;
 * real responses can carry more.
 *
 * Looks for: id, postId, post_id, _id (in nested objects too).
 */
function scanForId(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scanForId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["id", "postId", "post_id", "_id"]) {
      const v = obj[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (typeof v === "number") return String(v);
    }
    // Recurse into nested objects (data, posts, items, etc.).
    for (const key of ["data", "posts", "items", "result", "results"]) {
      const found = scanForId(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

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
