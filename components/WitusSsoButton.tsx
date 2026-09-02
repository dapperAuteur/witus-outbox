"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  SILENT_SSO_TIMEOUT_MS,
  SSO_ATTEMPT_STORAGE_KEY,
  continueAsLabel,
  parseSilentSsoIdentity,
  silentSsoDecision,
  type SsoIdentity,
} from "@/lib/silent-sso";

/**
 * "Sign in with WitUS", plus the silent "Continue as <name>" check on top of it.
 *
 * WHAT THE VISITOR SEES. The email form is already on screen and nothing here delays it. The
 * button reads "Sign in with WitUS" from first paint. If the probe comes back with a live WitUS
 * session it becomes "Continue as <name>". If the probe fails, times out, is refused by CORS, or
 * is blocked by the browser's third-party-cookie rules, NOTHING changes and nothing is said — a
 * failed silent check must be completely invisible, and on Safari/Firefox it is the common case.
 *
 * `silentCheckUrl` is resolved on the SERVER (lib/env.ts `witusSilentSsoEndpoint`) and is null
 * unless `WITUS_OIDC_CLIENT_ID` is set, so the probe never fires on an app that could not finish
 * the flow. Button visibility keeps the repo's existing `NEXT_PUBLIC_WITUS_SSO` gate, applied by
 * the caller (components/SignInForm.tsx).
 */
export function WitusSsoButton({
  silentCheckUrl,
  disabled = false,
}: {
  /** IdP session endpoint, or null when ecosystem SSO is not configured. */
  silentCheckUrl: string | null;
  /** The email form is mid-submit; don't offer a second way out at the same time. */
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [identity, setIdentity] = useState<SsoIdentity | null>(null);

  useEffect(() => {
    const endpoint = silentCheckUrl;
    const decision = silentSsoDecision({
      endpoint,
      search: window.location.search,
      attempted: readAttempted(),
    });
    // `!endpoint` is implied by decision.attempt; repeated so the narrowing is the compiler's
    // and not a cast that could outlive the invariant.
    if (!decision.attempt || !endpoint) return;

    // Abort rather than hang. A probe still in flight when the visitor has moved on is a leak of
    // attention, not just of a socket.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SILENT_SSO_TIMEOUT_MS);
    let live = true;

    // `credentials: "include"` is the entire mechanism: the answer depends on the IdP's OWN
    // cookie, which is third-party from here. Browsers that partition or block third-party
    // cookies (Safari ITP, Firefox Total Cookie Protection) answer "nobody", and that is a
    // supported outcome, not a bug to work around.
    fetch(endpoint, {
      credentials: "include",
      mode: "cors",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!live) return;
        const found = parseSilentSsoIdentity(payload);
        // NEVER a credential. This name is display copy for a button whose click runs the real
        // OIDC code flow; it grants nothing and must never be treated as identity. The
        // ADMIN_EMAIL gate in lib/auth.ts is still the only thing that lets anyone in.
        if (found) setIdentity(found);
      })
      .catch(() => {
        // Invisible on purpose: network error, CORS refusal, abort, non-JSON body. All the same.
      })
      .finally(() => clearTimeout(timer));

    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [silentCheckUrl]);

  const start = useCallback(() => {
    setPending(true);
    // THE LOOP GUARD, written BEFORE the redirect, never after the return. Without it a visitor
    // whose IdP session has gone stale gets: probe says "Continue as X" -> click -> the IdP
    // cannot finish -> back to /auth/sign-in -> probe says "Continue as X" -> forever. With it,
    // one attempt per tab: the next render of this page offers the plain button and the email
    // form, which always work.
    writeAttempted();
    const callbackUrl =
      new URLSearchParams(window.location.search).get("callbackUrl") ??
      "/outbox";
    void signIn("witus", { callbackUrl });
  }, []);

  const label = pending ? "Redirecting…" : continueAsLabel(identity);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={disabled || pending}
        onClick={start}
      >
        {label}
      </Button>
      {/* Always in the DOM so the label change is announced when it happens, and silent (and
          invisible) when the probe found nothing. */}
      <p
        role="status"
        aria-live="polite"
        className={
          identity
            ? "mt-2 text-center text-xs text-slate-600 dark:text-slate-400"
            : "sr-only"
        }
      >
        {identity ? "Not you? Use the email form above." : ""}
      </p>
    </>
  );
}

/**
 * sessionStorage throws outright in some privacy modes, so both halves are wrapped. A browser
 * that cannot remember the attempt still gets the other half of the guard: a `?sso=tried` marker
 * on the URL, which silentSsoDecision reads from window.location.search.
 */
function readAttempted(): boolean {
  try {
    return window.sessionStorage.getItem(SSO_ATTEMPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAttempted(): void {
  try {
    window.sessionStorage.setItem(SSO_ATTEMPT_STORAGE_KEY, "1");
  } catch {
    // No storage, no marker. The query-param half still applies.
  }
}
