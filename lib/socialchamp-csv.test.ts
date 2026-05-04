import { describe, expect, it } from "vitest";
import {
  exportToSocialChampUniversalCsv,
  exportToSocialChampYouTubeCsv,
  type OutboxRowForExport,
} from "./socialchamp-csv";

const baseRow: OutboxRowForExport = {
  source: "radaar-csv-import",
  draftId: "abc123",
  platform: "facebook",
  caption: "Hello world",
  mediaUrls: [],
  links: [],
  scheduledAt: new Date(Date.UTC(2026, 4, 5, 14, 30)),
  status: "queued",
};

describe("exportToSocialChampUniversalCsv", () => {
  it("emits the canonical 26-column header", () => {
    const csv = exportToSocialChampUniversalCsv([]);
    const header = csv.split("\n")[0];
    const cells = parseCsvLine(header);
    expect(cells).toHaveLength(26);
    expect(cells[0]).toBe("Labels");
    expect(cells[1]).toBe("Text");
    expect(cells[3]).toBe("Year");
    expect(cells[8]).toBe("Queue Schedule");
    expect(cells[10]).toBe("Post Type");
    expect(cells[11]).toBe("Image URL");
    expect(cells[13]).toBe("Video URL");
    expect(cells[20]).toBe("Instagram First Comment");
    expect(cells[24]).toBe("Document URL");
  });

  it("emits a basic text row with date split into UTC parts", () => {
    const csv = exportToSocialChampUniversalCsv([
      { ...baseRow, caption: "Short post" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(2);
    const cells = parseCsvLine(lines[1]);
    expect(cells[0]).toBe(""); // Labels
    expect(cells[1]).toBe("Short post"); // Text
    expect(cells[2]).toBe(""); // Link
    expect(cells[3]).toBe("2026"); // Year
    expect(cells[4]).toBe("5"); // Month (May = 5, NOT 04)
    expect(cells[5]).toBe("5"); // Date
    expect(cells[6]).toBe("14"); // Hour
    expect(cells[7]).toBe("30"); // Minutes
  });

  it("escapes quotes and commas in caption", () => {
    const csv = exportToSocialChampUniversalCsv([
      {
        ...baseRow,
        caption: 'She said "hi", and waved',
      },
    ]);
    const text = csv.trim();
    // The Text cell needs RFC-4180 quoting + "" escaping.
    expect(text).toContain(',"She said ""hi"", and waved",');
  });

  it("populates Image URL from first image in mediaUrls", () => {
    const csv = exportToSocialChampUniversalCsv([
      {
        ...baseRow,
        mediaUrls: [
          "https://cdn.example.com/a.png",
          "https://cdn.example.com/b.jpg",
        ],
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[11]).toBe("https://cdn.example.com/a.png"); // Image URL
    expect(cells[13]).toBe(""); // Video URL
  });

  it("populates Video URL from first video in mediaUrls", () => {
    const csv = exportToSocialChampUniversalCsv([
      {
        ...baseRow,
        mediaUrls: ["https://cdn.example.com/v.mp4"],
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[11]).toBe(""); // Image URL
    expect(cells[13]).toBe("https://cdn.example.com/v.mp4"); // Video URL
  });

  it("uses first link in Link column when row has links", () => {
    const csv = exportToSocialChampUniversalCsv([
      {
        ...baseRow,
        links: ["https://example.com/one", "https://example.com/two"],
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[2]).toBe("https://example.com/one");
  });

  it("handles non-array jsonb shapes defensively", () => {
    const csv = exportToSocialChampUniversalCsv([
      {
        ...baseRow,
        mediaUrls: "not an array" as unknown,
        links: null as unknown,
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[2]).toBe(""); // Link
    expect(cells[11]).toBe(""); // Image URL
    expect(cells[13]).toBe(""); // Video URL
  });
});

describe("exportToSocialChampYouTubeCsv", () => {
  it("emits the canonical 23-column header", () => {
    const csv = exportToSocialChampYouTubeCsv([]);
    const cells = parseCsvLine(csv.split("\n")[0]);
    expect(cells).toHaveLength(23);
    expect(cells[0]).toBe("Labels");
    expect(cells[8]).toBe("Post Type");
    expect(cells[9]).toBe("Video Title");
    expect(cells[10]).toBe("Video URL");
    expect(cells[15]).toBe("Privacy Status");
    expect(cells[19]).toBe("License");
    expect(cells[22]).toBe("Made For Kids");
  });

  it("defaults Post Type=VIDEO, Privacy=PUBLIC, License=YOUTUBE, Embeddable+Notify=Yes, Made For Kids=No", () => {
    const csv = exportToSocialChampYouTubeCsv([
      {
        ...baseRow,
        platform: "youtube",
        caption: "Sample video caption",
        mediaUrls: ["https://cdn.example.com/v.mp4"],
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[8]).toBe("VIDEO");
    expect(cells[10]).toBe("https://cdn.example.com/v.mp4");
    expect(cells[15]).toBe("PUBLIC");
    expect(cells[19]).toBe("YOUTUBE");
    expect(cells[20]).toBe("Yes"); // Embeddable
    expect(cells[21]).toBe("Yes"); // Notify Subscribers
    expect(cells[22]).toBe("No"); // Made For Kids
  });

  it("synthesizes a Video Title under 60 chars at word boundary", () => {
    const long =
      "This is a very long caption that should be trimmed at a word boundary somewhere around sixty characters into the title cell";
    const csv = exportToSocialChampYouTubeCsv([
      { ...baseRow, platform: "youtube", caption: long },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[9].length).toBeLessThanOrEqual(60);
    expect(cells[9]).not.toMatch(/\s$/); // no trailing whitespace
    expect(cells[1]).toBe(long); // full caption preserved in Text
  });

  it("uses the first video URL when present, falls back to first media URL", () => {
    const csv = exportToSocialChampYouTubeCsv([
      {
        ...baseRow,
        platform: "youtube",
        mediaUrls: ["https://cdn.example.com/thumb.png", "https://cdn.example.com/main.mp4"],
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[10]).toBe("https://cdn.example.com/main.mp4");
  });

  it("emits Year/Month/Date/Hour/Minutes from UTC", () => {
    const csv = exportToSocialChampYouTubeCsv([
      {
        ...baseRow,
        platform: "youtube",
        scheduledAt: new Date(Date.UTC(2026, 11, 31, 23, 5)),
      },
    ]);
    const cells = parseCsvLine(csv.trim().split("\n")[1]);
    expect(cells[2]).toBe("2026");
    expect(cells[3]).toBe("12");
    expect(cells[4]).toBe("31");
    expect(cells[5]).toBe("23");
    expect(cells[6]).toBe("5");
  });
});

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
