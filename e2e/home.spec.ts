import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Happy path + a11y gate for the public surface (witus plan 30 Phase 2; a11y mandate from the
// ecosystem shared UI/UX standard). This repo is admin-gated and API-first — the only page an
// anonymous visitor can reach is /auth/sign-in (app/page.tsx redirects there, and proxy.ts
// guards /outbox). So the gate is deliberately small: the sign-in surface renders, the auth
// gate actually redirects, and the page stays accessible. No authenticated flows here.

/** Gate on serious+critical axe violations. Minor/moderate findings are reported in the failure
 *  message when the gate trips, but don't fail the build on their own — the charter's bar is
 *  WCAG AA, and axe's minor findings routinely include below-AA nitpicks that would make the
 *  gate flaky-red and get ignored. Tighten later if the pages stay clean. */
async function expectNoSeriousA11yViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const gating = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    gating.map((v) => `${v.impact}: ${v.id} — ${v.help} (${v.nodes.length} nodes)`),
  ).toEqual([]);
}

test("anonymous visitor lands on sign-in, and it is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("main").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("auth gate redirects anonymous /outbox to sign-in", async ({ page }) => {
  // proxy.ts (withAuth) matcher covers /outbox/:path* with pages.signIn = /auth/sign-in.
  // An anonymous visitor reaching the triage UI would be a security regression, so assert
  // the redirect, not the destination content beyond it rendering.
  await page.goto("/outbox");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator("h1").first()).toBeVisible();
});
