import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ocoyaAdapter as OcoyaAdapter } from "./ocoya";

const ENV_SNAPSHOT = { ...process.env };

async function loadAdapter(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...ENV_SNAPSHOT };
  delete process.env.OCOYA_API_KEY;
  delete process.env.OCOYA_WORKSPACE_ID;
  delete process.env.VERCEL_ENV;
  process.env.STORAGE_DATABASE_URL =
    process.env.STORAGE_DATABASE_URL ??
    "postgres://placeholder:placeholder@localhost:5432/placeholder";
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "tools@awews.com";
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
