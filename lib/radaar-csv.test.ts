import { describe, expect, it } from "vitest";
import {
  exportToRadaarCsv,
  inferType,
  type OutboxRowForExport,
} from "./radaar-csv";

const baseRow: OutboxRowForExport = {
  source: "radaar-csv-import",
  draftId: "abc123",
  platform: "facebook",
  caption: "Hello world",
  mediaUrls: [],
  links: [],
  scheduledAt: new Date("2026-12-01T15:30:00Z"),
  status: "queued",
};

describe("inferType", () => {
  it("returns TEXT when no media and no link", () => {
    expect(inferType([], [])).toBe("TEXT");
  });
  it("returns LINK when no media but has links", () => {
    expect(inferType([], ["https://example.com"])).toBe("LINK");
  });
  it("returns SINGLE_IMAGE for one image", () => {
    expect(inferType(["https://x.com/a.png"], [])).toBe("SINGLE_IMAGE");
  });
  it("returns VIDEO for one video", () => {
    expect(inferType(["https://x.com/a.mp4"], [])).toBe("VIDEO");
  });
  it("returns LINK for one image + link (link wins over SINGLE_IMAGE)", () => {
    expect(inferType(["https://x.com/a.png"], ["https://example.com"])).toBe(
      "LINK"
    );
  });
  it("returns PHOTO_ALBUM for multiple images", () => {
    expect(
      inferType(
        ["https://x.com/a.png", "https://x.com/b.jpg", "https://x.com/c.webp"],
        []
      )
    ).toBe("PHOTO_ALBUM");
  });
  it("falls back to PHOTO_ALBUM for mixed media", () => {
    expect(
      inferType(["https://x.com/a.png", "https://x.com/b.mp4"], [])
    ).toBe("PHOTO_ALBUM");
  });
  it("strips query strings before extension matching", () => {
    expect(inferType(["https://cdn.example.com/x.png?v=1"], [])).toBe(
      "SINGLE_IMAGE"
    );
    expect(inferType(["https://cdn.example.com/v.mp4#t=10"], [])).toBe("VIDEO");
  });
});

describe("exportToRadaarCsv", () => {
  it("emits the canonical 8-column header", () => {
    const csv = exportToRadaarCsv([]);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toBe("date,type,title,caption,medias,links,comments,status");
  });

  it("emits a TEXT row with synthesized title and DRAFT status", () => {
    const csv = exportToRadaarCsv([
      { ...baseRow, platform: "linkedin", caption: "Short post" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      "2026-12-01 15:30,TEXT,[LinkedIn] Short post,Short post,,,,DRAFT"
    );
  });

  it("escapes captions with commas and quotes per RFC-4180", () => {
    const csv = exportToRadaarCsv([
      {
        ...baseRow,
        caption: 'She said "hi", and waved',
      },
    ]);
    const line = csv.trim().split("\n")[1];
    // The caption field must be quoted with internal "" doubling.
    expect(line).toContain(',"She said ""hi"", and waved",');
  });

  it("emits multi-line medias inside one CSV cell for PHOTO_ALBUM rows", () => {
    const row: OutboxRowForExport = {
      ...baseRow,
      mediaUrls: [
        "https://cdn.example.com/a.png",
        "https://cdn.example.com/b.png",
      ],
      caption: "Two pics",
    };
    const csv = exportToRadaarCsv([row]);
    const text = csv.trim();
    // The medias field carries an embedded newline → the cell must be quoted.
    expect(text).toContain(
      '"https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png"'
    );
    // The type for multi-image is PHOTO_ALBUM.
    expect(text).toContain(",PHOTO_ALBUM,");
  });

  it("emits scheduled time as UTC YYYY-MM-DD HH:MM (no offset)", () => {
    const csv = exportToRadaarCsv([
      { ...baseRow, scheduledAt: new Date(Date.UTC(2026, 4, 5, 8, 0)) },
    ]);
    const line = csv.trim().split("\n")[1];
    expect(line).toMatch(/^2026-05-05 08:00,/);
  });

  it("uses the platform prefix in the synthesized title", () => {
    const csv = exportToRadaarCsv([
      { ...baseRow, platform: "twitter", caption: "Tweet body" },
    ]);
    const line = csv.trim().split("\n")[1];
    expect(line).toContain(",[Twitter] Tweet body,");
  });

  it("falls back to a [platform] prefix for unknown platform keys", () => {
    const csv = exportToRadaarCsv([
      { ...baseRow, platform: "mastodon", caption: "Toot toot" },
    ]);
    const line = csv.trim().split("\n")[1];
    expect(line).toContain(",[mastodon] Toot toot,");
  });

  it("trims overly long captions in the title to ~60 chars at a word boundary", () => {
    const long =
      "This is a very long caption that should get trimmed in the title field but the full caption stays in the caption column";
    const csv = exportToRadaarCsv([
      { ...baseRow, platform: "facebook", caption: long },
    ]);
    const line = csv.trim().split("\n")[1];
    // Title cell is the third comma-separated field. Find it.
    const cells = parseCsvLine(line);
    expect(cells[2].length).toBeLessThanOrEqual("[Facebook] ".length + 60);
    expect(cells[2]).not.toContain("trimmed in the title field"); // trimmed
    expect(cells[3]).toBe(long); // caption preserved
  });

  it("handles non-array mediaUrls / links defensively (jsonb may surprise)", () => {
    const csv = exportToRadaarCsv([
      {
        ...baseRow,
        mediaUrls: "not an array" as unknown,
        links: null as unknown,
      },
    ]);
    const line = csv.trim().split("\n")[1];
    // Both should resolve to empty cells; type falls back to TEXT.
    expect(line).toContain(",TEXT,");
    expect(line.endsWith(",,,,DRAFT")).toBe(true);
  });
});

/**
 * Minimal CSV cell parser for assertions. Handles only the cases this
 * test file emits — quoted fields with `""` escapes. Not a general
 * parser.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let cell = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          cell += line[i];
          i++;
        }
      }
      cells.push(cell);
      if (line[i] === ",") i++;
    } else {
      let cell = "";
      while (i < line.length && line[i] !== ",") {
        cell += line[i];
        i++;
      }
      cells.push(cell);
      if (line[i] === ",") i++;
    }
  }
  return cells;
}
