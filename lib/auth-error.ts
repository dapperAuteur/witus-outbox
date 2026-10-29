/**
 * Turns the `?error=` code NextAuth v4 appends to /auth/sign-in into copy a person can act on.
 *
 * Every failed sign-in comes back to the same page: lib/auth.ts sets `pages.error` to
 * /auth/sign-in, and NextAuth sends the OAuth-family codes (OAuthCallback,
 * OAuthAccountNotLinked, ...) to `pages.signIn` with `?error=` regardless (next-auth 4.24
 * core/index.js, `case "error"`). Before this, an AccessDenied landed on NextAuth's bare
 * /api/auth/error page and every other code was dropped silently, so a failed "Sign in with
 * WitUS" looked like nothing happened.
 *
 * Unknown codes get the generic message rather than echoing the raw code into the page.
 */
export interface AuthErrorNotice {
  title: string;
  body: string;
}

const NOTICES: Record<string, AuthErrorNotice> = {
  AccessDenied: {
    title: "That account can't sign in to Outbox",
    body: "Outbox has a single admin. Use the admin email address, or a WitUS account with that address and a verified email.",
  },
  OAuthAccountNotLinked: {
    title: "That WitUS account isn't linked yet",
    body: "Sign in once with the email link below. If this keeps happening after that, the WitUS account's email may not be verified.",
  },
  Verification: {
    title: "That sign-in link has expired",
    body: "Links work once and expire after a while. Enter the admin email address to get a fresh one.",
  },
  EmailSignin: {
    title: "The sign-in email couldn't be sent",
    body: "Try again in a minute. If it keeps failing, use Sign in with WitUS.",
  },
};

const GENERIC: AuthErrorNotice = {
  title: "Sign-in didn't finish",
  body: "Try again. If it keeps failing, use the other sign-in option on this page.",
};

/** First `error` value from Next's searchParams, or null. */
export function errorCodeFromSearchParams(
  params: Record<string, string | string[] | undefined> | undefined
): string | null {
  const raw = params?.error;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : null;
}

export function authErrorNotice(code: string | null): AuthErrorNotice | null {
  if (!code) return null;
  return NOTICES[code] ?? GENERIC;
}
