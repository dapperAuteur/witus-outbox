"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Calendar, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ScheduledPostStatus } from "@/components/StatusBadge";

interface PostActionsProps {
  postId: string;
  status: ScheduledPostStatus;
  hasPublisherPostId: boolean;
  scheduledAtIso: string;
  /** The backend that owns this row. Drives which actions are shown — */
  /** SocialChamp's API doesn't currently expose update/delete/get-by-id, */
  /** so those buttons would no-op locally. We hide them and tell the */
  /** operator to act in the publisher's UI instead. */
  publisherBackend: string;
}

interface ActionResponse {
  ok: boolean;
  error?: string;
  status?: string;
}

const TERMINAL: ScheduledPostStatus[] = ["posted", "cancelled"];

export function PostActions(props: PostActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newAtLocal, setNewAtLocal] = useState(
    toLocalInput(props.scheduledAtIso)
  );

  const isTerminal = TERMINAL.includes(props.status);
  // SocialChamp's public API only documents createPost — no
  // get/list/update/delete. Buttons that would silently no-op locally
  // get hidden so the operator doesn't think they did anything. Operate
  // on those rows from inside SocialChamp's UI directly.
  const backendSupportsRemoteOps = props.publisherBackend === "ocoya";

  const canRetry =
    !isTerminal && !props.hasPublisherPostId &&
    (props.status === "queued" || props.status === "error");
  const canCancel = !isTerminal && backendSupportsRemoteOps;
  const canReschedule =
    !isTerminal && props.status !== "queued" && backendSupportsRemoteOps;
  const canReconcile =
    props.hasPublisherPostId && !isTerminal && backendSupportsRemoteOps;

  async function call(
    op: string,
    path: string,
    body?: unknown
  ): Promise<void> {
    setError(null);
    setInfo(null);
    setPending(op);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const json: ActionResponse = await res.json().catch(() => ({ ok: false }));
      if (!json.ok) {
        setError(json.error ?? `failed (${res.status})`);
        return;
      }
      setInfo(`${op}: ${json.status ?? "ok"}`);
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(null);
    }
  }

  if (isTerminal) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        No actions available — this post is{" "}
        <strong>{props.status}</strong>.
      </p>
    );
  }

  const nothingActionable =
    !canRetry && !canCancel && !canReschedule && !canReconcile;

  return (
    <div className="space-y-3">
      {nothingActionable && !backendSupportsRemoteOps ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
          The <strong>{props.publisherBackend}</strong> adapter doesn&rsquo;t
          expose update / delete / get-by-id endpoints in its public API yet.
          Cancel / Reschedule / Reconcile-now buttons are hidden because they
          would no-op against the publisher. Operate on this post inside{" "}
          <strong>{props.publisherBackend}&rsquo;s</strong> own UI to make
          changes there, then return here and update the local row by hand if
          needed.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canRetry ? (
          <Button
            type="button"
            variant="primary"
            disabled={pending !== null}
            onClick={() =>
              call("retry", `/api/admin/scheduled-posts/${props.postId}/retry`)
            }
          >
            <RotateCcw
              className={
                pending === "retry"
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
              aria-hidden="true"
            />
            <span>{pending === "retry" ? "Retrying…" : "Retry"}</span>
          </Button>
        ) : null}

        {canReconcile ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() =>
              call(
                "reconcile",
                `/api/admin/scheduled-posts/${props.postId}/reconcile-now`
              )
            }
          >
            <RefreshCw
              className={
                pending === "reconcile"
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
              aria-hidden="true"
            />
            <span>
              {pending === "reconcile" ? "Reconciling…" : "Reconcile now"}
            </span>
          </Button>
        ) : null}

        {canReschedule ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => setShowReschedule((v) => !v)}
            aria-expanded={showReschedule}
            aria-controls="reschedule-form"
          >
            <Calendar className="size-4" aria-hidden="true" />
            <span>Reschedule</span>
          </Button>
        ) : null}

        {canCancel ? (
          <Button
            type="button"
            variant="danger"
            disabled={pending !== null}
            onClick={() => {
              if (
                window.confirm(
                  props.hasPublisherPostId
                    ? "Cancel this post? This DELETEs it on the publisher's side and marks the local row cancelled."
                    : "Cancel this post? Marks the local row cancelled."
                )
              ) {
                void call(
                  "cancel",
                  `/api/admin/scheduled-posts/${props.postId}/cancel`
                );
              }
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span>{pending === "cancel" ? "Cancelling…" : "Cancel"}</span>
          </Button>
        ) : null}
      </div>

      {showReschedule ? (
        <form
          id="reschedule-form"
          className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const utc = fromLocalInput(newAtLocal);
            if (!utc) {
              setError("Invalid date");
              return;
            }
            void call(
              "reschedule",
              `/api/admin/scheduled-posts/${props.postId}/reschedule`,
              { scheduled_at: utc.toISOString() }
            );
          }}
        >
          <label
            htmlFor="reschedule-input"
            className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
          >
            New scheduled time (your local timezone)
          </label>
          <Input
            id="reschedule-input"
            type="datetime-local"
            required
            value={newAtLocal}
            onChange={(e) => setNewAtLocal(e.target.value)}
            disabled={pending !== null}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={pending !== null || newAtLocal === ""}
            >
              {pending === "reschedule" ? "Saving…" : "Save new time"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending !== null}
              onClick={() => setShowReschedule(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
      {info && !error ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          {info}
        </p>
      ) : null}
    </div>
  );
}

/** ISO → "YYYY-MM-DDTHH:MM" for the datetime-local input (in user's local TZ). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** datetime-local string interpreted as user's local TZ → UTC Date. */
function fromLocalInput(local: string): Date | null {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d;
}
