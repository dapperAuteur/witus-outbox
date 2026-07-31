import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

// Next.js instrumentation hook. Loads the right error-monitoring config per runtime, and reports
// server-side App Router errors via onRequestError. Everything stays inert without a SENTRY_DSN
// (see the guards in the two config files).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

// Captures errors thrown while rendering or serving a request. We tag the ACTIVE PUBLISHER BACKEND,
// because "is this Ocoya or SocialChamp failing?" is the first question on nearly every outbox
// incident, and the env var answers it without a DB lookup in the error path and without touching
// any credential. captureRequestError does the rest; beforeSend scrubs the payload.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  Sentry.withScope((scope) => {
    scope.setTag("publisher.backend", process.env.PUBLISHER_BACKEND ?? "ocoya");
    Sentry.captureRequestError(err, request, context);
  });
};
