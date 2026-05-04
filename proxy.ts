import { withAuth } from "next-auth/middleware";

const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      const email =
        typeof token?.email === "string" ? token.email.toLowerCase() : null;
      return Boolean(adminEmail && email === adminEmail);
    },
  },
  pages: { signIn: "/auth/sign-in" },
});

// Authed surfaces only. /api/ingest is HMAC-gated, /api/admin/tick uses a
// bearer token (Apps Script) so neither belongs here.
export const config = {
  matcher: [
    "/outbox/:path*",
    "/api/admin/scheduled-posts/:path*",
    "/api/admin/ocoya-workspaces",
    "/api/admin/ocoya-profile-debug",
    "/api/admin/default-profiles",
    "/api/admin/export-radaar-csv",
  ],
};
