import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
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
  disableLogger: true,
});
