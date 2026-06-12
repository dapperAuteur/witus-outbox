import { describe, expect, it, vi } from "vitest";
import { describeError, isRetryable, safeDbWrite } from "./db-safe";

describe("safeDbWrite", () => {
  it("returns ok=true with the value on success", async () => {
    const result = await safeDbWrite({ op: "test.insert" }, async () => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("returns ok=false with errorName + errorCode=null on plain Error", async () => {
    class FakeDbError extends Error {
      override name = "FakeDbError";
    }
    const result = await safeDbWrite({ op: "test.insert" }, async () => {
      throw new FakeDbError("contains the caption: secret");
    });
    expect(result).toEqual({
      ok: false,
      errorName: "FakeDbError",
      errorCode: null,
    });
  });

  it("returns errorName='UnknownError' for non-Error throws", async () => {
    const result = await safeDbWrite({ op: "test.insert" }, async () => {
      throw "string thrown";
    });
    expect(result).toEqual({
      ok: false,
      errorName: "UnknownError",
      errorCode: null,
    });
  });

  it("surfaces SQLSTATE code from a NeonDbError-shaped throw", async () => {
    class NeonDbError extends Error {
      override name = "NeonDbError";
      code = "42P01";
    }
    const result = await safeDbWrite({ op: "scheduled_post.insert" }, async () => {
      throw new NeonDbError(
        'relation "scheduled_post" does not exist; query=… params=[…]'
      );
    });
    expect(result).toEqual({
      ok: false,
      errorName: "NeonDbError",
      errorCode: "42P01",
    });
  });

  it("logs only op + err + code + correlation IDs (never the thrown message)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      class NeonDbError extends Error {
        override name = "NeonDbError";
        code = "23505";
      }
      await safeDbWrite(
        {
          op: "scheduled_post.insert",
          source: "radaar-csv-import",
          draftId: "ep-12-quote-card",
        },
        async () => {
          throw new NeonDbError(
            "PII LEAK: caption text that should NEVER appear in logs"
          );
        }
      );
      expect(spy).toHaveBeenCalledTimes(1);
      const formatted = spy.mock.calls[0]
        ?.map((arg: unknown) => String(arg))
        .join(" ") ?? "";
      expect(formatted).toContain("op=scheduled_post.insert");
      expect(formatted).toContain("err=NeonDbError");
      expect(formatted).toContain("code=23505");
      expect(formatted).toContain("source=radaar-csv-import");
      expect(formatted).toContain("draft_id=ep-12-quote-card");
      expect(formatted).not.toContain("PII LEAK");
      expect(formatted).not.toContain("caption text");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("describeError", () => {
  it("returns UnknownError for non-Error throws", () => {
    expect(describeError("string")).toEqual({ name: "UnknownError", code: null });
    expect(describeError(42)).toEqual({ name: "UnknownError", code: null });
    expect(describeError(undefined)).toEqual({ name: "UnknownError", code: null });
  });

  it("extracts SQLSTATE from the error itself when present", () => {
    class NeonDbError extends Error {
      override name = "NeonDbError";
      code = "42703";
    }
    expect(describeError(new NeonDbError("undefined column"))).toEqual({
      name: "NeonDbError",
      code: "42703",
    });
  });

  it("extracts SQLSTATE from cause when Drizzle wraps it", () => {
    class WrappedError extends Error {
      override name = "WrappedError";
      cause: unknown;
      constructor(message: string, cause: unknown) {
        super(message);
        this.cause = cause;
      }
    }
    const inner = Object.assign(new Error("inner"), {
      name: "NeonDbError",
      code: "42P01",
    });
    expect(describeError(new WrappedError("outer", inner))).toEqual({
      name: "WrappedError",
      code: "42P01",
    });
  });

  it("ignores non-SQLSTATE codes (e.g., random string codes)", () => {
    const e = Object.assign(new Error("nope"), {
      name: "OtherError",
      code: "ENOTFOUND",
    });
    expect(describeError(e)).toEqual({ name: "OtherError", code: null });
  });

  it("ignores code when it isn't a string", () => {
    const e = Object.assign(new Error("nope"), {
      name: "OtherError",
      code: 42,
    });
    expect(describeError(e)).toEqual({ name: "OtherError", code: null });
  });
});

describe("isRetryable", () => {
  it("retries Postgres connection-exception (08xxx) SQLSTATEs", () => {
    for (const code of ["08000", "08003", "08006", "08001", "08004"]) {
      const e = Object.assign(new Error("conn"), { name: "NeonDbError", code });
      expect(isRetryable(e)).toBe(true);
    }
  });

  it("retries 57P01 admin_shutdown (Neon compute recycle)", () => {
    const e = Object.assign(new Error("shutdown"), {
      name: "NeonDbError",
      code: "57P01",
    });
    expect(isRetryable(e)).toBe(true);
  });

  it("does NOT retry deterministic SQLSTATEs (undefined table, unique violation)", () => {
    for (const code of ["42P01", "42703", "23505", "23503"]) {
      const e = Object.assign(new Error("schema"), { name: "NeonDbError", code });
      expect(isRetryable(e)).toBe(false);
    }
  });

  it("retries Node network error codes on the error or its cause", () => {
    const direct = Object.assign(new Error("reset"), {
      name: "Error",
      code: "ECONNRESET",
    });
    expect(isRetryable(direct)).toBe(true);

    const wrapped = Object.assign(new Error("fetch failed"), {
      name: "TypeError",
      cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }),
    });
    expect(isRetryable(wrapped)).toBe(true);
  });

  it("retries undici's bare 'TypeError: fetch failed'", () => {
    const e = new TypeError("fetch failed");
    expect(isRetryable(e)).toBe(true);
  });

  it("does not retry plain errors or non-Error throws", () => {
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable("string")).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});
