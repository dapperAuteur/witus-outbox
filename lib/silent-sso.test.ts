import { describe, expect, it } from "vitest";
import {
  SSO_ATTEMPT_STORAGE_KEY,
  WITUS_OIDC_DISCOVERY_FALLBACK,
  continueAsLabel,
  endSessionEndpointFromDiscovery,
  endSessionUrlWithRedirect,
  hasAttemptMarker,
  parseSilentSsoIdentity,
  silentSsoDecision,
  silentSsoEndpointFromDiscovery,
} from "@/lib/silent-sso";

const DISCOVERY = WITUS_OIDC_DISCOVERY_FALLBACK;

describe("silentSsoEndpointFromDiscovery", () => {
  it("derives the probe from the discovery URL's origin", () => {
    expect(silentSsoEndpointFromDiscovery(DISCOVERY)).toBe(
      "https://accounts.witus.online/api/ecosystem/session"
    );
  });

  it("follows a self-hosted IdP rather than hardcoding accounts.witus.online", () => {
    expect(
      silentSsoEndpointFromDiscovery(
        "http://localhost:3000/api/idp/.well-known/openid-configuration"
      )
    ).toBe("http://localhost:3000/api/ecosystem/session");
  });

  it("returns null for a missing, unparseable, or non-discovery URL", () => {
    expect(silentSsoEndpointFromDiscovery(null)).toBeNull();
    expect(silentSsoEndpointFromDiscovery("")).toBeNull();
    expect(silentSsoEndpointFromDiscovery("not a url")).toBeNull();
    expect(
      silentSsoEndpointFromDiscovery("https://accounts.witus.online/api/idp")
    ).toBeNull();
  });
});

describe("endSessionEndpointFromDiscovery", () => {
  it("keeps the IdP's basePath — endsession lives under it, the probe does not", () => {
    expect(endSessionEndpointFromDiscovery(DISCOVERY)).toBe(
      "https://accounts.witus.online/api/idp/oauth2/endsession"
    );
  });

  it("returns null when there is no discovery URL to derive from", () => {
    expect(endSessionEndpointFromDiscovery(undefined)).toBeNull();
  });
});

describe("endSessionUrlWithRedirect", () => {
  // The trailing slash is the whole point: better-auth exact-matches
  // post_logout_redirect_uri against the client's registered redirectUrls, and the IdP
  // registry registers `origin + "/"`. Drop it and the IdP returns a 400.
  it("appends an encoded post_logout_redirect_uri WITH a trailing slash", () => {
    const url = endSessionUrlWithRedirect(
      "https://accounts.witus.online/api/idp/oauth2/endsession?client_id=outbox",
      "https://outbox.witus.online"
    );
    expect(url).toBe(
      "https://accounts.witus.online/api/idp/oauth2/endsession?client_id=outbox" +
        "&post_logout_redirect_uri=https%3A%2F%2Foutbox.witus.online%2F"
    );
    expect(new URL(url).searchParams.get("post_logout_redirect_uri")).toBe(
      "https://outbox.witus.online/"
    );
  });

  it("does not double the slash when the origin already ends in one", () => {
    expect(
      new URL(
        endSessionUrlWithRedirect(
          "https://idp.example/endsession?client_id=x",
          "https://outbox.witus.online/"
        )
      ).searchParams.get("post_logout_redirect_uri")
    ).toBe("https://outbox.witus.online/");
  });

  it("uses ? when the endsession URL carries no query yet", () => {
    expect(
      endSessionUrlWithRedirect("https://idp.example/endsession", "https://a.example")
    ).toContain("/endsession?post_logout_redirect_uri=");
  });
});

describe("silentSsoDecision", () => {
  it("probes when configured, signed out, and not yet attempted", () => {
    expect(silentSsoDecision({ endpoint: "https://idp/x" })).toEqual({
      attempt: true,
    });
  });

  it("stays dark when the app is not a configured OIDC client", () => {
    expect(silentSsoDecision({ endpoint: null })).toEqual({
      attempt: false,
      skip: "not-configured",
    });
  });

  it("skips when the visitor is already signed in locally", () => {
    expect(
      silentSsoDecision({ endpoint: "https://idp/x", signedIn: true })
    ).toEqual({ attempt: false, skip: "already-signed-in" });
  });

  it("skips on the sessionStorage half of the loop guard", () => {
    expect(
      silentSsoDecision({ endpoint: "https://idp/x", attempted: true })
    ).toEqual({ attempt: false, skip: "already-attempted" });
  });

  it("skips on the query-param half of the loop guard", () => {
    expect(
      silentSsoDecision({
        endpoint: "https://idp/x",
        search: "?callbackUrl=%2Foutbox&sso=tried",
      })
    ).toEqual({ attempt: false, skip: "already-attempted" });
  });
});

describe("hasAttemptMarker", () => {
  it("accepts the marker with or without a leading ?", () => {
    expect(hasAttemptMarker("?sso=tried")).toBe(true);
    expect(hasAttemptMarker("sso=tried")).toBe(true);
  });

  it("rejects absent, empty, or wrong values", () => {
    expect(hasAttemptMarker(null)).toBe(false);
    expect(hasAttemptMarker("")).toBe(false);
    expect(hasAttemptMarker("?sso=nope")).toBe(false);
    expect(hasAttemptMarker("?callbackUrl=%2Foutbox")).toBe(false);
  });

  it("pins the storage key so a rename cannot silently disarm the guard", () => {
    expect(SSO_ATTEMPT_STORAGE_KEY).toBe("witus.sso.attempted");
  });
});

describe("parseSilentSsoIdentity", () => {
  it("reads the IdP's { signedIn, user: { name } } shape", () => {
    expect(
      parseSilentSsoIdentity({ signedIn: true, user: { name: "Brand" } })
    ).toEqual({ label: "Brand" });
  });

  it("returns null for the signed-out answer and for junk", () => {
    expect(parseSilentSsoIdentity({ signedIn: false })).toBeNull();
    expect(parseSilentSsoIdentity(null)).toBeNull();
    expect(parseSilentSsoIdentity("Brand")).toBeNull();
    expect(parseSilentSsoIdentity({ user: { name: "   " } })).toBeNull();
    expect(parseSilentSsoIdentity({ user: { name: 42 } })).toBeNull();
  });

  // The label crosses an origin boundary, so it is hostile input that happens to be rendered.
  it("strips control characters and trims", () => {
    expect(
      parseSilentSsoIdentity({ user: { name: "  Br\u0007a\u001Fnd\u007F  " } })
    ).toEqual({ label: "Brand" });
  });

  it("caps an absurd name at 48 characters with an ellipsis", () => {
    const label = parseSilentSsoIdentity({ user: { name: "a".repeat(200) } })?.label;
    expect(label).toHaveLength(48);
    expect(label?.endsWith("…")).toBe(true);
  });
});

describe("continueAsLabel", () => {
  // Pins the exact copy the visitor reads, in both states.
  it("falls back to the ordinary button when the probe found nobody", () => {
    expect(continueAsLabel(null)).toBe("Sign in with WitUS");
  });

  it("offers Continue as <name> when it did", () => {
    expect(continueAsLabel({ label: "Brand" })).toBe("Continue as Brand");
  });
});
