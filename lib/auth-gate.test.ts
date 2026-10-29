import { describe, expect, it } from "vitest";
import { checkAdminSignIn } from "@/lib/auth-gate";

const adminEmail = "Admin@Example.com";

describe("checkAdminSignIn", () => {
  it("allows the admin through the email provider, any case", () => {
    expect(
      checkAdminSignIn({ adminEmail, email: "admin@example.COM", provider: "email" })
    ).toEqual({ allowed: true });
  });

  it("refuses anyone who is not the admin, on any provider", () => {
    for (const provider of ["email", "witus"]) {
      expect(
        checkAdminSignIn({
          adminEmail,
          email: "someone@example.com",
          provider,
          profile: { email_verified: true },
        })
      ).toEqual({ allowed: false, reason: "not-admin" });
    }
  });

  it("refuses a sign-in with no email", () => {
    expect(checkAdminSignIn({ adminEmail, email: null, provider: "witus" })).toEqual({
      allowed: false,
      reason: "not-admin",
    });
  });

  it("allows the admin's WitUS account when the IdP says the email is verified", () => {
    expect(
      checkAdminSignIn({
        adminEmail,
        email: "admin@example.com",
        provider: "witus",
        profile: { sub: "u1", email: "admin@example.com", email_verified: true },
      })
    ).toEqual({ allowed: true });
  });

  it("refuses the admin's address over WitUS unless email_verified is exactly true", () => {
    for (const profile of [
      { email_verified: false },
      { email_verified: "true" },
      {},
      null,
      undefined,
    ]) {
      expect(
        checkAdminSignIn({
          adminEmail,
          email: "admin@example.com",
          provider: "witus",
          profile,
        })
      ).toEqual({ allowed: false, reason: "witus-email-unverified" });
    }
  });
});
