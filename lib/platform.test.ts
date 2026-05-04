import { describe, expect, it } from "vitest";
import { parsePlatformPrefix } from "./platform";

describe("parsePlatformPrefix", () => {
  it.each([
    ["[YouTube] hello world", "youtube", "hello world"],
    ["[LinkedIn] long form", "linkedin", "long form"],
    ["[Twitter/X] thread starter", "twitter", "thread starter"],
    ["[X] something", "twitter", "something"],
    ["[Facebook] meta post", "facebook", "meta post"],
    ["[Instagram] reels caption", "instagram", "reels caption"],
    ["[BlueSky] skeet", "bluesky", "skeet"],
    ["[Blue Sky] skeet too", "bluesky", "skeet too"],
    ["[TikTok] vertical video", "tiktok", "vertical video"],
    ["[Pinterest] pin idea", "pinterest", "pin idea"],
  ])("parses %s", (title, platform, rest) => {
    expect(parsePlatformPrefix(title)).toEqual({ platform, rest });
  });

  it("is case-insensitive on the platform name", () => {
    expect(parsePlatformPrefix("[YOUTUBE] caps")).toEqual({
      platform: "youtube",
      rest: "caps",
    });
    expect(parsePlatformPrefix("[bluesky] lower")).toEqual({
      platform: "bluesky",
      rest: "lower",
    });
  });

  it("trims surrounding whitespace inside the brackets", () => {
    expect(parsePlatformPrefix("[ LinkedIn ] padded")).toEqual({
      platform: "linkedin",
      rest: "padded",
    });
  });

  it("tolerates leading whitespace before the prefix", () => {
    expect(parsePlatformPrefix("   [Twitter] sup")).toEqual({
      platform: "twitter",
      rest: "sup",
    });
  });

  it("returns null when no bracketed prefix is present", () => {
    expect(parsePlatformPrefix("just a title")).toBeNull();
  });

  it("returns null for an unknown platform inside brackets", () => {
    expect(parsePlatformPrefix("[Mastodon] not yet supported")).toBeNull();
    expect(parsePlatformPrefix("[Threads] also not")).toBeNull();
  });

  it("returns null for an empty bracket pair", () => {
    expect(parsePlatformPrefix("[] empty")).toBeNull();
  });
});
