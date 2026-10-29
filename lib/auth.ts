import "server-only";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import type { OAuthConfig } from "next-auth/providers/oauth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { checkAdminSignIn, WITUS_PROVIDER_ID } from "@/lib/auth-gate";
import { getEnv, isWitusOidcConfigured } from "@/lib/env";
import { WITUS_OIDC_DISCOVERY_FALLBACK } from "@/lib/silent-sso";

interface WitusProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * "Sign in with WitUS" — ecosystem OIDC provider (accounts.witus.online).
 * Registered only when isWitusOidcConfigured() (client id AND secret set). Sign-ins
 * still pass through the admin-gate signIn callback below, so a WitUS login is
 * accepted only when its email matches ADMIN_EMAIL and the IdP marks it verified.
 *
 * The callback path NextAuth derives from `id: "witus"` is /api/auth/callback/witus,
 * which is what the IdP registry (gemini/witus lib/identity/clients.ts, slug
 * `outbox`, NEXTAUTH_CB) has registered. Renaming the id breaks sign-in with a 400.
 */
function witusProvider(): OAuthConfig<WitusProfile> {
  return {
    id: WITUS_PROVIDER_ID,
    name: "WitUS",
    type: "oauth",
    wellKnown:
      process.env.WITUS_OIDC_DISCOVERY_URL ?? WITUS_OIDC_DISCOVERY_FALLBACK,
    clientId: process.env.WITUS_OIDC_CLIENT_ID,
    clientSecret: process.env.WITUS_OIDC_CLIENT_SECRET,
    authorization: { params: { scope: "openid email profile" } },
    idToken: true,
    // accounts.witus.online signs ID tokens with EdDSA only (its JWKS holds one Ed25519
    // key; discovery also lists RS256, but no RSA key exists). openid-client 5 defaults to
    // RS256 and rejects the token with "unexpected JWT alg received", which NextAuth
    // reports as ?error=OAuthCallback. Same fix as WitUS Inbox (f5d1a1d, 2026-10-16).
    client: { id_token_signed_response_alg: "EdDSA" },
    checks: ["pkce", "state"],
    // An admin who first signed in with the email magic link already has a user row, so
    // without this the first WitUS sign-in fails with OAuthAccountNotLinked ("That account
    // is not linked", hit on WitUS Inbox). Safe only because the signIn callback runs
    // BEFORE linking and refuses any WitUS sign-in whose email_verified is not true; see
    // lib/auth-gate.ts.
    allowDangerousEmailAccountLinking: true,
    profile(profile) {
      return {
        id: profile.sub,
        email: profile.email ?? null,
        name: profile.name ?? null,
        image: null,
      };
    },
  };
}

/**
 * NextAuth options factory. Lazily reads env so importing this module at
 * build time (when env may not be fully set) does not crash. Mirrors the
 * three-mode pattern of every other side-effect lib in this repo.
 */
export function getAuthOptions(): NextAuthOptions {
  const env = getEnv();

  return {
    adapter: DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers: [
      EmailProvider({
        server: env.EMAIL_SERVER,
        from: env.EMAIL_FROM,
      }),
      ...(isWitusOidcConfigured() ? [witusProvider()] : []),
    ],
    session: { strategy: "jwt" },
    secret: env.NEXTAUTH_SECRET,
    pages: {
      signIn: "/auth/sign-in",
      verifyRequest: "/auth/verify-request",
      // A failed sign-in (AccessDenied from the gate below, an expired magic link)
      // comes back to the sign-in page with ?error=, which renders a notice
      // (lib/auth-error.ts) instead of NextAuth's bare /api/auth/error page.
      error: "/auth/sign-in",
    },
    callbacks: {
      signIn({ user, account, profile }) {
        const result = checkAdminSignIn({
          adminEmail: env.ADMIN_EMAIL,
          email: user?.email,
          provider: account?.provider,
          profile: profile as Record<string, unknown> | undefined,
        });
        if (!result.allowed) {
          // Reason only; never the address.
          console.warn(`[auth] rejected sign-in attempt (${result.reason})`);
          return false;
        }
        return true;
      },
      session({ session, token }) {
        if (session.user) {
          session.user.email = token.email ?? session.user.email;
          if (token.sub) {
            (session.user as { id?: string }).id = token.sub;
          }
        }
        return session;
      },
    },
  };
}
