/**
 * The admin gate every Outbox sign-in passes, whichever provider it came through. Pure (no env,
 * no DB) so it is unit-tested directly; lib/auth.ts's NextAuth `signIn` callback is a thin
 * wrapper around it.
 *
 * WHY "Sign in with WitUS" ALSO NEEDS `email_verified`. The witus provider sets
 * `allowDangerousEmailAccountLinking`, so a WitUS sign-in whose email matches the admin's existing
 * magic-link user is attached to that user instead of failing with OAuthAccountNotLinked ("That
 * account is not linked", which WitUS Inbox hit for an email-login owner). Linking by email is only
 * safe when the IdP vouches for the address. NextAuth v4 runs the `signIn` callback BEFORE it
 * links accounts (next-auth 4.24 core/routes/callback.js: callbacks.signIn, then callbackHandler),
 * so refusing an unverified email here means an unverified address never links and never gets in.
 * The admin gate is an email match, so the same check also stops someone who registers ADMIN_EMAIL
 * at the IdP without proving they own it.
 *
 * The IdP (better-auth oidcProvider at accounts.witus.online) puts `email_verified` in the ID
 * token whenever the `email` scope is granted, and Outbox always requests it.
 */
export const WITUS_PROVIDER_ID = "witus";

export interface SignInGateInput {
  /** The admin address from env, any case. */
  adminEmail: string;
  /** The email NextAuth resolved for this sign-in (`user.email`). */
  email: string | null | undefined;
  /** `account.provider`: "email", "witus", ... */
  provider: string | null | undefined;
  /** The raw OIDC claims (`profile` in the signIn callback); absent for the email provider. */
  profile?: Record<string, unknown> | null;
}

export type SignInGateResult =
  | { allowed: true }
  | { allowed: false; reason: "not-admin" | "witus-email-unverified" };

export function checkAdminSignIn(input: SignInGateInput): SignInGateResult {
  const email = input.email?.trim().toLowerCase();
  const admin = input.adminEmail.trim().toLowerCase();
  if (!email || !admin || email !== admin) {
    return { allowed: false, reason: "not-admin" };
  }
  // Strictly `true`: a missing claim, "true" as a string, or false all refuse.
  if (input.provider === WITUS_PROVIDER_ID && input.profile?.email_verified !== true) {
    return { allowed: false, reason: "witus-email-unverified" };
  }
  return { allowed: true };
}
