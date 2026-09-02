"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endSessionUrlWithRedirect } from "@/lib/silent-sso";

/**
 * GLOBAL SIGN-OUT (BAM, 2026-08-30: "signout signs out of every app"). When `endSessionUrl` is
 * present, signing out of Outbox also ends the shared session at accounts.witus.online, so it
 * signs you out of every WitUS app in this browser. The caller resolves the URL on the SERVER
 * (lib/env.ts `witusEndSessionEndpoint`) and passes null when this app is not a configured
 * ecosystem OIDC client, in which case sign-out stays exactly as local as it is today.
 */
export function SignOutButton({
  endSessionUrl = null,
}: { endSessionUrl?: string | null } = {}) {
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    if (!endSessionUrl) {
      await signOut({ callbackUrl: "/auth/sign-in" });
      return;
    }
    // ORDER IS THE SAFETY PROPERTY. Destroy the LOCAL session first (`redirect: false` so we keep
    // control of the navigation), and only then hand off to the IdP. If the IdP is unreachable or
    // refuses the logout, the person is still signed out HERE. Handing off first would turn any
    // IdP failure into "I clicked sign out and I'm still signed in".
    try {
      await signOut({ redirect: false });
    } catch {
      // A failed local sign-out must not trap someone in a session they asked to leave, and it
      // must not skip the IdP either — better to end the shared session and let the local one be
      // re-checked on the next request than to strand the visitor on a dead button.
    }
    // Full navigation, not a router push: this leaves our origin for the IdP, which then returns
    // to `https://outbox.witus.online/` (the post_logout_redirect_uri registered for this client
    // in gemini/witus lib/identity/clients.ts). They are signed out either way.
    window.location.assign(
      endSessionUrlWithRedirect(endSessionUrl, window.location.origin)
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => void onSignOut()}
      aria-label={endSessionUrl ? "Sign out of WitUS" : "Sign out"}
    >
      <LogOut className="size-4" aria-hidden="true" />
      <span>
        {pending
          ? "Signing out…"
          : endSessionUrl
            ? "Sign out of WitUS"
            : "Sign out"}
      </span>
    </Button>
  );
}
