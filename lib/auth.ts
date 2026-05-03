import "server-only";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { getEnv } from "@/lib/env";

/**
 * NextAuth options factory. Lazily reads env so importing this module at
 * build time (when env may not be fully set) does not crash. Mirrors the
 * three-mode pattern of every other side-effect lib in this repo.
 */
export function getAuthOptions(): NextAuthOptions {
  const env = getEnv();
  const adminEmail = env.ADMIN_EMAIL.toLowerCase();

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
    ],
    session: { strategy: "jwt" },
    secret: env.NEXTAUTH_SECRET,
    pages: {
      signIn: "/auth/sign-in",
      verifyRequest: "/auth/verify-request",
    },
    callbacks: {
      signIn({ user }) {
        const email = user?.email?.toLowerCase();
        if (!email || email !== adminEmail) {
          console.warn("[auth] rejected non-admin sign-in attempt");
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
