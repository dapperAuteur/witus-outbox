import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

// Browser-runtime error monitoring for the /outbox triage UI. Reads the PUBLIC DSN (inlined at
// build). Guarded: with no NEXT_PUBLIC_SENTRY_DSN the SDK is inert, so nothing is sent.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Errors only. No tracing and no session replay: the triage UI renders post copy and profile
    // names, and a replay would ship both to a third party.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

// Instruments App Router client navigations (no-op when not initialized).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
