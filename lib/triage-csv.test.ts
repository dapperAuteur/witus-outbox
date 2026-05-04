import { describe, expect, it } from "vitest";
import { exportToTriageCsv, type TriageCsvRow } from "./triage-csv";

const baseRow: TriageCsvRow = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "queued",
  scheduledAt: new Date("2026-05-12T14:00:00Z"),
  platform: "twitter",
  source: "centenarianos",
  publisherBackend: "ocoya",
  publisherPostId: null,
  caption: "Hello, world",
  mediaUrls: [],
  draftId: "ep-12-quote",
  createdAt: new Date("2026-05-04T10:00:00Z"),
  lastPolledAt: null,
  publisherErrorDetail: null,
};

function parseLines(csv: string): string[][] {
  return csv
    .replace(/\r\n$/, "")
    .split("\r\n")
    .map((line) => splitCsvLine(line));
}

// Lightweight CSV line splitter for tests — handles quoted fields with
// embedded commas / quotes / newlines. Not a full RFC-4180 parser; good
// enough for assertion shapes here.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

describe("exportToTriageCsv", () => {
  it("emits header row + one data row", () => {
    const csv = exportToTriageCsv([baseRow]);
    const lines = parseLines(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
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
    ]);
    expect(lines[1][0]).toBe(baseRow.id);
    expect(lines[1][2]).toBe("2026-05-12T14:00:00.000Z");
  });

  it("escapes commas, quotes, and newlines per RFC-4180", () => {
    const tricky: TriageCsvRow = {
      ...baseRow,
      caption: 'Hello, "world"\nNew line here',
    };
    const csv = exportToTriageCsv([tricky]);
    const lines = parseLines(csv);
    // After parsing through the test splitter, commas and quotes should
    // come back unescaped — that proves they round-trip cleanly.
    expect(lines[1][7]).toBe('Hello, "world"\nNew line here');
    // Sanity-check the raw bytes contain the doubled quote.
    expect(csv).toContain('""world""');
  });

  it("truncates captions over 120 chars (PII guard)", () => {
    const long = "x".repeat(200);
    const csv = exportToTriageCsv([{ ...baseRow, caption: long }]);
    const lines = parseLines(csv);
    expect(lines[1][7].length).toBeLessThanOrEqual(121); // 120 + …
    expect(lines[1][7].endsWith("…")).toBe(true);
  });

  it("emits media_url_count, never the URLs themselves (PII guard)", () => {
    const csv = exportToTriageCsv([
      {
        ...baseRow,
        mediaUrls: [
          "https://cdn.example.com/secret-1.png",
          "https://cdn.example.com/secret-2.png",
        ],
      },
    ]);
    expect(csv).not.toContain("https://cdn.example.com");
    expect(csv).not.toContain("secret-1");
    const lines = parseLines(csv);
    expect(lines[1][8]).toBe("2");
  });

  it("counts non-array mediaUrls as 0", () => {
    const csv = exportToTriageCsv([
      { ...baseRow, mediaUrls: null },
      { ...baseRow, mediaUrls: "not-an-array" },
      { ...baseRow, mediaUrls: { weird: "shape" } },
    ]);
    const lines = parseLines(csv);
    expect(lines[1][8]).toBe("0");
    expect(lines[2][8]).toBe("0");
    expect(lines[3][8]).toBe("0");
  });

  it("summarizes publisher_error_detail without leaking caption echo", () => {
    const errorWithEcho = {
      code: "rate_limited",
      message: "Too many requests for caption: 'My private post text'",
      original_request: { caption: "My private post text" },
    };
    const csv = exportToTriageCsv([
      { ...baseRow, status: "error", publisherErrorDetail: errorWithEcho },
    ]);
    const lines = parseLines(csv);
    expect(lines[1][12]).toBe("rate_limited");
    // Caption echo from the error body must not leak.
    expect(csv).not.toContain("My private post text");
  });

  it("falls through error_summary keys: code → error → name → status", () => {
    const csv = exportToTriageCsv([
      { ...baseRow, publisherErrorDetail: { error: "auth_failed" } },
      { ...baseRow, publisherErrorDetail: { name: "FetchError" } },
      { ...baseRow, publisherErrorDetail: { status: 503 } },
      { ...baseRow, publisherErrorDetail: {} },
    ]);
    const lines = parseLines(csv);
    expect(lines[1][12]).toBe("auth_failed");
    expect(lines[2][12]).toBe("FetchError");
    expect(lines[3][12]).toBe("503");
    expect(lines[4][12]).toBe("error");
  });

  it("formats nullable fields as empty strings", () => {
    const csv = exportToTriageCsv([baseRow]);
    const lines = parseLines(csv);
    expect(lines[1][6]).toBe(""); // publisher_post_id
    expect(lines[1][11]).toBe(""); // last_polled_at
    expect(lines[1][12]).toBe(""); // error_summary (publisherErrorDetail null)
  });

  it("terminates with CRLF per RFC-4180", () => {
    const csv = exportToTriageCsv([baseRow]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("handles empty input as headers-only", () => {
    const csv = exportToTriageCsv([]);
    expect(csv).toBe(
      "id,status,scheduled_at,platform,source,publisher_backend,publisher_post_id,caption_first_120_chars,media_url_count,external_ref,created_at,last_polled_at,error_summary\r\n"
    );
  });
});
