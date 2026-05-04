"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface AvailableProfile {
  publisherProfileId: string;
  displayName: string | null;
}

interface FetchSuccess {
  ok: true;
  row: {
    id: string;
    publisher_backend: string;
    publisher_workspace_id: string | null;
    network: string;
  };
  available: AvailableProfile[];
  default: { publisherProfileIds: string[] } | null;
  override: string[] | null;
}

export function RowProfileOverride({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<FetchSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Local edit state — undefined means "match server-truth", an array
  // means the operator has changed something locally and not saved yet.
  const [edit, setEdit] = useState<string[] | undefined>(undefined);

  async function load() {
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/scheduled-posts/${postId}/profiles`,
        { cache: "no-store" }
      );
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setData(body);
      setEdit(undefined);
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void load();
  }, [postId]);

  if (pending && !data) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">Loading…</p>
    );
  }

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
      >
        {error}
      </p>
    );
  }

  if (!data) {
    return null;
  }

  // Effective server-side selection (override → default → empty).
  const serverIds: string[] =
    data.override ?? data.default?.publisherProfileIds ?? [];
  const currentIds = edit ?? data.override ?? [];
  const isDirty = edit !== undefined;
  const hasOverride = (data.override ?? []).length > 0;

  function toggle(id: string) {
    const cur = currentIds;
    const next = cur.includes(id)
      ? cur.filter((x) => x !== id)
      : [...cur, id];
    setEdit(next);
  }

  function setEditTo(ids: string[]) {
    setEdit(ids);
  }

  async function save(idsToSave: string[]) {
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/scheduled-posts/${postId}/profiles`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publisherProfileIds: idsToSave }),
        }
      );
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setInfo(
        idsToSave.length > 0
          ? `Override set: ${idsToSave.length} profile${idsToSave.length === 1 ? "" : "s"}`
          : "Override cleared — falls back to defaults"
      );
      await load();
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setSaving(false);
    }
  }

  if (data.available.length === 0) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
        No social profiles cached yet for this row&rsquo;s{" "}
        <strong>{data.row.publisher_backend}</strong>{" "}
        {data.row.publisher_workspace_id ? "workspace" : "tenant"}. Run Sync
        on /outbox/setup, then return here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Source:
        </span>
        {hasOverride ? (
          <Badge tone="violet">row override</Badge>
        ) : data.default ? (
          <Badge tone="emerald">workspace default</Badge>
        ) : (
          <Badge tone="muted">any-match fallback</Badge>
        )}
        <span className="text-slate-500 dark:text-slate-400">
          · {serverIds.length || 1} profile
          {serverIds.length === 1 || serverIds.length === 0 ? "" : "s"} will
          be used at submit time
        </span>
      </header>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        Override the default profile selection for <strong>this row only</strong>.
        Empty selection &amp; Save → returns to the workspace default (or the
        any-match fallback if no default is set).
      </p>

      <ul className="space-y-2">
        {data.available.map((p) => {
          const checked = currentIds.includes(p.publisherProfileId);
          return (
            <li key={p.publisherProfileId}>
              <label className="flex items-start gap-3 cursor-pointer min-h-11 py-1">
                <input
                  type="checkbox"
                  className="mt-1 size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                  checked={checked}
                  onChange={() => toggle(p.publisherProfileId)}
                  disabled={saving}
                />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <span className="block text-sm">
                    {p.displayName ?? "(unnamed)"}
                  </span>
                  <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                    {p.publisherProfileId}
                  </span>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={isDirty ? "primary" : "secondary"}
          disabled={!isDirty || saving}
          onClick={() => save(currentIds)}
        >
          <Save className="size-4" aria-hidden="true" />
          <span>{saving ? "Saving…" : "Save override"}</span>
        </Button>
        {hasOverride ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => save([])}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span>Clear override</span>
          </Button>
        ) : null}
        {isDirty ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => setEditTo(data.override ?? [])}
          >
            Discard changes
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || saving}
          onClick={load}
          aria-label="Reload"
        >
          <RefreshCw
            className={
              pending && data
                ? "size-4 animate-spin motion-reduce:animate-none"
                : "size-4"
            }
            aria-hidden="true"
          />
          <span>Reload</span>
        </Button>
      </div>

      {info ? (
        <p
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
        >
          <Check className="inline size-4 mr-1" aria-hidden="true" />
          {info}
        </p>
      ) : null}
    </div>
  );
}
