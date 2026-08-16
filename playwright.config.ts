import { defineConfig, devices } from "@playwright/test";

// E2E + a11y gate (witus plan 30 Phase 2, ported from the witus.online repo). Two ways to point
// it at a running app:
//   PLAYWRIGHT_BASE_URL=https://<deploy-url> npx playwright test     ← CI (Vercel preview/prod)
//   npx playwright test                                              ← local, expects dev server on :3000
// No webServer block on purpose: this repo's dev server needs real env (NEXTAUTH_SECRET,
// DATABASE_URL, ADMIN_EMAIL, publisher credentials) that CI and fresh clones don't have. CI
// always runs against a deployed URL instead.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Vercel Deployment Protection: if the target deployment is protected, set
// VERCEL_AUTOMATION_BYPASS_SECRET (Vercel → Project → Deployment Protection → Protection Bypass
// for Automation) as a GitHub Actions secret. Read from the project's own dashboard — value is
// per-project. Unset = no header sent, which is correct for public deployments.
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(bypass ? { extraHTTPHeaders: { "x-vercel-protection-bypass": bypass } } : {}),
  },
  projects: [
    {
      name: "desktop",
      // Playwright's bundled chromium does not support macOS 13, so local runs drive the installed
      // Google Chrome; CI (ubuntu) uses the bundled browser.
      use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) },
    },
    {
      // The ecosystem UI/UX standard is mobile-first at 360px (witus docs/shared-ui-ux-dx.md);
      // a flow that only works on desktop is a failing flow. Same specs, small viewport.
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 740 },
        ...(process.env.CI ? {} : { channel: "chrome" }),
      },
    },
  ],
});
