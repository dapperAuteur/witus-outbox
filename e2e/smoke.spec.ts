import { test, expect } from "@playwright/test";

// Post-deploy smoke (@smoke): the production workflow job runs ONLY tests tagged @smoke, so keep
// this file to checks that are safe and meaningful against live production. /api/health runs a
// real `select 1` against Neon and returns a fast 503 when it's unreachable (see
// app/api/health/route.ts), so a green here means "deployed AND the database path works", which
// is the whole point of the gate.
test("@smoke health endpoint answers ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  // Real response shape (app/api/health/route.ts): { ok: true, checkedAt: <ISO timestamp> }.
  expect(typeof body.checkedAt).toBe("string");
  expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
});

test("@smoke anonymous visit serves the sign-in page", async ({ page }) => {
  // This service is admin-gated and API-first: app/page.tsx redirects anonymous visitors to
  // /auth/sign-in. A rendered sign-in page is the whole anonymous surface working.
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator("h1").first()).toBeVisible();
});

// Error pages keep the app shell (witus docs/shared-ui-ux-dx.md): a missing path answers 404 and
// still renders the header's Sign in control and the footer, so the visitor is never stranded.
test("@smoke not-found page keeps the header and footer", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist-smoke");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveCount(1);
  // The Sign in control has to be in the header itself, not only in the footer's link list.
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator("footer").first()).toBeVisible();
});

test("@smoke sign-in page has the header with its Sign in control", async ({ page }) => {
  await page.goto("/auth/sign-in");
  const header = page.locator("header").first();
  await expect(header).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
