/**
 * Maps outbox `scheduled_post` rows into the RADAAR bulk-import CSV format.
 *
 * Reference template:
 *   plans/validate/RADAAR-PUBLISHING-BULK-IMPORT-CSV - Sheet1 (1).csv
 *
 * RADAAR columns: date, type, title, caption, medias, links, comments, status
 * - `date`: "YYYY-MM-DD HH:MM" (RADAAR interprets in the workspace's
 *   configured timezone; we emit UTC so the operator picks "UTC" at upload).
 * - `type`: SINGLE_IMAGE | VIDEO | CAROUSEL | PHOTO_ALBUM | LINK | TEXT |
 *   REEL | STORY. Inferred from media count + extensions; REEL/STORY can't
 *   be inferred without platform hints, so we never emit those — operator
 *   can hand-edit if needed.
 * - `title`: outbox doesn't have a title column, so we synthesize from
 *   "[Platform] " + first 60 chars of caption.
 * - `medias`: newline-separated URLs (RADAAR's CAROUSEL/PHOTO_ALBUM rows
 *   in the template use embedded newlines inside the CSV cell).
 * - `links`: newline-separated URLs.
 * - `comments`: pipe-separated. Outbox doesn't track first-comments today;
 *   always empty.
 * - `status`: DRAFT (so RADAAR doesn't auto-publish on import — operator
 *   confirms in RADAAR's UI before going live).
 *
 * RADAAR's import has no platform/account column. The operator picks
 * target accounts at upload time. If the operator wants to upload one
 * CSV per platform, they pre-filter rows via the export's `?platform=`
 * query param.
 */

export interface OutboxRowForExport {
  source: string;
  draftId: string;
  platform: string;
  caption: string;
  /** Stored as jsonb; may be string[] or other shapes. */
  mediaUrls: unknown;
  links: unknown;
  scheduledAt: Date;
  status: string;
}

const RADAAR_HEADER = [
  "date",
  "type",
  "title",
  "caption",
  "medias",
  "links",
  "comments",
  "status",
] as const;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|bmp)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)(?:[?#].*)?$/i;

/** Returns the full CSV bytes (with BOM-less header line). */
export function exportToRadaarCsv(rows: OutboxRowForExport[]): string {
  const lines: string[] = [RADAAR_HEADER.join(",")];
  for (const row of rows) {
    lines.push(rowToCsvLine(row));
  }
  return lines.join("\n") + "\n";
}

function rowToCsvLine(row: OutboxRowForExport): string {
  const medias = asStringArray(row.mediaUrls);
  const links = asStringArray(row.links);
  return [
    csvField(formatDate(row.scheduledAt)),
    csvField(inferType(medias, links)),
    csvField(synthesizeTitle(row.platform, row.caption)),
    csvField(row.caption),
    csvField(joinNewlines(medias)),
    csvField(joinNewlines(links)),
    csvField(""),
    csvField("DRAFT"),
  ].join(",");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * `YYYY-MM-DD HH:MM` in UTC (no timezone marker — operator picks UTC at
 * upload). Same shape as the template's first column.
 */
function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Maps media + link counts to RADAAR's `type` enum. We emit only the
 * unambiguous types — REEL/STORY require platform hints and aren't
 * inferable from outbox data alone.
 */
export function inferType(medias: string[], links: string[]): string {
  if (medias.length === 0) {
    return links.length > 0 ? "LINK" : "TEXT";
  }
  if (medias.length === 1) {
    const url = medias[0];
    if (VIDEO_EXT.test(url)) return "VIDEO";
    if (links.length > 0) return "LINK";
    return "SINGLE_IMAGE";
  }
  // Multiple media. CAROUSEL is IG-specific; PHOTO_ALBUM is the generic
  // multi-image type per the template. Defaulting to PHOTO_ALBUM —
  // operator can hand-edit individual rows to CAROUSEL if needed for IG.
  if (medias.every((u) => IMAGE_EXT.test(u))) return "PHOTO_ALBUM";
  // Mixed media or videos — no perfect fit; fall back to PHOTO_ALBUM and
  // let the operator hand-edit. Avoid emitting REEL/STORY blindly.
  return "PHOTO_ALBUM";
}

/**
 * Outbox doesn't carry a title column. RADAAR uses title for the human
 * triage label inside its dashboard. We prepend `[Platform]` so the
 * operator can scan a long CSV by network at a glance — same convention
 * the consultant's import CSV uses.
 */
function synthesizeTitle(platform: string, caption: string): string {
  const prefix = platformPrefix(platform);
  const head = caption.split(/\s+/).slice(0, 8).join(" ");
  const trimmed = head.length <= 60 ? head : head.slice(0, 60).replace(/\s+\S*$/, "");
  return `${prefix} ${trimmed}`.trim();
}

const PLATFORM_PREFIX: Record<string, string> = {
  twitter: "[Twitter]",
  instagram: "[Instagram]",
  facebook: "[Facebook]",
  linkedin: "[LinkedIn]",
  youtube: "[YouTube]",
  bluesky: "[BlueSky]",
  tiktok: "[TikTok]",
  pinterest: "[Pinterest]",
};
function platformPrefix(platform: string): string {
  return PLATFORM_PREFIX[platform] ?? `[${platform}]`;
}

function joinNewlines(values: string[]): string {
  return values.join("\n");
}

/** RFC-4180 CSV escape: quote if the field contains "/,/CR/LF, double inner quotes. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
