/**
 * Maps outbox `scheduled_post` rows into SocialChamp's bulk-uploader CSV
 * formats. SocialChamp ships TWO templates rather than RADAAR's universal
 * one:
 *   - universal: every network EXCEPT YouTube
 *   - youtube:   YouTube-only (VIDEO/SHORTS distinction + per-channel
 *                privacy/license/etc. settings)
 *
 * Reference templates:
 *   plans/validate/SocialChamp-Bulk_Uploader_Template.csv          (universal)
 *   plans/validate/SocialChamp-Bulk_Uploader_YouTube_Template.csv  (YT)
 *
 * Both templates use separate Year / Month / Date / Hour / Minutes
 * columns with no timezone marker. We emit UTC values; the operator
 * picks UTC at upload (or accepts whatever timezone SocialChamp's UI
 * defaults to for their workspace).
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

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|bmp)(?:[?#].*)?$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)(?:[?#].*)?$/i;

const UNIVERSAL_HEADER = [
  "Labels",
  "Text",
  "Link",
  "Year",
  "Month (1 to 12)",
  "Date",
  "Hour (From 0 to 23)",
  "Minutes",
  "Queue Schedule",
  "Video Title",
  "Post Type",
  "Image URL",
  "Alt Texts",
  "Video URL",
  "No. of Repetitions (From 1-10 OR 'FOREVER')",
  "Time Gap between Repetitions (Hours: From 1-24 OR 'WEEKLY' OR 'MONTHLY' OR 'YEARLY')",
  "Google Business Profile Type",
  "Google Business Profile URL",
  "Pinterest Title",
  "Pinterest Link",
  "Instagram First Comment",
  "Facebook First Comment",
  "LinkedIn First Comment",
  "TikTok First Comment",
  "Document URL",
  "Document Title",
] as const;

const YOUTUBE_HEADER = [
  "Labels",
  "Text",
  "Year",
  "Month (1 to 12)",
  "Date",
  "Hour (From 0 to 23)",
  "Minutes",
  "Queue Schedule",
  "Post Type",
  "Video Title",
  "Video URL",
  "Thumbnail URL",
  "Subtitles URL",
  "Subtitles Language",
  "Subtitles Auto-Sync",
  "Privacy Status",
  "Category",
  "Playlist",
  "Tags",
  "License",
  "Embeddable",
  "Notify Subscribers",
  "Made For Kids",
] as const;

/** Universal template — every network except YouTube. */
export function exportToSocialChampUniversalCsv(
  rows: OutboxRowForExport[]
): string {
  const lines: string[] = [UNIVERSAL_HEADER.map(csvField).join(",")];
  for (const row of rows) {
    const medias = asStringArray(row.mediaUrls);
    const links = asStringArray(row.links);
    const dt = utcParts(row.scheduledAt);
    const { imageUrls, videoUrls } = splitMedia(medias);

    lines.push(
      [
        "", // Labels
        row.caption, // Text
        links[0] ?? "", // Link
        String(dt.year),
        String(dt.month),
        String(dt.day),
        String(dt.hour),
        String(dt.minute),
        "", // Queue Schedule (empty = use date columns)
        "", // Video Title
        "", // Post Type (empty = SC infers)
        imageUrls[0] ?? "",
        "", // Alt Texts
        videoUrls[0] ?? "",
        "", // No. of Repetitions
        "", // Time Gap
        "", // Google Business Profile Type
        "", // Google Business Profile URL
        "", // Pinterest Title
        "", // Pinterest Link
        "", // Instagram First Comment
        "", // Facebook First Comment
        "", // LinkedIn First Comment
        "", // TikTok First Comment
        "", // Document URL
        "", // Document Title
      ]
        .map(csvField)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

/** YouTube template — only emits VIDEO type by default; SHORTS would
 *  need per-row aspect/duration info we don't have. */
export function exportToSocialChampYouTubeCsv(
  rows: OutboxRowForExport[]
): string {
  const lines: string[] = [YOUTUBE_HEADER.map(csvField).join(",")];
  for (const row of rows) {
    const medias = asStringArray(row.mediaUrls);
    const dt = utcParts(row.scheduledAt);
    const videoUrl = medias.find((m) => VIDEO_EXT.test(m)) ?? medias[0] ?? "";

    lines.push(
      [
        "", // Labels
        row.caption, // Text
        String(dt.year),
        String(dt.month),
        String(dt.day),
        String(dt.hour),
        String(dt.minute),
        "", // Queue Schedule
        "VIDEO", // Post Type — SHORTS requires aspect/duration we don't track
        synthesizeYouTubeTitle(row.caption),
        videoUrl,
        "", // Thumbnail URL
        "", // Subtitles URL
        "", // Subtitles Language
        "", // Subtitles Auto-Sync
        "PUBLIC", // Privacy Status — operator-overridable in SC UI
        "", // Category
        "", // Playlist
        "", // Tags
        "YOUTUBE", // License
        "Yes", // Embeddable
        "Yes", // Notify Subscribers
        "No", // Made For Kids — conservative; SC's COPPA flag
      ]
        .map(csvField)
        .join(",")
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * SocialChamp's YT template requires a Video Title (separate from the
 * post Text). Outbox rows only have a caption. Synthesize a ≤60-char
 * title at a word boundary so the column isn't blank.
 */
function synthesizeYouTubeTitle(caption: string): string {
  const head = caption.replace(/\s+/g, " ").trim();
  if (head.length <= 60) return head;
  const sliced = head.slice(0, 60);
  const lastSpace = sliced.lastIndexOf(" ");
  return lastSpace > 30 ? sliced.slice(0, lastSpace) : sliced;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
}

function splitMedia(mediaUrls: string[]): {
  imageUrls: string[];
  videoUrls: string[];
} {
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  for (const url of mediaUrls) {
    if (VIDEO_EXT.test(url)) videoUrls.push(url);
    else if (IMAGE_EXT.test(url)) imageUrls.push(url);
    else imageUrls.push(url);
  }
  return { imageUrls, videoUrls };
}

interface UtcParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function utcParts(d: Date): UtcParts {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** RFC-4180 CSV escape: quote fields containing ", , CR, or LF. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
