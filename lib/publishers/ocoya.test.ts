import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ocoyaAdapter as OcoyaAdapter } from "./ocoya";

const ENV_SNAPSHOT = { ...process.env };

async function loadAdapter(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ENV_SNAPSHOT };
  delete process.env.OCOYA_API_KEY;
  delete process.env.OCOYA_WORKSPACE_IDS;
  delete process.env.VERCEL_ENV;
  process.env.STORAGE_DATABASE_URL =
    process.env.STORAGE_DATABASE_URL ??
    "postgres://placeholder:placeholder@localhost:5432/placeholder";
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "tools@awews.com";
  process.env.NEXTAUTH_SECRET =
    process.env.NEXTAUTH_SECRET ?? "test-secret-at-least-16-chars-long";
  process.env.EMAIL_SERVER =
    process.env.EMAIL_SERVER ?? "smtp://placeholder@localhost:25";
  process.env.EMAIL_FROM =
    process.env.EMAIL_FROM ?? "Test <test@example.com>";
  process.env.PUBLISHER_BACKEND = "ocoya";
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("./ocoya");
  return mod.ocoyaAdapter as typeof OcoyaAdapter;
}

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
  vi.restoreAllMocks();
});

describe("ocoyaAdapter — dev-log path", () => {
  it("isLive is false when OCOYA_API_KEY is unset", async () => {
    const adapter = await loadAdapter({});
    expect(adapter.isLive).toBe(false);
  });

  it("createPost dev-logs and returns ok=true with a synthetic id", async () => {
    const adapter = await loadAdapter({});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("fetch should not be called in dev-log mode");
      });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await adapter.createPost({
      caption: "secret-caption-string",
      mediaUrls: [],
      socialProfileIds: [],
      scheduledAt: new Date("2026-12-01T10:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toMatch(/^dev-log-[0-9a-f]{12}$/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join(" ");
    expect(logged).not.toContain("secret-caption-string");
  });

  it("refuses to send in production with creds missing", async () => {
    const adapter = await loadAdapter({ VERCEL_ENV: "production" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("fetch should not be called when guarded");
      });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await adapter.createPost({
      caption: "guarded",
      mediaUrls: [],
      socialProfileIds: [],
      scheduledAt: new Date("2026-12-01T10:00:00Z"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("missing in production");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe("extractCreatePostId", () => {
  // Slice 37 — BAM 2026-05-06: production hit "ocoya-no-id-in-response" on
  // a 201 Created. Probe order must cover the common shapes a vendor uses
  // for creation responses.

  it("extracts top-level body.id (original assumption)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({ id: "abc123" }, null)).toBe("abc123");
  });

  it("coerces numeric body.id to string", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({ id: 42 }, null)).toBe("42");
  });

  it("extracts top-level body.postId (camelCase variant)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({ postId: "xyz" }, null)).toBe("xyz");
  });

  it("extracts top-level body.post_id (snake_case variant)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({ post_id: "snk" }, null)).toBe("snk");
  });

  it("extracts body.data.id (data-wrapped response)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({ data: { id: "wrapped-1" } }, null)
    ).toBe("wrapped-1");
  });

  it("extracts body.data.postId (data + camelCase)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({ data: { postId: "wrapped-2" } }, null)
    ).toBe("wrapped-2");
  });

  it("extracts body.post.id (post-wrapped response)", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({ post: { id: "post-wrapped" } }, null)
    ).toBe("post-wrapped");
  });

  it("extracts the last path segment from a Location header", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({}, "/post/from-header-id")
    ).toBe("from-header-id");
  });

  it("extracts from a full-URL Location header", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({}, "https://app.ocoya.com/api/_public/v1/post/abc")
    ).toBe("abc");
  });

  it("strips query string from Location header before extracting", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId({}, "/post/with-query?foo=bar")
    ).toBe("with-query");
  });

  it("prefers body.id over body.data.id when both are present", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId(
        { id: "top", data: { id: "nested" } },
        null
      )
    ).toBe("top");
  });

  it("returns null when no id and no Location header", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({}, null)).toBeNull();
    expect(extractCreatePostId({ unrelated: "thing" }, null)).toBeNull();
    expect(extractCreatePostId({ data: {} }, null)).toBeNull();
  });

  it("returns null for empty / non-string / non-number id values", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(extractCreatePostId({ id: "" }, null)).toBeNull();
    expect(extractCreatePostId({ id: null }, null)).toBeNull();
    expect(extractCreatePostId({ id: undefined }, null)).toBeNull();
    expect(extractCreatePostId({ id: {} }, null)).toBeNull();
  });

  it("falls through to Location header when body has no usable id", async () => {
    const { extractCreatePostId } = await import("./ocoya");
    expect(
      extractCreatePostId(
        { unrelated: "thing" },
        "/post/fallback-id"
      )
    ).toBe("fallback-id");
  });
});
