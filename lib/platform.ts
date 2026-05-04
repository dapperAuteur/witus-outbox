import type { Platform } from "@/lib/publishers/types";

/**
 * Maps the `[Platform]` title prefix used by the consultant's RADAAR CSV
 * to the canonical platform key the ingest contract accepts.
 *
 * Source: `gemini/witus/plans/social-media/consultant-response/she_clocked_in_radaar_import.csv`
 * Each row's `title` column starts with `[YouTube]`, `[LinkedIn]`,
 * `[Twitter/X]`, `[Facebook]`, `[Instagram]`, `[BlueSky]`, etc.
 *
 * Returns `null` for unknown prefixes — caller should reject the row
 * rather than guess.
 */
const PREFIX_MAP: Record<string, Platform> = {
  youtube: "youtube",
  yt: "youtube",
  linkedin: "linkedin",
  li: "linkedin",
  twitter: "twitter",
  "twitter/x": "twitter",
  x: "twitter",
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  ig: "instagram",
  bluesky: "bluesky",
  "blue sky": "bluesky",
  bsky: "bluesky",
  tiktok: "tiktok",
  "tik tok": "tiktok",
  pinterest: "pinterest",
  pin: "pinterest",
};

const PREFIX_RE = /^\s*\[([^\]]+)\]/;

export interface ParsedTitle {
  platform: Platform;
  rest: string;
}

export function parsePlatformPrefix(title: string): ParsedTitle | null {
  const match = title.match(PREFIX_RE);
  if (!match) return null;
  const raw = match[1].trim().toLowerCase();
  const platform = PREFIX_MAP[raw];
  if (!platform) return null;
  return { platform, rest: title.slice(match[0].length).trim() };
}
