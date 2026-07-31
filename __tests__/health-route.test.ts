import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/db", () => ({
  getDb: () => ({ execute }),
}));

// Imported after the mock so the route binds to the stubbed client.
const { GET } = await import("@/app/api/health/route");

/**
 * The exact shape of a Neon connection failure: the driver's message embeds
 * the connection string, password included. Nothing resembling this may reach
 * the response body — the endpoint is public and unauthenticated.
 */
const LEAKY_ERROR = new Error(
  "connect ECONNREFUSED postgresql://outbox_owner:sup3r-s3cret-pw@ep-fake-123.us-east-2.aws.neon.tech/outbox?sslmode=require"
);

describe("GET /api/health", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 200 {ok:true} when the database answers", async () => {
    execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("actually queries the database rather than returning static JSON", async () => {
    execute.mockResolvedValue({ rows: [] });

    await GET();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with only a generic token when the database is down", async () => {
    execute.mockRejectedValue(LEAKY_ERROR);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "database_unreachable" });
  });

  it("never leaks the connection string, password, host or message", async () => {
    execute.mockRejectedValue(LEAKY_ERROR);

    const res = await GET();
    const serialized = await res.text();

    expect(serialized).not.toContain("sup3r-s3cret-pw");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("neon.tech");
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toMatch(/stack/i);
  });

  it("sets no-store on both the healthy and unhealthy responses", async () => {
    execute.mockResolvedValue({ rows: [] });
    const healthy = await GET();
    expect(healthy.headers.get("cache-control")).toContain("no-store");

    execute.mockRejectedValue(LEAKY_ERROR);
    const unhealthy = await GET();
    expect(unhealthy.headers.get("cache-control")).toContain("no-store");
  });

  it("gives up on a hung database instead of hanging with it", async () => {
    vi.useFakeTimers();
    execute.mockReturnValue(new Promise(() => {}));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "database_unreachable" });
  });
});

describe("/api/health reachability", () => {
  it("is not captured by the withAuth matcher in proxy.ts", () => {
    const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    const matcher = proxy.slice(proxy.indexOf("matcher"));

    expect(matcher).not.toContain("/api/health");
    // A catch-all entry would swallow the probe behind a sign-in redirect.
    expect(matcher).not.toContain('"/api/:path*"');
    expect(matcher).not.toContain('"/:path*"');
  });
});
