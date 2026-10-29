import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LOCAL_SIGN_OUT_DESTINATION,
  SIGN_OUT_EVERYWHERE_HELP,
  SIGN_OUT_EVERYWHERE_LABEL,
  SIGN_OUT_LABEL,
  signOutEverywhere,
  signOutHere,
  type SignOutEffects,
} from "@/lib/silent-sso";

/**
 * Sign-out semantics (BAM, 2026-10-29, witus task 128 option (b)):
 *   - "Sign out" ends only this app's session and never visits the IdP.
 *   - "Sign out of WitUS everywhere" is separate, renders only when an end-session URL was
 *     resolved, and ends the local session BEFORE navigating to the IdP.
 * This repo's vitest runs in node with no DOM, so the flows are tested through their pure,
 * injectable helpers, and the component wiring through its source.
 */

const END_SESSION =
  "https://accounts.witus.online/api/idp/oauth2/endsession?client_id=witus-outbox";
const ORIGIN = "https://outbox.witus.online";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8");
/** Assertions about what the CODE does must not be satisfied by a comment. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const component = stripComments(read("components/SignOutButton.tsx"));
const between = (src: string, from: string, to?: string) =>
  src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);

function recorder(opts: { localFails?: boolean } = {}) {
  const calls: string[] = [];
  const effects: SignOutEffects = {
    endLocalSession: async () => {
      calls.push("endLocalSession");
      if (opts.localFails) throw new Error("network");
    },
    navigate: (url) => {
      calls.push(`navigate:${url}`);
    },
  };
  return { calls, effects };
}

describe('"Sign out" is this app only', () => {
  it("ends the local session, then goes to /auth/sign-in", async () => {
    const { calls, effects } = recorder();
    await signOutHere(effects);
    expect(LOCAL_SIGN_OUT_DESTINATION).toBe("/auth/sign-in");
    expect(calls).toEqual(["endLocalSession", "navigate:/auth/sign-in"]);
  });

  it("still navigates locally when ending the session throws", async () => {
    const { calls, effects } = recorder({ localFails: true });
    await signOutHere(effects);
    expect(calls).toEqual(["endLocalSession", "navigate:/auth/sign-in"]);
  });

  it("never sees the end-session URL, even when one is configured", () => {
    const plain = between(
      component,
      "export function SignOutButton",
      "export function SignOutEverywhereButton"
    );
    expect(plain).not.toContain("endSessionUrl");
    expect(plain).not.toContain("signOutEverywhere");
    expect(plain).toContain("signOutHere(browserEffects)");
    // The controls wrapper hands the URL to the everywhere control only.
    const controls = between(component, "export function SignOutControls");
    expect(controls).toContain("<SignOutButton />");
    expect(controls).toContain("<SignOutEverywhereButton endSessionUrl={endSessionUrl} />");
  });

  it('is always named exactly "Sign out" (no flip to "Sign out of WitUS")', () => {
    expect(SIGN_OUT_LABEL).toBe("Sign out");
    expect(component).toContain("{pending ? SIGNING_OUT_LABEL : SIGN_OUT_LABEL}");
    expect(component).not.toContain('"Sign out of WitUS"');
    expect(component).not.toContain("aria-label");
  });

  it("every Outbox page header renders the controls", () => {
    for (const page of [
      "app/outbox/page.tsx",
      "app/outbox/[id]/page.tsx",
      "app/outbox/compose/page.tsx",
      "app/outbox/setup/page.tsx",
    ]) {
      expect(read(page)).toContain(
        "<SignOutControls endSessionUrl={witusEndSessionEndpoint()} />"
      );
    }
  });
});

describe('"Sign out of WitUS everywhere"', () => {
  const everywhere = between(
    component,
    "export function SignOutEverywhereButton",
    "export function SignOutControls"
  );

  it("uses the exact accessible name and help text", () => {
    expect(SIGN_OUT_EVERYWHERE_LABEL).toBe("Sign out of WitUS everywhere");
    expect(SIGN_OUT_EVERYWHERE_HELP).toBe(
      "Also signs you out of WitUS. Other WitUS apps you are signed in to stay signed in until you sign out of them."
    );
  });

  it("renders nothing when no end-session URL was resolved", () => {
    expect(everywhere).toContain("if (!endSessionUrl) return null;");
    expect(everywhere.indexOf("return null")).toBeLessThan(everywhere.indexOf("<Button"));
  });

  it("references its visible help text with aria-describedby", () => {
    expect(everywhere).toContain("const helpId = useId();");
    expect(everywhere).toContain("aria-describedby={helpId}");
    expect(everywhere).toMatch(/<p id=\{helpId\}[^>]*>\s*\{SIGN_OUT_EVERYWHERE_HELP\}/);
    expect(everywhere).toContain('variant="secondary"');
  });

  it("ends the local session BEFORE navigating to the IdP endsession URL", async () => {
    const { calls, effects } = recorder();
    await signOutEverywhere(END_SESSION, ORIGIN, effects);
    expect(calls).toEqual([
      "endLocalSession",
      "navigate:https://accounts.witus.online/api/idp/oauth2/endsession?client_id=witus-outbox" +
        "&post_logout_redirect_uri=https%3A%2F%2Foutbox.witus.online%2F",
    ]);
  });

  it("still hands off to the IdP when ending the local session throws", async () => {
    const { calls, effects } = recorder({ localFails: true });
    await signOutEverywhere(END_SESSION, ORIGIN, effects);
    expect(calls[0]).toBe("endLocalSession");
    expect(calls[1]).toContain("/oauth2/endsession?client_id=witus-outbox&post_logout_redirect_uri=");
  });

  it("uses signOut({ redirect: false }) and a full navigation, not a router push", () => {
    expect(component).toContain("signOut({ redirect: false })");
    expect(component).toContain("window.location.assign(url)");
    expect(component).not.toContain("useRouter");
  });
});
