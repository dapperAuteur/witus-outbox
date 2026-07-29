import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/nextjs";

/**
 * The promise made in every handoff: with no DSN set, error monitoring is completely inert. Nothing
 * initialises, nothing is intercepted, no network call is ever attempted. This test is the proof, so
 * a future edit that drops the `if (dsn)` guard fails here instead of on production traffic.
 */
describe("error monitoring without a DSN", () => {
  const saved = process.env.SENTRY_DSN;

  beforeEach(() => {
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = saved;
  });

  it("does not initialise a client when SENTRY_DSN is unset", async () => {
    await import("../sentry.server.config");
    expect(Sentry.getClient()).toBeUndefined();
  });

  it("makes captureException a no-op that does not throw", async () => {
    await import("../sentry.server.config");
    expect(() => Sentry.captureException(new Error("inert"))).not.toThrow();
    expect(Sentry.getClient()).toBeUndefined();
  });
});
