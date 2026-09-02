/**
 * "Continue as <name>" — the silent ecosystem-SSO check behind the WitUS button on
 * `/auth/sign-in`, plus the URL derivations global sign-out needs.
 *
 * BAM chose this shape on 2026-08-30: render the sign-in form immediately exactly as it renders
 * today, ask the IdP who this browser is IN PARALLEL, and if an answer arrives relabel the
 * existing "Sign in with WitUS" button to "Continue as <name>". Not automatic — an automatic
 * redirect would put IdP latency on the common case (most people reaching a sign-in page are
 * signed in nowhere) and would make a redirect loop easy.
 *
 * WHY A CORS PROBE AND NOT OIDC `prompt=none`. `prompt=none` is a NAVIGATION: you leave the
 * sign-in page to ask, which is the automatic design BAM rejected, and the only way to ask
 * without leaving is a hidden iframe, which Safari's ITP blocks anyway. So we ask a dedicated
 * IdP endpoint over CORS while the form is already on screen.
 *
 * WHAT IT BUYS AND WHAT IT DOES NOT. The probe carries the IdP's cookie as a THIRD-PARTY cookie,
 * so it answers on Chrome/Edge and answers nothing under Safari ITP or Firefox Total Cookie
 * Protection. That is the design, not a bug: a probe that answers nothing renders nothing and the
 * visitor keeps the page they already had. A failed silent check is invisible.
 *
 * THE IDENTITY THIS RETURNS IS DISPLAY COPY, NEVER A CREDENTIAL. It arrives across an origin
 * boundary, so it is client-supplied by definition. It must never gate access, populate a
 * session, or be sent anywhere. Clicking the button runs the real NextAuth/OIDC code flow, which
 * is the only thing that establishes identity — and this app's `signIn` callback still rejects
 * anything whose email is not `ADMIN_EMAIL` (see lib/auth.ts).
 *
 * Pure helpers: no `server-only`, no `next/headers`, no `window` at module scope. lib/env.ts
 * (server) and components/WitusSsoButton.tsx (client) both import from here, and the tests import
 * these functions directly.
 */

/**
 * Discovery document this app points at when `WITUS_OIDC_DISCOVERY_URL` is unset. Single source
 * of truth: lib/auth.ts, lib/env.ts and the probe all derive from this one string rather than
 * naming accounts.witus.online in several places (authoritative-values rule).
 */
export const WITUS_OIDC_DISCOVERY_FALLBACK =
  "https://accounts.witus.online/api/idp/.well-known/openid-configuration";

/** Query param marking "this browser already tried the ecosystem flow". Accepts `?sso=tried`. */
export const SSO_ATTEMPT_PARAM = "sso";
export const SSO_ATTEMPT_VALUE = "tried";

/**
 * sessionStorage key for the same marker. Written IMMEDIATELY BEFORE we send the browser to the
 * IdP, never after it comes back: a marker written on return never exists when the return is the
 * thing that failed.
 */
export const SSO_ATTEMPT_STORAGE_KEY = "witus.sso.attempted";

/** How long to wait for the probe. A silent check that hangs is a broken page. */
export const SILENT_SSO_TIMEOUT_MS = 4000;

/** Longest display name we render. Caps a hostile or absurd value from blowing up the button. */
const MAX_LABEL_LENGTH = 48;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Identity shown on the button. Display only, never a credential. */
export interface SsoIdentity {
  /** What "Continue as ___" says. Already de-controlled, trimmed and length-capped. */
  label: string;
}

export type SilentSsoSkip = "not-configured" | "already-attempted" | "already-signed-in";

export type SilentSsoDecision = { attempt: true } | { attempt: false; skip: SilentSsoSkip };

/**
 * Should this browser ask the IdP who it is?
 *
 * `endpoint` is resolved on the SERVER (lib/env.ts `witusSilentSsoEndpoint`) and is `null` unless
 * `WITUS_OIDC_CLIENT_ID` is set, so the whole feature stays dark on an app that is not a
 * configured ecosystem OIDC client. An affordance the visitor cannot complete is worse than none.
 *
 * Outbox is single-tenant on one host (outbox.witus.online) with no white-label surface, so there
 * is no per-tenant gate here — unlike learn.witus.online, where a customer-branded host must
 * never touch the shared IdP at all.
 */
export function silentSsoDecision(input: {
  endpoint: string | null | undefined;
  search?: string | null;
  attempted?: boolean;
  signedIn?: boolean;
}): SilentSsoDecision {
  if (!input.endpoint) return { attempt: false, skip: "not-configured" };
  if (input.signedIn) return { attempt: false, skip: "already-signed-in" };
  if (input.attempted || hasAttemptMarker(input.search)) {
    return { attempt: false, skip: "already-attempted" };
  }
  return { attempt: true };
}

/** Does this query string carry the one-shot marker? Accepts "?a=b" or "a=b". */
export function hasAttemptMarker(search: string | null | undefined): boolean {
  if (typeof search !== "string" || search === "") return false;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  return params.get(SSO_ATTEMPT_PARAM) === SSO_ATTEMPT_VALUE;
}

/**
 * Split a discovery URL into the IdP's origin and its better-auth basePath.
 *
 *   https://accounts.witus.online/api/idp/.well-known/openid-configuration
 *     -> { origin: "https://accounts.witus.online", basePath: "/api/idp" }
 *
 * Everything below derives from this, so the only external value this app asserts stays the
 * discovery URL it is already configured with.
 */
function splitDiscoveryUrl(
  discoveryUrl: string | null | undefined
): { origin: string; basePath: string } | null {
  if (!discoveryUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(discoveryUrl);
  } catch {
    return null;
  }
  const cut = parsed.pathname.indexOf("/.well-known/");
  if (cut < 0) return null;
  return { origin: parsed.origin, basePath: parsed.pathname.slice(0, cut) };
}

/**
 * The IdP's RP-initiated logout endpoint, `<basePath>/oauth2/endsession` — the
 * `end_session_endpoint` the live discovery document advertises.
 *
 * BAM chose GLOBAL sign-out on 2026-08-30: "signout signs out of every app". Ending only the
 * local session leaves the IdP session alive, which once "Continue as <name>" is live means
 * signing out and coming back offers to sign you straight back in — a logout that reads as broken.
 */
export function endSessionEndpointFromDiscovery(
  discoveryUrl: string | null | undefined
): string | null {
  const parts = splitDiscoveryUrl(discoveryUrl);
  if (!parts) return null;
  return `${parts.origin}${parts.basePath}/oauth2/endsession`;
}

/**
 * The ecosystem session probe: `<idp-origin>/api/ecosystem/session`.
 *
 * NOT the IdP's better-auth `/get-session`, which sends no CORS headers and must never get them:
 * it returns the full `{ session, user }` and `session` carries the SESSION TOKEN, so credentialed
 * CORS there would let any ecosystem origin — or an XSS on one of them — lift a live IdP session.
 * `/api/ecosystem/session` is the purpose-built replacement in gemini/witus: same cookie, but it
 * answers `{ signedIn, user: { name } }` and nothing else, with an allow-origin list derived from
 * the IdP's own client registry (outbox.witus.online is registered there).
 */
export function silentSsoEndpointFromDiscovery(
  discoveryUrl: string | null | undefined
): string | null {
  const parts = splitDiscoveryUrl(discoveryUrl);
  if (!parts) return null;
  return `${parts.origin}/api/ecosystem/session`;
}

/**
 * Read a display name out of the probe response. Handles `{ signedIn, user: { name } }`, a bare
 * user object, and the signed-out answer. Anything else yields null, which renders nothing.
 */
export function parseSilentSsoIdentity(payload: unknown): SsoIdentity | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  if (root.signedIn === false) return null;
  const candidate =
    root.user && typeof root.user === "object"
      ? (root.user as Record<string, unknown>)
      : root;
  const label = cleanLabel(candidate.name) ?? cleanLabel(candidate.email);
  return label ? { label } : null;
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, "").trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_LABEL_LENGTH
    ? `${cleaned.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

/** Button copy. Kept here so the test pins the exact string the visitor reads. */
export function continueAsLabel(identity: SsoIdentity | null): string {
  return identity ? `Continue as ${identity.label}` : "Sign in with WitUS";
}

/**
 * The full RP-initiated logout URL, including where the IdP sends the browser back.
 *
 * `client_id` is REQUIRED, not optional: better-auth rejects a `post_logout_redirect_uri` with
 * `invalid_request` unless the request carries a verifiable `id_token_hint` or an explicit
 * `client_id`, and we have no id_token client-side.
 *
 * The TRAILING SLASH on `post_logout_redirect_uri` is required too. better-auth exact-matches it
 * against the client's registered redirectUrls, and the IdP registry
 * (gemini/witus lib/identity/clients.ts, `postLogoutRedirectUriFor`) registers `origin + "/"` —
 * for this app, `https://outbox.witus.online/`. Drop the slash and the IdP returns a 400.
 */
export function endSessionUrlWithRedirect(
  endSessionUrl: string,
  appOrigin: string
): string {
  const back = `${appOrigin.replace(/\/+$/, "")}/`;
  const separator = endSessionUrl.includes("?") ? "&" : "?";
  return `${endSessionUrl}${separator}post_logout_redirect_uri=${encodeURIComponent(back)}`;
}
