import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every page carries the app shell (witus docs/shared-ui-ux-dx.md): the root layout mounts SiteHeader
 * above the page and SiteFooter below it, so the sign-in page, the 404 and the error boundary all get
 * them. The header's signed-out control reads exactly "Sign in" and points at the sign-in route.
 */
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");

describe("site shell", () => {
  it("the root layout mounts the header above the page and the footer below it", () => {
    const src = read("app/layout.tsx");
    const header = src.indexOf("<SiteHeader />");
    const children = src.indexOf("{children}");
    const footer = src.indexOf("<SiteFooter />");
    expect(header).toBeGreaterThan(-1);
    expect(children).toBeGreaterThan(header);
    expect(footer).toBeGreaterThan(children);
  });

  it("the header's signed-out control is a link named exactly Sign in", () => {
    const src = read("components/SiteHeader.tsx");
    expect(src).toMatch(/href="\/auth\/sign-in"[^>]*>\s*Sign in\s*<\/Link>/);
    expect(src).toMatch(/<SignOutButton/);
    expect(src).toMatch(/<header/);
  });

  for (const file of ["app/not-found.tsx", "app/error.tsx"]) {
    it(`${file} has one h1 and a home link and renders inside the layout`, () => {
      const src = read(file);
      expect(src.match(/<h1/g)).toHaveLength(1);
      expect(src).toMatch(/href="\/"/);
      expect(src).not.toMatch(/<html/);
    });
  }
});
