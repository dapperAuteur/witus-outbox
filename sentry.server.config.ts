import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

// Server-runtime error monitoring. Loaded by instrumentation.ts's register() on the Node runtime.
// The SDK is @sentry/nextjs but the ingest endpoint is Better Stack: the DSN decides where reports
// go, so no vendor name is hard-coded here.
//
// GUARDED ON THE DSN: with no SENTRY_DSN set, init() never runs and the SDK is completely inert, so
// the app ships and behaves exactly as before until BAM sets the var (plans/user-tasks/16).
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Errors only. No tracing spend until BAM opts in.
    tracesSampleRate: 0,
    // Never auto-attach IP, cookies, or the admin email. scrubEvent is the second line of defense
    // and the one that catches publisher API keys and ingest HMAC secrets in message text.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
