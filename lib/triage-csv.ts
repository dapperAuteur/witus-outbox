import "server-only";
import { truncateCaption } from "@/lib/format";

/**
 * Row shape the triage CSV exporter consumes. Each field maps 1:1 to a
 * column in the output. Keep PII fields (caption, mediaUrls) as their
 * actual stored values — the export pipeline truncates / counts them
 * before emitting per charter §3.
 */
export interface TriageCsvRow {
  id: string;
  status: string;
  scheduledAt: Date;
  platform: string;
  source: string;
  publisherBackend: string;
  publisherPostId: string | null;
  caption: string;
  /** jsonb — array of strings expected, but tolerate other shapes. */
  mediaUrls: unknown;
  draftId: string;
  createdAt: Date;
  lastPolledAt: Date | null;
  /** jsonb — first error code/name surfaced to the operator, no full payload. */
  publisherErrorDetail: unknown;
}

const HEADERS = [
  "id",
  "status",
  "scheduled_at",
  "platform",
  "source",
  "publisher_backend",
  "publisher_post_id",
  "caption_first_120_chars",
  "media_url_count",
  "external_ref",
  "created_at",
  "last_polled_at",
  "error_summary",
] as const;

/**
 * Render rows as RFC-4180 CSV. Charter §3 PII guards applied:
 *   - `caption` truncated to 120 chars (matches the operator's UI view).
 *   - `media_urls` reduced to a count — actual URLs never leave the row.
 *   - `publisher_error_detail` (jsonb) surfaced only as a short summary
 *     (top-level `code` or `error` field), never the full payload which
 *     can include the publisher's verbatim caption echo.
 */
export function exportToTriageCsv(rows: TriageCsvRow[]): string {
  const lines: string[] = [HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.status,
        row.scheduledAt.toISOString(),
        row.platform,
        row.source,
        row.publisherBackend,
        row.publisherPostId ?? "",
        truncateCaption(row.caption, 120),
        countMedia(row.mediaUrls).toString(),
        row.draftId,
        row.createdAt.toISOString(),
        row.lastPolledAt ? row.lastPolledAt.toISOString() : "",
        summarizeError(row.publisherErrorDetail),
      ]
        .map(csvField)
        .join(",")
    );
  }
  // RFC-4180 terminates lines with CRLF. Most consumers accept LF but the
  // spec is explicit; match the radaar/socialchamp exporters' behavior.
  return `${lines.join("\r\n")}\r\n`;
}

function countMedia(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return 0;
}

/**
 * Pull the first useful identifier out of `publisher_error_detail`. Avoids
 * leaking the full vendor response which can include the caption verbatim
 * (Ocoya echoes the post text in some 4xx bodies).
 */
function summarizeError(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  for (const key of ["code", "error", "name", "status"]) {
    const got = v[key];
    if (typeof got === "string" && got.length > 0) return got.slice(0, 80);
    if (typeof got === "number") return String(got);
  }
  return "error";
}

/** RFC-4180 CSV escape: quote if the field contains "/,/CR/LF, double inner quotes. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
