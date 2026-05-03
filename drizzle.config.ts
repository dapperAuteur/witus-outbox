import type { Config } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// Next.js loads `.env.local` automatically at dev/build time, but drizzle-kit
// runs outside the Next runtime and only sees what `dotenv` loads for it.
// Load `.env.local` first (Next's convention for machine-local secrets),
// then `.env` as a fallback so CI-style setups that only ship a `.env` work.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const migrationUrl =
  process.env.STORAGE_DATABASE_URL_UNPOOLED ?? process.env.STORAGE_DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "STORAGE_DATABASE_URL_UNPOOLED (preferred) or STORAGE_DATABASE_URL is required to run drizzle-kit"
  );
}

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
  },
} satisfies Config;
