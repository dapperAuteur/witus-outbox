import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type OutboxDb = NeonHttpDatabase<typeof schema>;

let cached: OutboxDb | null = null;

export function getDb(): OutboxDb {
  if (cached) return cached;
  const sql = neon(getEnv().STORAGE_DATABASE_URL);
  cached = drizzle(sql, { schema });
  return cached;
}

export type Db = OutboxDb;
