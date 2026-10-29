import { describe, expect, it } from "vitest";
import { authErrorNotice, errorCodeFromSearchParams } from "@/lib/auth-error";

describe("errorCodeFromSearchParams", () => {
  it("reads a string or the first array value", () => {
    expect(errorCodeFromSearchParams({ error: "AccessDenied" })).toBe("AccessDenied");
    expect(errorCodeFromSearchParams({ error: ["Verification", "x"] })).toBe("Verification");
  });

  it("returns null when absent or empty", () => {
    expect(errorCodeFromSearchParams(undefined)).toBeNull();
    expect(errorCodeFromSearchParams({})).toBeNull();
    expect(errorCodeFromSearchParams({ error: "" })).toBeNull();
  });
});

describe("authErrorNotice", () => {
  it("is null with no code", () => {
    expect(authErrorNotice(null)).toBeNull();
  });

  it("has specific copy for the codes Outbox expects", () => {
    for (const code of ["AccessDenied", "OAuthAccountNotLinked", "Verification", "EmailSignin"]) {
      const notice = authErrorNotice(code);
      expect(notice?.title).toBeTruthy();
      expect(notice?.title).not.toBe(authErrorNotice("SomethingElse")?.title);
    }
  });

  it("never echoes an unknown code into the page", () => {
    const notice = authErrorNotice("<script>alert(1)</script>");
    expect(notice?.title).toBe("Sign-in didn't finish");
    expect(JSON.stringify(notice)).not.toContain("script");
  });
});
