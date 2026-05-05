import "server-only";
import { and, eq, ilike, type SQL } from "drizzle-orm";
import { scheduledPosts } from "@/db/schema";
import type { ScheduledPostStatus } from "@/components/StatusBadge";

const VALID_STATUSES: readonly ScheduledPostStatus[] = [
  "draft",
  "queued",
  "submitted",
  "scheduled",
  "posted",
  "error",
  "cancelled",
] as const;

export interface TriageFilters {
  status?: ScheduledPostStatus;
  source?: string;
  q?: string;
}

export interface ParsedTriageFilters extends TriageFilters {
  /** Drizzle SQL[] ready to splat into `where(and(...))`. Empty if no filter. */
  conditions: SQL[];
}

/**
 * Single source of truth for the /outbox triage filter set. Used by both the
 * page render and the CSV export so they can't drift on which rows match.
 *
 * Reads from URLSearchParams-shaped input — the page provides them via
 * Next 16's `searchParams` Promise, and the export route reads them off
 * `nextUrl.searchParams`. Both call this with raw strings.
 *
 * `q` is escaped for the LIKE wildcards (`%` and `_`) plus backslash so a
 * caption like "50% off" doesn't behave like a wildcard search.
 */
export function parseTriageFilters(input: {
  status?: string | null;
  source?: string | null;
  q?: string | null;
}): ParsedTriageFilters {
  const status = VALID_STATUSES.find((s) => s === input.status);
  const sourceTrimmed = input.source?.trim() ?? "";
  const source = sourceTrimmed.length > 0 ? sourceTrimmed.slice(0, 100) : undefined;
  const qTrimmed = input.q?.trim() ?? "";
  const q = qTrimmed.length > 0 ? qTrimmed.slice(0, 200) : undefined;

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(scheduledPosts.status, status));
  if (source) conditions.push(eq(scheduledPosts.source, source));
  if (q) {
    const escaped = q
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    conditions.push(ilike(scheduledPosts.caption, `%${escaped}%`));
  }

  return { status, source, q, conditions };
}
