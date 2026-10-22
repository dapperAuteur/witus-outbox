/**
 * Event taxonomy for WitUS Outbox.
 *
 * The ecosystem shares ONE PostHog project, separated by the `app` property that
 * posthog-provider registers on load. Two rules keep that project readable, and both
 * are cheap now and expensive to retrofit once data has landed:
 *
 *   1. `snake_case`, object first, verb in past tense — `post_retried`.
 *   2. NEVER put the app name in the event name. `outbox_signin_started` is wrong: it
 *      makes the same action from two apps look like two events and kills the
 *      cross-app comparison that sharing a project exists to enable. The `app`
 *      property already carries that.
 *
 * Shared lifecycle events (the SHARED_EVENTS block) use identical names in every
 * ecosystem app. Do not rename these here without renaming them everywhere.
 *
 * Canonical source of this file's shape: witus-online lib/analytics/events.ts and
 * lib/analytics/INTEGRATE.md. posthog-provider.tsx and capture.ts in this folder are
 * byte-for-byte copies of that repo's files — do not edit them here.
 */

/** Matches this app's slug in witus-online lib/identity/clients.ts. Every event carries it. */
export const ANALYTICS_APP = "outbox";

/**
 * Events with identical names across every ecosystem app. Names are contractual.
 */
export const SHARED_EVENTS = {
  signinStarted: "signin_started",
  signinSucceeded: "signin_succeeded",
  signinFailed: "signin_failed",
} as const;

/**
 * Events specific to Outbox. Outbox is a single-operator admin tool, so the list starts
 * with route views only; add named events here (never ad-hoc strings) as questions
 * about the triage UI come up.
 */
export const EVENTS = {
  /** An explicit route view. capture_pageview is off — Next's client router would
   *  fire it once and then lie — so route changes are reported deliberately. Required
   *  by posthog-provider.tsx. */
  routeViewed: "route_viewed",
  ...SHARED_EVENTS,
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
