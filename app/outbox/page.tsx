import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Settings } from "lucide-react";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledPosts } from "@/db/schema";
import { getAuthOptions } from "@/lib/auth";
import { PostCard } from "@/components/PostCard";
import { SignOutButton } from "@/components/SignOutButton";
import type { ScheduledPostStatus } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const VALID_STATUSES: ScheduledPostStatus[] = [
  "queued",
  "submitted",
  "scheduled",
  "posted",
  "error",
  "cancelled",
];

const STATUS_LABEL: Record<ScheduledPostStatus | "all", string> = {
  all: "All",
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
  const statusRaw = takeOne(sp.status);
  const statusFilter = VALID_STATUSES.find((s) => s === statusRaw);

  const conditions: SQL[] = [];
  if (statusFilter) conditions.push(eq(scheduledPosts.status, statusFilter));

  let rows: Array<{
    id: string;
    source: string;
    platform: string;
    caption: string;
    status: ScheduledPostStatus;
    scheduledAt: Date;
    publisherBackend: string;
    publisherPostId: string | null;
  }> = [];
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
      conditions.length > 0
        ? await query.where(and(...conditions))
        : await query;
  } catch (err) {
    queryError = err instanceof Error ? err.name : "UnknownError";
    console.error("[outbox] list query failed err=%s", queryError);
  }

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10"
    >
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-violet-600 dark:text-violet-400">
            WitUS Outbox
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Triage</h1>
        </div>
        <div className="flex items-center gap-1">
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

      <nav
        aria-label="Filter by status"
        className="-mx-1 mb-5 flex flex-wrap gap-1 overflow-x-auto"
      >
        <FilterChip
          label={STATUS_LABEL.all}
          href="/outbox"
          active={!statusFilter}
        />
        {VALID_STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_LABEL[s]}
            href={`/outbox?status=${s}`}
            active={statusFilter === s}
          />
        ))}
      </nav>

      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {rows.length} {rows.length === 1 ? "row" : "rows"}
        {statusFilter ? ` · ${STATUS_LABEL[statusFilter]}` : ""}
      </p>

      {queryError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          Could not load posts. Check the server logs ({queryError}).
        </p>
      ) : rows.length === 0 ? (
        <EmptyState statusFilter={statusFilter} />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {rows.map((row) => (
            <PostCard
              key={row.id}
              id={row.id}
              status={row.status}
              platform={row.platform}
              scheduledAt={row.scheduledAt}
              caption={row.caption}
              source={row.source}
              publisherBackend={row.publisherBackend}
              publisherPostId={row.publisherPostId}
            />
          ))}
        </ul>
      )}
    </main>
  );
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

function EmptyState({ statusFilter }: { statusFilter: ScheduledPostStatus | undefined }) {
  if (statusFilter) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        No posts with status <strong>{STATUS_LABEL[statusFilter]}</strong>.
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
