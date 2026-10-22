import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // PostHog's endpoints use trailing slashes; without this Next 308s them before the
  // /ingest rewrite runs. It disables trailing-slash redirects app-wide, which is
  // acceptable here: every page is robots noindex (app/layout.tsx), so there are no
  // public duplicate URLs to canonicalize.
  skipTrailingSlashRedirect: true,

  // Proxy PostHog ingest through our own origin so ad blockers can't drop events
  // (witus-online lib/analytics/INTEGRATE.md step 2). The shared project is US. The
  // /static rule must come first: assets come from a different upstream host. No app
  // route may begin with /ingest — that prefix belongs to this rewrite.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
};

// Wrap with the Sentry build plugin (the SDK Better Stack ingests). Safe with no Sentry env set:
// without SENTRY_AUTH_TOKEN it skips source-map upload (you get minified stack traces instead), and
// the runtime SDK stays inert without a DSN. org/project/authToken come from env, so nothing secret
// is committed here.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: {
    // Strips the SDK's own debug logging from the bundle. Replaces the deprecated top-level
    // `disableLogger` option. Webpack-only, so it is a no-op under Turbopack (same as the old
    // flag was), but it silences the v10 deprecation warning.
    treeshake: { removeDebugLogging: true },
  },
});
