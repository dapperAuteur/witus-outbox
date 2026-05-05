import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { INGEST_SOURCES: undefined as string | undefined },
}));

vi.mock("./env", () => ({
  getEnv: () => ({ INGEST_SOURCES: mockEnv.INGEST_SOURCES }),
}));

// Test isolation: re-import to clear the module-level cache between tests.
async function reload() {
  vi.resetModules();
  return await import("./ingest-publisher-backends");
}

beforeEach(() => {
  mockEnv.INGEST_SOURCES = undefined;
});

afterEach(() => {
  vi.resetModules();
});

describe("getSourcePublisherBackend", () => {
  it("returns null when INGEST_SOURCES is unset", async () => {
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("any-slug")).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    mockEnv.INGEST_SOURCES = JSON.stringify([
      { slug: "alpha", hmac_secret: "x".repeat(32), publisher_backend: "ocoya" },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("not-configured")).toBeNull();
  });

  it("returns the backend when slug has a valid publisher_backend", async () => {
    mockEnv.INGEST_SOURCES = JSON.stringify([
      { slug: "centenarianos", hmac_secret: "x".repeat(32), publisher_backend: "ocoya" },
      { slug: "sc-test", hmac_secret: "x".repeat(32), publisher_backend: "socialchamp" },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("centenarianos")).toBe("ocoya");
    expect(getSourcePublisherBackend("sc-test")).toBe("socialchamp");
  });

  it("returns null for slug without publisher_backend (caller falls through to env)", async () => {
    mockEnv.INGEST_SOURCES = JSON.stringify([
      { slug: "no-override", hmac_secret: "x".repeat(32) },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("no-override")).toBeNull();
  });

  it("returns null when publisher_backend is an unknown string (typo guard)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEnv.INGEST_SOURCES = JSON.stringify([
      { slug: "typo", hmac_secret: "x".repeat(32), publisher_backend: "social-champ" },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("typo")).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("tolerates extra fields not in the schema (passthrough)", async () => {
    // Inbox + workspaces sidecar both add fields to the same JSON entry;
    // this parser must not reject when other sidecars' fields are present.
    mockEnv.INGEST_SOURCES = JSON.stringify([
      {
        slug: "centenarianos",
        hmac_secret: "x".repeat(32),
        workspace_name: "main",
        publisher_backend: "ocoya",
        future_field: { nested: "ok" },
      },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("centenarianos")).toBe("ocoya");
  });

  it("returns null when INGEST_SOURCES is invalid JSON (graceful)", async () => {
    mockEnv.INGEST_SOURCES = "{not json";
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("anything")).toBeNull();
  });

  it("returns null when INGEST_SOURCES doesn't match the array schema", async () => {
    mockEnv.INGEST_SOURCES = JSON.stringify({ not: "an array" });
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("anything")).toBeNull();
  });

  it("does not let one bad slug poison the rest", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEnv.INGEST_SOURCES = JSON.stringify([
      { slug: "good", hmac_secret: "x".repeat(32), publisher_backend: "ocoya" },
      { slug: "bad", hmac_secret: "x".repeat(32), publisher_backend: "made-up" },
      { slug: "also-good", hmac_secret: "x".repeat(32), publisher_backend: "socialchamp" },
    ]);
    const { getSourcePublisherBackend } = await reload();
    expect(getSourcePublisherBackend("good")).toBe("ocoya");
    expect(getSourcePublisherBackend("bad")).toBeNull();
    expect(getSourcePublisherBackend("also-good")).toBe("socialchamp");
    errorSpy.mockRestore();
  });
});
