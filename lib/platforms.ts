import type { Platform } from "@/lib/publishers/types";

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

export function platformLabel(network: string): string {
  if (network in PLATFORM_LABELS) {
    return PLATFORM_LABELS[network as Platform];
  }
  // Unknown platform (e.g., a future Ocoya network) — title-case the raw key.
  if (network.length === 0) return "";
  return network.charAt(0).toUpperCase() + network.slice(1);
}
