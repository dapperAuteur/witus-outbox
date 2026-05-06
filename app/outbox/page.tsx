import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Download, PenSquare, Search, Settings } from "lucide-react";
import { and, desc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { parseTriageFilters } from "@/lib/triage-query";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SignOutButton } from "@/components/SignOutButton";
import { TriageList, type TriageRow } from "@/components/TriageList";
import type { ScheduledPostStatus } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const VALID_STATUSES: ScheduledPostStatus[] = [
  "draft",
  "queued",
  "submitted",
  "scheduled",
  "posted",
  "error",
  "cancelled",
];

const STATUS_LABEL: Record<ScheduledPostStatus | "all", string> = {
  all: "All",
  draft: "Draft",
  queued: "Queued",
  submitted: "Submitted",
  scheduled: "Scheduled",
  posted: "Posted",
  error: "Error",
  cancelled: "Cancelled",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function takeOne(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OutboxList({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session?.user?.email) {
    redirect("/auth/sign-in?callbackUrl=/outbox");
  }

  const sp = await searchParams;
  const filters = parseTriageFilters({
    status: takeOne(sp.status) ?? null,
    source: takeOne(sp.source) ?? null,
    q: takeOne(sp.q) ?? null,
  });
  const statusFilter = filters.status;
  const sourceFilter = filters.source ?? "";
  const qFilter = filters.q ?? "";

  let rows: TriageRow[] = [];
  let sourceOptions: string[] = [];
  let queryError: string | null = null;

  try {
    const query = getDb()
      .select({
        id: scheduledPosts.id,
        source: scheduledPosts.source,
        platform: scheduledPosts.platform,
        caption: scheduledPosts.caption,
        status: scheduledPosts.status,
        scheduledAt: scheduledPosts.scheduledAt,
        publisherBackend: scheduledPosts.publisherBackend,
        publisherPostId: scheduledPosts.publisherPostId,
      })
      .from(scheduledPosts)
      .orderBy(desc(scheduledPosts.scheduledAt))
      .limit(100);
    rows =
      filters.conditions.length > 0
        ? await query.where(and(...filters.conditions))
        : await query;

    const sourceRows = await getDb()
      .selectDistinct({ source: scheduledPosts.source })
      .from(scheduledPosts)
      .orderBy(sql`${scheduledPosts.source} asc`);
    sourceOptions = sourceRows.map((r) => r.source);
  } catch (err) {
    queryError = err instanceof Error ? err.name : "UnknownError";
    console.error("[outbox] list query failed err=%s", queryError);
  }

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10"
    >
      <AutoRefresh />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-400">
            WitUS Outbox
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Triage</h1>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/outbox/compose"
            className="inline-flex items-center gap-1 rounded-md min-h-11 min-w-11 px-3 text-sm font-medium text-violet-700 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-300 dark:hover:bg-violet-900/30"
          >
            <PenSquare className="size-4" aria-hidden="true" />
            <span>Compose</span>
          </Link>
          <Link
            href="/outbox/setup"
            className="inline-flex items-center gap-1 rounded-md min-h-11 min-w-11 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Settings className="size-4" aria-hidden="true" />
            <span>Setup</span>
          </Link>
          <SignOutButton />
        </div>
      </header>

      <form
        method="GET"
        action="/outbox"
        role="search"
        aria-label="Filter posts"
        className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-stretch"
      >
        {statusFilter ? (
          <input type="hidden" name="status" value={statusFilter} />
        ) : null}
        <label className="relative flex-1">
          <span className="sr-only">Search captions</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            defaultValue={qFilter}
            placeholder="Search captions…"
            inputMode="search"
            autoComplete="off"
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:placeholder:text-slate-500"
          />
        </label>
        <label className="sm:w-44">
          <span className="sr-only">Filter by source</span>
          <select
            name="source"
            defaultValue={sourceFilter}
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">All sources</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:flex-initial"
          >
            Apply
          </button>
          {qFilter || sourceFilter ? (
            <Link
              href={
                statusFilter ? `/outbox?status=${statusFilter}` : "/outbox"
              }
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Clear
            </Link>
          ) : null}
          <a
            href={buildExportHref({
              status: statusFilter,
              q: qFilter,
              source: sourceFilter,
            })}
            download
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Download current view as CSV"
            title="Download current view as CSV"
          >
            <Download className="size-4" aria-hidden="true" />
            <span>CSV</span>
          </a>
        </div>
      </form>

      <nav
        aria-label="Filter by status"
        className="-mx-1 mb-5 flex flex-wrap gap-1 overflow-x-auto"
      >
        <FilterChip
          label={STATUS_LABEL.all}
          href={buildHref({ q: qFilter, source: sourceFilter })}
          active={!statusFilter}
        />
        {VALID_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_LABEL[s]}
            href={buildHref({ status: s, q: qFilter, source: sourceFilter })}
            active={statusFilter === s}
          />
        ))}
      </nav>

      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {rows.length} {rows.length === 1 ? "row" : "rows"}
        {statusFilter ? ` · ${STATUS_LABEL[statusFilter]}` : ""}
        {sourceFilter ? ` · source: ${sourceFilter}` : ""}
        {qFilter ? ` · "${qFilter}"` : ""}
      </p>

      {queryError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          Could not load posts. Check the server logs ({queryError}).
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          statusFilter={statusFilter}
          qFilter={qFilter}
          sourceFilter={sourceFilter}
        />
      ) : (
        <TriageList rows={rows} />
      )}
    </main>
  );
}

function buildHref(params: {
  status?: ScheduledPostStatus;
  q?: string;
  source?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  const qs = sp.toString();
  return qs ? `/outbox?${qs}` : "/outbox";
}

function buildExportHref(params: {
  status?: ScheduledPostStatus;
  q?: string;
  source?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  const qs = sp.toString();
  return qs
    ? `/api/admin/export-triage-csv?${qs}`
    : "/api/admin/export-triage-csv";
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none " +
        (active
          ? "bg-violet-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700")
      }
    >
      {label}
    </Link>
  );
}

function EmptyState({
  statusFilter,
  qFilter,
  sourceFilter,
}: {
  statusFilter: ScheduledPostStatus | undefined;
  qFilter: string;
  sourceFilter: string;
}) {
  if (statusFilter || qFilter || sourceFilter) {
    const bits: string[] = [];
    if (statusFilter) bits.push(`status=${STATUS_LABEL[statusFilter]}`);
    if (sourceFilter) bits.push(`source=${sourceFilter}`);
    if (qFilter) bits.push(`q=${qFilter}`);
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        No posts match <strong>{bits.join(", ")}</strong>.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 space-y-3">
      <p className="font-medium text-slate-900 dark:text-slate-50">
        No posts yet
      </p>
      <p>
        Posts arrive via signed POST to{" "}
        <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">
          /api/ingest
        </code>{" "}
        from a publisher product (or via the CSV importer).
      </p>
      <p>
        Once the importer slice ships, run{" "}
        <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">
          npm run import:radaar -- --dry-run --limit 5
        </code>{" "}
        to seed a few rows.
      </p>
    </div>
  );
}
