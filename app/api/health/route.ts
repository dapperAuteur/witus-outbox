import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { describeError } from "@/lib/db-safe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long the liveness query gets before we call the database unreachable.
 * Short on purpose: an uptime monitor needs a fast, decisive 503 when Neon
 * hangs, not a request that sits open until the platform kills it.
 */
const DB_TIMEOUT_MS = 4_000;

const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
} as const;

/**
 * Public, unauthenticated liveness probe. Point the uptime monitor here
 * rather than at `/`, which can serve a cached 200 while the database is
 * down. Deliberately narrow:
 *
 *  - It checks exactly ONE thing: can this deployment reach Postgres. That
 *    is the dependency whose failure makes every route in the app wrong.
 *  - It never calls a publisher API (Ocoya, SocialChamp, Mailgun, Mobile
 *    Text Alerts). A vendor outage is not an outbox outage, so it must not
 *    turn the monitor red, and provider error bodies routinely echo the
 *    bearer token that produced them.
 *  - It never reports which publisher backend is configured, whether a token
 *    is present, or whether a token is valid. That is reconnaissance, and
 *    this endpoint is open to the internet.
 *  - It never returns a raw error. A Neon/undici connection failure commonly
 *    embeds the connection string, password included. Only the fixed token
 *    `database_unreachable` goes over the wire; the error class name and
 *    SQLSTATE (both content-free, per lib/db-safe.ts) go to the server log.
 *
 * Not covered by `proxy.ts`: its `withAuth` matcher lists explicit paths and
 * `/api/health` is not one of them, so no session is required.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();

  try {
    await withTimeout(pingDb(), DB_TIMEOUT_MS);
  } catch (err) {
    const meta = describeError(err);
    console.error(
      "[health] database check failed err=%s code=%s ms=%d",
      meta.name,
      meta.code ?? "?",
      Date.now() - startedAt
    );
    return NextResponse.json(
      { ok: false, error: "database_unreachable" },
      { status: 503, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { ok: true, checkedAt: new Date().toISOString() },
    { status: 200, headers: NO_STORE }
  );
}

/**
 * Cheapest possible liveness query. `select 1` touches no table, so it stays
 * correct through any future schema change and cannot be slowed by row counts
 * or a missing index. It still proves the whole path works: env parsed,
 * connection string valid, Neon reachable, credentials accepted.
 */
async function pingDb(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

/**
 * Neon's HTTP driver is fetch-based and the pooled client is built once in
 * `db/index.ts`, so there is no per-call abort signal to hand it. Racing a
 * timer gives the caller a bounded response either way; a stuck fetch is
 * abandoned and reaped with the function invocation.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("health check timed out")),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
