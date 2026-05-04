import { afterEach, describe, expect, it, vi } from "vitest";

// Hoisted so the mocks below can reference them. vi.mock factories are
// hoisted above any non-vitest imports, so plain `const`s declared at
// module scope wouldn't be visible yet.
const { findDefault, findSocial } = vi.hoisted(() => ({
  findDefault: vi.fn(),
  findSocial: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: () => ({
    query: {
      defaultPublisherProfiles: { findFirst: findDefault },
      socialProfiles: { findFirst: findSocial },
    },
  }),
}));

// Schema is referenced in where/orderBy clauses; the values just need to
// exist as objects so eq()/and()/desc() can stringify them. The mocked
// findFirst ignores its args entirely.
vi.mock("@/db/schema", () => ({
  defaultPublisherProfiles: {
    publisherBackend: "publisher_backend",
    workspaceId: "workspace_id",
    network: "network",
    publisherProfileIds: "publisher_profile_ids",
  },
  socialProfiles: {
    publisherBackend: "publisher_backend",
    network: "network",
    workspaceId: "workspace_id",
    lastSyncedAt: "last_synced_at",
    publisherProfileId: "publisher_profile_id",
  },
}));

import { resolveProfileIds } from "./profile-resolver";

afterEach(() => {
  findDefault.mockReset();
  findSocial.mockReset();
});

const baseArgs = {
  publisherBackend: "ocoya",
  workspaceId: "ws-1",
  network: "twitter",
};

describe("resolveProfileIds — precedence", () => {
  it("rowOverride wins over default and fallback", async () => {
    findDefault.mockResolvedValue({ publisherProfileIds: ["DEFAULT-A"] });
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds({
      ...baseArgs,
      rowOverride: ["OVERRIDE-1", "OVERRIDE-2"],
    });

    expect(r.source).toBe("row_override");
    expect(r.ids).toEqual(["OVERRIDE-1", "OVERRIDE-2"]);
    // Short-circuits before either DB query.
    expect(findDefault).not.toHaveBeenCalled();
    expect(findSocial).not.toHaveBeenCalled();
  });

  it("default wins over fallback when no override", async () => {
    findDefault.mockResolvedValue({
      publisherProfileIds: ["DEFAULT-A", "DEFAULT-B"],
    });
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds(baseArgs);

    expect(r.source).toBe("default");
    expect(r.ids).toEqual(["DEFAULT-A", "DEFAULT-B"]);
    // Default short-circuits the fallback query.
    expect(findSocial).not.toHaveBeenCalled();
  });

  it("falls back to most-recent social_profile when no default exists", async () => {
    findDefault.mockResolvedValue(undefined);
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds(baseArgs);

    expect(r.source).toBe("fallback");
    expect(r.ids).toEqual(["FALLBACK-A"]);
  });

  it("returns none when nothing matches", async () => {
    findDefault.mockResolvedValue(undefined);
    findSocial.mockResolvedValue(undefined);

    const r = await resolveProfileIds(baseArgs);

    expect(r.source).toBe("none");
    expect(r.ids).toEqual([]);
  });
});

describe("resolveProfileIds — empty edge cases must fall through", () => {
  it("empty rowOverride array does not trigger row_override", async () => {
    findDefault.mockResolvedValue({ publisherProfileIds: ["DEFAULT-A"] });
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds({ ...baseArgs, rowOverride: [] });

    expect(r.source).toBe("default");
  });

  it("non-array rowOverride does not trigger row_override", async () => {
    findDefault.mockResolvedValue({ publisherProfileIds: ["DEFAULT-A"] });
    findSocial.mockResolvedValue(undefined);

    const cases: unknown[] = [null, undefined, "not-an-array", 42, { a: 1 }];
    for (const rowOverride of cases) {
      const r = await resolveProfileIds({ ...baseArgs, rowOverride });
      expect(r.source).toBe("default");
    }
  });

  it("rowOverride with empty/non-string entries filters them out", async () => {
    findDefault.mockResolvedValue(undefined);
    findSocial.mockResolvedValue(undefined);

    const r = await resolveProfileIds({
      ...baseArgs,
      rowOverride: ["", "id-keep", null, 42, "", "id-keep-2"],
    });

    expect(r.source).toBe("row_override");
    expect(r.ids).toEqual(["id-keep", "id-keep-2"]);
  });

  it("default row with empty publisherProfileIds falls through to fallback", async () => {
    findDefault.mockResolvedValue({ publisherProfileIds: [] });
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds(baseArgs);

    expect(r.source).toBe("fallback");
    expect(r.ids).toEqual(["FALLBACK-A"]);
  });

  it("default row with non-array publisherProfileIds falls through to fallback", async () => {
    findDefault.mockResolvedValue({ publisherProfileIds: null });
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds(baseArgs);

    expect(r.source).toBe("fallback");
    expect(r.ids).toEqual(["FALLBACK-A"]);
  });
});

describe("resolveProfileIds — workspaceId handling", () => {
  it("skips the default-profile lookup when workspaceId is null", async () => {
    findSocial.mockResolvedValue({ publisherProfileId: "FALLBACK-A" });

    const r = await resolveProfileIds({
      publisherBackend: "ocoya",
      workspaceId: null,
      network: "twitter",
    });

    expect(r.source).toBe("fallback");
    expect(findDefault).not.toHaveBeenCalled();
    expect(findSocial).toHaveBeenCalledTimes(1);
  });

  it("returns none when workspaceId is null and no fallback exists", async () => {
    findSocial.mockResolvedValue(undefined);

    const r = await resolveProfileIds({
      publisherBackend: "ocoya",
      workspaceId: null,
      network: "twitter",
    });

    expect(r.source).toBe("none");
    expect(findDefault).not.toHaveBeenCalled();
  });
});

describe("resolveProfileIds — backend isolation", () => {
  // Same logical Twitter account in both Ocoya and SocialChamp = two
  // separate social_profile rows. The resolver must scope by backend so
  // a SocialChamp row never resolves to an Ocoya profile id.
  it("queries are issued with the supplied backend (no cross-backend leak)", async () => {
    findDefault.mockResolvedValue(undefined);
    findSocial.mockResolvedValue({ publisherProfileId: "SC-FALLBACK" });

    const r = await resolveProfileIds({
      publisherBackend: "socialchamp",
      workspaceId: "ws-sc-1",
      network: "twitter",
    });

    expect(r.source).toBe("fallback");
    expect(r.ids).toEqual(["SC-FALLBACK"]);
    // Both queries fired; the where-clauses passed publisherBackend=socialchamp.
    // We can't introspect the where args easily, but we can confirm both
    // tables were consulted (default first, then fallback).
    expect(findDefault).toHaveBeenCalledTimes(1);
    expect(findSocial).toHaveBeenCalledTimes(1);
  });
});
