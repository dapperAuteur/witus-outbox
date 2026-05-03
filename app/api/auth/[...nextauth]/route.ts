import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Lazy-init: building env vars are not guaranteed at `next build` collect-page-
// data time, but they are at request time. NextAuth construction reads env via
// getAuthOptions(), so we defer until the first request.
type NextAuthHandler = ReturnType<typeof NextAuth>;
let cached: NextAuthHandler | null = null;

function getHandler(): NextAuthHandler {
  if (!cached) cached = NextAuth(getAuthOptions());
  return cached;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return getHandler()(req, ctx);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ nextauth: string[] }> }
) {
  return getHandler()(req, ctx);
}
