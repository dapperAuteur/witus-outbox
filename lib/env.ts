import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  STORAGE_DATABASE_URL: z.string().url(),
  ADMIN_EMAIL: z.string().email(),
  // NextAuth v4 falls back to VERCEL_URL on Vercel preview/prod when this is
  // unset, and to the request origin in local dev. Set explicitly in
  // Production.
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(16),
  EMAIL_SERVER: z.string().min(1),
  EMAIL_FROM: z
    .string()
    .min(3)
    .refine(
      (v) =>
        /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v) ||
        /<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>\s*$/.test(v),
      'Must be "addr@host" or "Name <addr@host>"'
    ),
  ALERT_EMAIL: z.string().email().optional(),
  INGEST_SOURCES: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MOBILE_TEXT_ALERTS_API_KEY: z.string().optional(),
  MOBILE_TEXT_ALERTS_RECIPIENTS: z.string().optional(),
  PUBLISHER_BACKEND: z.string().default("ocoya"),
  OCOYA_API_KEY: z.string().optional(),
  // JSON array of {name, id} entries. Symbolic name lets INGEST_SOURCES
  // entries reference workspaces by name even if the underlying Ocoya ID
  // changes. Parsed by lib/workspaces.ts. See .env.example for shape.
  OCOYA_WORKSPACE_IDS: z.string().optional(),
});

type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Lazy env getter. Validates on first call so Next build-time analysis does
 * not trip on missing values. Every consumer should call `getEnv()` inside
 * a request handler or server function, never at module top-level.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
