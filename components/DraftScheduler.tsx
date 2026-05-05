"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Schedule UI shown on /outbox/[id] for rows with status=draft (slice 30).
 *
 * Drafts arrive from FlyWitUS-style ingest paths (`as_draft: true`) or, in
 * the future, from the in-outbox composer's "save as draft" path. This
 * component is the only way drafts leave that state into the normal
 * publishing pipeline:
 *   - Schedule → POST /api/admin/scheduled-posts/[id]/promote with the
 *     operator-chosen scheduledAt; row flips to status=queued and the
 *     same submit-to-publisher path that ingest uses fires.
 *   - Discard → POST /api/admin/scheduled-posts/[id]/cancel; row flips
 *     to status=cancelled. (Drafts can be cancelled with the existing
 *     cancel action — no new endpoint needed.)
 *
 * `defaultScheduledAtIso` is the placeholder time the publisher attached
 * to the draft (e.g. now+7d for FlyWitUS). Operator usually picks
 * something different; we just prefill so the field isn't empty.
 */
export function DraftScheduler({
  postId,
  defaultScheduledAtIso,
}: {
  postId: string;
  defaultScheduledAtIso: string;
}) {
  const router = useRouter();

  // datetime-local needs YYYY-MM-DDTHH:MM (no seconds, no Z, local).
  const initialLocal = useMemo(() => {
    const d = new Date(defaultScheduledAtIso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [defaultScheduledAtIso]);

  const [localValue, setLocalValue] = useState(initialLocal);
  const [pending, setPending] = useState<"promote" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    setError(null);
    setPending("promote");
    try {
      const iso = new Date(localValue).toISOString();
      const res = await fetch(
        `/api/admin/scheduled-posts/${encodeURIComponent(postId)}/promote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: iso }),
        }
      );
      const body = await res.json();
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(null);
    }
  }

  async function discard() {
    if (
      !window.confirm(
        "Discard this draft? It will be marked cancelled and will not be sent."
      )
    ) {
      return;
    }
    setError(null);
    setPending("discard");
    try {
      const res = await fetch(
        `/api/admin/scheduled-posts/${encodeURIComponent(postId)}/cancel`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Pick a time, then schedule. The post will flip to{" "}
        <strong>queued</strong> and submit to the publisher immediately.
        Cancellation moves it to <strong>cancelled</strong>; nothing is
        sent.
      </p>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Schedule for</span>
        <input
          type="datetime-local"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={promote}
          disabled={pending !== null}
        >
          <Calendar className="size-4" aria-hidden="true" />
          <span>{pending === "promote" ? "Scheduling…" : "Schedule and submit"}</span>
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={discard}
          disabled={pending !== null}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span>{pending === "discard" ? "Discarding…" : "Discard"}</span>
        </Button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
