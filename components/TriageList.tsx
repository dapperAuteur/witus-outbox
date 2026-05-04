"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, RefreshCw, Repeat, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type ScheduledPostStatus } from "@/components/StatusBadge";
import { formatScheduledTime, truncateCaption } from "@/lib/format";
import { platformLabel } from "@/lib/platforms";

export interface TriageRow {
  id: string;
  status: ScheduledPostStatus;
  platform: string;
  scheduledAt: Date;
  caption: string;
  source: string;
  publisherBackend: string;
  publisherPostId: string | null;
}

type Action = "cancel" | "retry" | "reconcile";

interface BulkResult {
  ok: boolean;
  total: number;
  ok_count: number;
  fail_count: number;
  action: Action;
}

const ACTION_LABEL: Record<Action, string> = {
  retry: "Retry",
  reconcile: "Reconcile now",
  cancel: "Cancel",
};

export function TriageList({ rows }: { rows: TriageRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((cur) =>
      cur.size === allIds.length ? new Set() : new Set(allIds)
    );
  }

  function clearSelection() {
    setSelected(new Set());
    setResult(null);
    setError(null);
  }

  async function runAction(action: Action) {
    setError(null);
    setResult(null);
    setPending(action);
    try {
      const res = await fetch("/api/admin/scheduled-posts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: Array.from(selected) }),
      });
      const body = await res.json();
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setResult({
        ok: true,
        action,
        total: body.total,
        ok_count: body.ok_count,
        fail_count: body.fail_count,
      });
      // Refresh server-side data so status changes show. Keep selection for
      // operator review; they clear via the Clear button.
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(null);
      setConfirm(null);
    }
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-3 px-4 py-2 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex items-center gap-2 cursor-pointer min-h-11">
          <input
            type="checkbox"
            className="size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={toggleAll}
            aria-label={allSelected ? "Clear selection" : "Select all on page"}
          />
          <span className="text-sm text-slate-700 dark:text-slate-200">
            {selected.size > 0
              ? `${selected.size} selected`
              : `Select all (${allIds.length})`}
          </span>
        </label>
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-xs text-slate-500 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-400"
          >
            Clear
          </button>
        ) : null}
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            checked={selected.has(row.id)}
            onToggle={() => toggleOne(row.id)}
          />
        ))}
      </ul>

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky bottom-0 left-0 right-0 z-10 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:border-slate-800 dark:bg-slate-900/95 dark:supports-[backdrop-filter]:bg-slate-900/80"
        >
          {confirm ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium">
                {ACTION_LABEL[confirm]} {selected.size}{" "}
                {selected.size === 1 ? "row" : "rows"}?
              </p>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm(null)}
                  disabled={pending !== null}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={confirm === "cancel" ? "danger" : "primary"}
                  onClick={() => runAction(confirm)}
                  disabled={pending !== null}
                >
                  {pending ? "Working…" : `Yes, ${ACTION_LABEL[confirm].toLowerCase()}`}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                {selected.size} {selected.size === 1 ? "row" : "rows"} selected
              </p>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => setConfirm("retry")}
                  disabled={pending !== null}
                >
                  <Repeat className="size-4" aria-hidden="true" />
                  <span>Retry</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirm("reconcile")}
                  disabled={pending !== null}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  <span>Reconcile</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => setConfirm("cancel")}
                  disabled={pending !== null}
                >
                  <X className="size-4" aria-hidden="true" />
                  <span>Cancel</span>
                </Button>
              </div>
            </div>
          )}

          {error ? (
            <p
              role="alert"
              className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
            >
              {error}
            </p>
          ) : null}

          {result ? (
            <p
              role="status"
              className={
                "mt-2 rounded-md border p-2 text-xs " +
                (result.fail_count === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100")
              }
            >
              {ACTION_LABEL[result.action]}: {result.ok_count}/{result.total}{" "}
              succeeded
              {result.fail_count > 0 ? ` · ${result.fail_count} failed` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Row({
  row,
  checked,
  onToggle,
}: {
  row: TriageRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-stretch">
      <label
        className="flex shrink-0 items-center px-3 cursor-pointer min-h-11"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sr-only">Select row</span>
        <input
          type="checkbox"
          className="size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          checked={checked}
          onChange={onToggle}
        />
      </label>
      <Link
        href={`/outbox/${row.id}`}
        className="flex flex-1 items-stretch gap-3 p-4 pl-1 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-500 motion-reduce:transition-none dark:hover:bg-slate-800"
        aria-label={`Open post scheduled ${formatScheduledTime(row.scheduledAt)} for ${platformLabel(row.platform)}`}
      >
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row.status} />
            <Badge tone="slate">{platformLabel(row.platform)}</Badge>
            <time
              dateTime={row.scheduledAt.toISOString()}
              className="text-xs text-slate-500 dark:text-slate-400 ml-auto sm:ml-0"
            >
              {formatScheduledTime(row.scheduledAt)}
            </time>
          </div>
          <p className="text-sm text-slate-900 dark:text-slate-50 line-clamp-2 break-words">
            {truncateCaption(row.caption)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>
              <span className="sr-only">Source: </span>
              {row.source}
            </span>
            {row.publisherPostId ? (
              <span className="font-mono text-[11px] truncate max-w-[14rem]">
                {row.publisherBackend}:{row.publisherPostId}
              </span>
            ) : null}
          </div>
        </div>
        <ChevronRight
          className="size-5 shrink-0 self-center text-slate-400"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}
