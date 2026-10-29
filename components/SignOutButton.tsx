"use client";

import { useId, useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SIGN_OUT_EVERYWHERE_HELP,
  SIGN_OUT_EVERYWHERE_LABEL,
  SIGN_OUT_LABEL,
  SIGNING_OUT_LABEL,
  signOutEverywhere,
  signOutHere,
  type SignOutEffects,
} from "@/lib/silent-sso";

/**
 * Sign-out controls (BAM, 2026-10-29, witus task 128 option (b)).
 *
 * - `SignOutButton` ("Sign out") ends ONLY the Outbox session and goes to /auth/sign-in. It never
 *   navigates to the IdP and its label never changes (shared UI rule: the header Sign out control
 *   is never renamed or removed).
 * - `SignOutEverywhereButton` ("Sign out of WitUS everywhere") is a secondary control that also
 *   ends the shared accounts.witus.online session. It renders only when `endSessionUrl` is
 *   non-null. The caller resolves that URL on the SERVER (lib/env.ts `witusEndSessionEndpoint`),
 *   and passes null when this app is not a configured ecosystem OIDC client.
 * - `SignOutControls` puts the two together for a page header.
 */

// `redirect: false` keeps control of the navigation; a full navigation (not a router push)
// follows, because the everywhere flow leaves this origin for the IdP.
const browserEffects: SignOutEffects = {
  endLocalSession: () => signOut({ redirect: false }),
  navigate: (url) => window.location.assign(url),
};

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    await signOutHere(browserEffects);
  }

  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => void onSignOut()}>
      <LogOut className="size-4" aria-hidden="true" />
      <span>{pending ? SIGNING_OUT_LABEL : SIGN_OUT_LABEL}</span>
    </Button>
  );
}

export function SignOutEverywhereButton({
  endSessionUrl = null,
}: { endSessionUrl?: string | null } = {}) {
  const [pending, setPending] = useState(false);
  const helpId = useId();

  if (!endSessionUrl) return null;
  const url = endSessionUrl;

  async function onSignOut() {
    setPending(true);
    // ORDER IS THE SAFETY PROPERTY: signOutEverywhere destroys the LOCAL session first, then
    // hands off to the IdP, which returns to `https://outbox.witus.online/` (the
    // post_logout_redirect_uri registered for this client in gemini/witus
    // lib/identity/clients.ts). See lib/silent-sso.ts.
    await signOutEverywhere(url, window.location.origin, browserEffects);
  }

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Button
        variant="secondary"
        size="sm"
        aria-describedby={helpId}
        disabled={pending}
        onClick={() => void onSignOut()}
      >
        {pending ? SIGNING_OUT_LABEL : SIGN_OUT_EVERYWHERE_LABEL}
      </Button>
      <p id={helpId} className="max-w-xs text-xs text-slate-600 dark:text-slate-400">
        {SIGN_OUT_EVERYWHERE_HELP}
      </p>
    </div>
  );
}

/** "Sign out" with "Sign out of WitUS everywhere" under it (only when configured). */
export function SignOutControls({
  endSessionUrl = null,
}: { endSessionUrl?: string | null } = {}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <SignOutButton />
      <SignOutEverywhereButton endSessionUrl={endSessionUrl} />
    </div>
  );
}
