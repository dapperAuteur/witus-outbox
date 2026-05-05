/**
 * Canonical platform keys (slice 31 — relocated from lib/publishers/types.ts
 * so client components can import without dragging in the server-only
 * module graph). lib/publishers/types re-exports for back-compat.
 *
 * The DB stores the lowercase form; the publisher adapters' normalize
 * functions map vendor-specific labels (e.g. SocialChamp's `FB_PAGE`)
 * onto these.
 */
export const PLATFORMS = [
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "tiktok",
  "pinterest",
] as const;

export type Platform = (typeof PLATFORMS)[number];

/**
 * Human-friendly labels for the canonical platform keys. The DB stores
 * the lowercase form (matches the Platform enum and the ingest contract
 * for stable lookup). UI surfaces should call {@link platformLabel} so
 * the operator sees "Twitter / X" instead of "twitter".
 */
const PLATFORM_LABELS: Record<Platform, string> = {
  twitter: "Twitter / X",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  bluesky: "Bluesky",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

/**
 * Soft char limits per platform (slice 31). Used by the in-outbox composer
 * to surface live "over limit" warnings as the operator types — these are
 * NOT enforced server-side. Each vendor sets its own limit and they shift
 * over time; outbox shouldn't try to be the source of truth for "what
 * Twitter rejects this week." The composer surfaces the limit; the
 * operator decides whether to override.
 *
 * Numbers reflect documented limits as of 2026-05. Update when vendors
 * change them; nothing else in the codebase reads these.
 */
export const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  bluesky: 300,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  pinterest: 500,
  facebook: 63206,
  youtube: 5000,
};

export function platformLabel(network: string): string {
  if (network in PLATFORM_LABELS) {
    return PLATFORM_LABELS[network as Platform];
  }
  // Unknown platform (e.g., a future Ocoya network) — title-case the raw key.
  if (network.length === 0) return "";
  return network.charAt(0).toUpperCase() + network.slice(1);
}
