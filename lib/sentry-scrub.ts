import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Sentry `beforeSend` scrubber (self-contained, no repo deps so it is directly unit-testable).
 *
 * Why this file is stricter than a normal app's scrubber
 * ------------------------------------------------------
 * Outbox is the ecosystem's ONE holder of publishing credentials. A single crash report can
 * plausibly carry, in a message string or a captured local variable:
 *   - the publisher API key (`OCOYA_API_KEY`, `SOCIAL_CHAMP_API_KEY`) that can post as every brand;
 *   - an `INGEST_SOURCES` HMAC secret, which lets anyone forge a "publish this" webhook;
 *   - `APPS_SCRIPT_TOKEN`, the bearer that drives `/api/admin/tick`;
 *   - the Neon/SMTP connection strings, which embed passwords in the URI userinfo;
 *   - an OAuth access/refresh token belonging to a connected social account.
 * Any one of those leaking to a third-party error service is a takeover of the brand's voice, so the
 * bias here is REDACT WHEN UNSURE. An over-redacted report costs a debugging round trip; an
 * under-redacted one costs the credential.
 *
 * We also drop the request BODY outright. Outbox request bodies are signed webhook payloads and post
 * payloads: never needed to fix a stack trace, always the highest-value thing in the report.
 *
 * It never returns null. We still want the crash signal, just with the secrets removed.
 */

export const REDACTED = "[redacted]";
/** Shared opening of every placeholder, used to spot text an earlier pass already handled. */
const REDACTED_PREFIX = "[redacted";
export const REDACTED_URL = "[redacted url]";
export const REDACTED_EMAIL = "[redacted email]";

/** `postgres://user:pass@host`, `smtps://user:pass@smtp.host`. The password is the userinfo. */
const CREDENTIALED_URI_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;

/** Absolute http(s) URLs. Trailing punctuation is excluded so prose survives around the URL. */
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Any JWT-shaped triple. Covers NextAuth session tokens and most OAuth id_tokens. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;

/**
 * Token shapes issued by the social platforms outbox publishes to (directly or through Ocoya /
 * SocialChamp), plus the generic vendor secret-key shape and long hex digests (our own HMAC
 * signatures, and hex API keys). Matched by shape, so an unlabelled token pasted into a log line or
 * an exception message is still caught.
 */
const VENDOR_TOKEN_RES: RegExp[] = [
  // Self-prefixed vendor keys: `ocoya_live_...`, `sc_tok_...`, `sk_live_...`, `xxx_api_...`.
  /\b[A-Za-z][A-Za-z0-9]{0,14}_(?:live|test|prod|sk|pk|tok|token|key|sec|secret|api)_?[A-Za-z0-9_-]{12,}/gi,
  /\bxox[abdeoprs]-[A-Za-z0-9-]{8,}/gi, // Slack bot/user/app tokens
  /\bEAA[A-Za-z0-9]{20,}/g, // Meta graph tokens (Facebook, Instagram, Threads)
  /\bya29\.[A-Za-z0-9._-]{10,}/g, // Google OAuth access token (YouTube)
  /\b1\/\/[A-Za-z0-9_-]{20,}/g, // Google OAuth refresh token
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bAAAAAAAAA[A-Za-z0-9%._-]{20,}/g, // X / Twitter app-only bearer
  /\bAQ[A-Za-z0-9_-]{40,}/g, // LinkedIn access token
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // generic vendor secret-key shape
  // A 24+ char run mixing upper, lower and digits is a token in this codebase, never prose. This is
  // the catch-all for an unlabelled key from a publisher we have not integrated yet.
  /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g,
  // HMAC signatures and hex API keys. Underscore/hyphen count as boundaries so a prefixed key
  // (`ocoya_live_<hex>`) still loses its hex tail even if the prefix rule above ever misses.
  /(?<![A-Za-z0-9_-])[0-9a-f]{32,}(?![A-Za-z0-9_-])/gi,
];

/**
 * `apiKey: abc123`, `"access_token":"abc123"`, `secret = abc123`. The separator is REQUIRED, so
 * prose like "the token expired" is left alone and only an actual value gets removed.
 */
const LABELLED_SECRET_RE =
  /\b(api[\s_-]?keys?|access[\s_-]?token|refresh[\s_-]?token|id[\s_-]?token|client[\s_-]?secret|auth[\s_-]?token|bearer[\s_-]?token|private[\s_-]?key|webhook[\s_-]?secret|token|secret|password|passwd|passphrase|passcode|signature|hmac|credential|pin|otp)\b["']?\s*(?:is|:|=>|=)\s*["']?([^\s"',;}\])&]{4,})/gi;

/** `Authorization: Bearer <token>` with no other separator to key off. */
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi;

/** A `?key=value` pair whose KEY names a secret. Catches relative URLs and bare query strings. */
const QUERY_SECRET_RE =
  /([?&][^=&\s]*(?:token|secret|key|sig|signature|auth|password|passwd|code|session|credential)[^=&\s]*=)([^&\s"'#]+)/gi;

/** A path segment that looks generated rather than authored. */
const TOKENISH_SEGMENT_RE = /^[A-Za-z0-9_-]{20,}$/;

/**
 * Object keys whose VALUE is a secret regardless of what it looks like. Applied to `extra`,
 * breadcrumb `data`, contexts and captured request headers.
 */
const SECRET_KEY_RE =
  /(authorization|cookie|token|secret|api[_-]?key|apikey|password|passwd|pwd|signature|hmac|credential|session|bearer|private[_-]?key|client[_-]?secret|access[_-]?key|dsn|conn(ection)?[_-]?string|database[_-]?url|ingest[_-]?sources|email)/i;

/**
 * Object keys that hold a REQUEST/RESPONSE BODY or the post payload itself. Dropped wholesale:
 * outbox bodies are signed webhooks and social copy, and neither is needed to read a stack trace.
 */
const BODY_KEY_RE =
  /^(body|raw[_-]?body|payload|request[_-]?body|response[_-]?body|content|caption|post[_-]?text|post[_-]?content|media[_-]?urls?|params|variables|input)$/i;

/** Headers that carry a credential or the caller's network identity. */
const SECRET_HEADER_RE =
  /(cookie|authorization|api[-_]?key|token|secret|signature|hmac|credential|x-forwarded-for|x-real-ip|x-vercel-forwarded-for|forwarded)/i;

/** Mask a URL down to origin + route. The query string ALWAYS goes: outbox query strings can carry
 *  the Apps Script bearer, and the route alone is what triage actually needs. */
function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname
      .split("/")
      .map((seg) => (TOKENISH_SEGMENT_RE.test(seg) ? "<token>" : seg))
      .join("/");
    return `${url.origin}${path}${url.search ? "?<redacted>" : ""}`;
  } catch {
    return REDACTED_URL;
  }
}

/**
 * Remove every secret-shaped thing from a free-text string.
 *
 * Order matters. Credentialed URIs go first so a password never survives into a later pass. URLs go
 * next, BEFORE any placeholder is inserted: `[redacted]` contains a bracket, and a placeholder
 * dropped mid-URL would otherwise cut the URL match short and leave a stray character behind. The
 * shaped tokens, the labelled forms and finally emails follow (an email inside a URL is already
 * gone by then).
 */
export function redactText(input: string): string {
  let out = input;

  out = out.replace(CREDENTIALED_URI_RE, (_m, scheme: string) => `${scheme}${REDACTED}:${REDACTED}@`);
  out = out.replace(URL_RE, (match) => maskUrl(match));
  out = out.replace(QUERY_SECRET_RE, (_m, key: string) => `${key}${REDACTED}`);
  out = out.replace(JWT_RE, REDACTED);
  for (const re of VENDOR_TOKEN_RES) out = out.replace(re, REDACTED);
  out = out.replace(BEARER_RE, `Bearer ${REDACTED}`);
  out = out.replace(LABELLED_SECRET_RE, (match, label: string, value: string) =>
    // Do not re-wrap a placeholder an earlier pass already inserted.
    value.startsWith(REDACTED_PREFIX) ? match : `${label}: ${REDACTED}`
  );
  out = out.replace(EMAIL_RE, REDACTED_EMAIL);

  return out;
}

const MAX_DEPTH = 6;

/** Recursively scrub an arbitrary attached value: strings by pattern, object entries by key. */
function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED; // too deep to reason about; do not ship it

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key) || BODY_KEY_RE.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = scrubValue(val, depth + 1);
  }
  return out;
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const next: Breadcrumb = { ...crumb };
  if (typeof next.message === "string") next.message = redactText(next.message);
  if (next.data) next.data = scrubValue(next.data) as Record<string, unknown>;
  return next;
}

/**
 * The `beforeSend` hook. Wired from sentry.server.config.ts, sentry.edge.config.ts and
 * instrumentation-client.ts, so every runtime gets the same pass.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = redactText(event.message);

  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redactText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) {
      // Local-variable capture would hand over whatever key was in scope at the throw site.
      delete frame.vars;
    }
  }

  // Never ship the operator identity or the caller's network origin.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  if (event.request) {
    if (typeof event.request.url === "string") event.request.url = redactText(event.request.url);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = redactText(event.request.query_string);
    }
    delete event.request.cookies;
    // The BODY: signed ingest payloads and post copy. Always dropped, never scrubbed-and-kept.
    delete event.request.data;
    const headers = event.request.headers as Record<string, string> | undefined;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SECRET_HEADER_RE.test(key)) delete headers[key];
        else if (typeof headers[key] === "string") headers[key] = redactText(headers[key]);
      }
    }
  }

  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);

  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;

  if (event.tags) {
    for (const [key, val] of Object.entries(event.tags)) {
      if (typeof val === "string") event.tags[key] = redactText(val);
    }
  }

  if (event.contexts) {
    for (const [name, ctx] of Object.entries(event.contexts)) {
      // `trace` holds the trace/span ids Sentry groups by; they are not secrets and the hex rule
      // would eat them.
      if (name === "trace" || !ctx) continue;
      event.contexts[name] = scrubValue(ctx) as Record<string, unknown>;
    }
  }

  return event;
}
