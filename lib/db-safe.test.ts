import { describe, expect, it, vi } from "vitest";
import { safeDbWrite } from "./db-safe";

describe("safeDbWrite", () => {
  it("returns ok=true with the value on success", async () => {
    const result = await safeDbWrite({ op: "test.insert" }, async () => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("returns ok=false with errorName on failure", async () => {
    class FakeDbError extends Error {
      override name = "FakeDbError";
    }
    const result = await safeDbWrite({ op: "test.insert" }, async () => {
      throw new FakeDbError("contains the caption: secret");
    });
    expect(result).toEqual({ ok: false, errorName: "FakeDbError" });
  });

  it("returns errorName='UnknownError' for non-Error throws", async () => {
    const result = await safeDbWrite({ op: "test.insert" }, async () => {
      throw "string thrown";
    });
    expect(result).toEqual({ ok: false, errorName: "UnknownError" });
  });

  it("logs only op + err + correlation IDs (never the thrown message)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await safeDbWrite(
        {
          op: "scheduled_post.insert",
          source: "radaar-csv-import",
          draftId: "ep-12-quote-card",
        },
        async () => {
          throw new Error("PII LEAK: caption text that should NEVER appear in logs");
        }
      );
      expect(spy).toHaveBeenCalledTimes(1);
      const formatted = spy.mock.calls[0]
        ?.map((arg: unknown) => String(arg))
        .join(" ") ?? "";
      expect(formatted).toContain("op=scheduled_post.insert");
      expect(formatted).toContain("err=Error");
      expect(formatted).toContain("source=radaar-csv-import");
      expect(formatted).toContain("draft_id=ep-12-quote-card");
      expect(formatted).not.toContain("PII LEAK");
      expect(formatted).not.toContain("caption text");
    } finally {
      spy.mockRestore();
    }
  });
});
