import { registerOTel, OTLPHttpProtoTraceExporter } from "@vercel/otel";
import type { Attributes, Context, Link, SpanKind } from "@opentelemetry/api";
import { SamplingDecision, type Sampler, type SamplingResult } from "@opentelemetry/sdk-trace-base";

// OpenTelemetry → Honeycomb tracing. Loaded from instrumentation.ts's register() on both runtimes,
// BEFORE the Sentry configs, because whoever registers the global tracer provider first wins and
// this file must be the winner (see skipOpenTelemetrySetup in sentry.server.config.ts).
//
// GUARDED ON THE KEY: with neither Honeycomb var set, registration is skipped entirely and the app
// ships exactly as it does today. Same inert-until-provisioned pattern as the Sentry DSN.
// Provisioning: witus plans/user-tasks/73-observability-pilot-external-setup.md.
//
// WHICH VAR FEEDS THE HEADER: Honeycomb ingest auth expects the ingest key's SECRET in
// `x-honeycomb-team`. We read HONEYCOMB_INGEST_API_KEY_SECRET first and fall back to
// HONEYCOMB_API_KEY, then verify by behavior at first span send (witus plan 30 §7.1) rather than
// asserting which of BAM's two key values Honeycomb accepts.

/**
 * Uptime monitors probe /api/health around the clock (Better Stack). Those requests are pure
 * noise in Honeycomb — same span, thousands of times a month, across every monitored app — so
 * they are dropped at the sampler, before they ever count against the free tier's 20M events.
 * Everything else is recorded unsampled; current traffic sits far below the ceiling, and the
 * agreed lever if that changes is ratio sampling, not code changes (witus plan 30 §7.4).
 */
const dropHealthChecks: Sampler = {
  shouldSample(
    _context: Context,
    _traceId: string,
    _name: string,
    _kind: SpanKind,
    attributes: Attributes,
    _links: Link[],
  ): SamplingResult {
    // Semconv moved http.target → url.path across OTel versions; accept either.
    const path = attributes["http.target"] ?? attributes["url.path"];
    if (typeof path === "string" && path.startsWith("/api/health")) {
      return { decision: SamplingDecision.NOT_RECORD };
    }
    return { decision: SamplingDecision.RECORD_AND_SAMPLED };
  },
  toString(): string {
    return "DropHealthChecksSampler";
  },
};

/** No-op without a key. @vercel/otel auto-instruments inbound fetch handlers, so sibling apps'
 *  outbox trigger calls (POST /api/ingest etc.) show up as server spans with no extra wiring. */
export function registerHoneycombOtel(): void {
  const key = process.env.HONEYCOMB_INGEST_API_KEY_SECRET ?? process.env.HONEYCOMB_API_KEY;
  if (!key) return;

  registerOTel({
    serviceName: "witus-outbox",
    traceExporter: new OTLPHttpProtoTraceExporter({
      url: "https://api.honeycomb.io/v1/traces",
      headers: { "x-honeycomb-team": key },
    }),
    traceSampler: dropHealthChecks,
  });
}
