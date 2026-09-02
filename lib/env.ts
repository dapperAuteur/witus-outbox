import "server-only";
import { z } from "zod";
import {
  WITUS_OIDC_DISCOVERY_FALLBACK,
  endSessionEndpointFromDiscovery,
  silentSsoEndpointFromDiscovery,
} from "@/lib/silent-sso";

const EnvSchema = z.object({
  STORAGE_DATABASE_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  // NextAuth v4 falls back to VERCEL_URL on Vercel preview/prod when this is
  // unset, and to the request origin in local dev. Set explicitly in
  // Production.
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(16),
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z
    .string()
    .min(3)
    .refine(
      (v) =>
        /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) ||
        /<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>\s*$/.test(v),
      'Must be "addr@host" or "Name <addr@host>"'
    ),
  ALERT_EMAIL: z.string().email().optional(),
  INGEST_SOURCES: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MOBILE_TEXT_ALERTS_API_KEY: z.string().optional(),
  MOBILE_TEXT_ALERTS_RECIPIENTS: z.string().optional(),
  PUBLISHER_BACKEND: z.string().default("ocoya"),
  OCOYA_API_KEY: z.string().optional(),
  // JSON array of {name, id} entries. Symbolic name lets INGEST_SOURCES
  // entries reference workspaces by name even if the underlying Ocoya ID
  // changes. Parsed by lib/workspaces.ts. See .env.example for shape.
  OCOYA_WORKSPACE_IDS: z.string().optional(),
  // SocialChamp API bearer token. Read by lib/publishers/socialchamp.ts.
  // Optional in local/preview — adapter dev-logs when missing.
  SOCIAL_CHAMP_API_KEY: z.string().optional(),
  // Bearer token shared between admin CLIs (e.g. scripts/sync-social-profiles.ts)
  // and the future Apps Script reconciler. Distinct from any publisher's
  // INGEST_SOURCES secret. ≥32 chars in production.
  APPS_SCRIPT_TOKEN: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazy env getter. Validates on first call so Next build-time analysis does
 * not trip on missing values. Every consumer should call `getEnv()` inside
 * a request handler or server function, never at module top-level.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Where the sign-in page's silent "Continue as <name>" check asks the WitUS IdP who this browser
 * is. `null` — the feature stays completely dark — unless this app is a configured ecosystem OIDC
 * client, because an affordance the visitor cannot complete is worse than no affordance.
 *
 * Read as a function, not a module const, for the same reason `getEnv()` is lazy: nothing in this
 * repo may touch `process.env` at import time. The URL is DERIVED from the discovery document this
 * app already points at, so nothing new about accounts.witus.online is asserted here. See
 * lib/silent-sso.ts for the whole design.
 */
export function witusSilentSsoEndpoint(): string | null {
  if (!process.env.WITUS_OIDC_CLIENT_ID) return null;
  return silentSsoEndpointFromDiscovery(
    process.env.WITUS_OIDC_DISCOVERY_URL ?? WITUS_OIDC_DISCOVERY_FALLBACK
  );
}

/**
 * Where sign-out ends the SHARED WitUS session (BAM's decision, 2026-08-30: signing out of one
 * WitUS app signs you out of all of them). `null` when this app is not a configured ecosystem
 * OIDC client — there is no shared session to end and sign-out stays purely local.
 *
 * `client_id` is baked in HERE, on the server, because SignOutButton is a client component and
 * must never be handed the raw env. It is REQUIRED, not optional: better-auth's endSession
 * endpoint rejects a `post_logout_redirect_uri` with `invalid_request` unless the request carries
 * a verifiable `id_token_hint` or an explicit `client_id`, and we have no id_token client-side.
 */
export function witusEndSessionEndpoint(): string | null {
  const clientId = process.env.WITUS_OIDC_CLIENT_ID;
  if (!clientId) return null;
  const base = endSessionEndpointFromDiscovery(
    process.env.WITUS_OIDC_DISCOVERY_URL ?? WITUS_OIDC_DISCOVERY_FALLBACK
  );
  if (!base) return null;
  return `${base}?client_id=${encodeURIComponent(clientId)}`;
}
