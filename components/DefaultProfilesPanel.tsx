"use client";

import { useEffect, useState } from "react";
import { Check, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { platformLabel } from "@/lib/platforms";

interface AvailableProfile {
  publisherProfileId: string;
  network: string;
  displayName: string | null;
}

interface NetworkSlot {
  available: AvailableProfile[];
  defaults: string[];
}

interface WorkspaceGroup {
  backend: string;
  workspaceId: string;
  workspaceName: string | null;
  byNetwork: Record<string, NetworkSlot>;
}

interface FetchSuccess {
  ok: true;
  activeBackend: string;
  workspaces: WorkspaceGroup[];
}

export function DefaultProfilesPanel() {
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<FetchSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Local edits keyed by `${backend}|${workspaceId}|${network}` -> string[].
  const [edits, setEdits] = useState<Record<string, string[]>>({});

  async function load() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/default-profiles", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setData(body);
      setEdits({});
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function key(backend: string, workspaceId: string, network: string) {
    return `${backend}|${workspaceId}|${network}`;
  }

  function currentSelection(
    backend: string,
    workspaceId: string,
    network: string,
    slot: NetworkSlot
  ): string[] {
    const k = key(backend, workspaceId, network);
    return edits[k] ?? slot.defaults;
  }

  function toggle(
    backend: string,
    workspaceId: string,
    network: string,
    slot: NetworkSlot,
    id: string
  ) {
    const k = key(backend, workspaceId, network);
    const cur = currentSelection(backend, workspaceId, network, slot);
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setEdits((e) => ({ ...e, [k]: next }));
  }

  async function save(
    backend: string,
    workspaceId: string,
    network: string,
    slot: NetworkSlot
  ) {
    const k = key(backend, workspaceId, network);
    const ids = currentSelection(backend, workspaceId, network, slot);
    setSaving(k);
    setError(null);
    try {
      const res = await fetch("/api/admin/default-profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend,
          workspaceId,
          network,
          publisherProfileIds: ids,
        }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      setSavedAt(k);
      setTimeout(() => {
        setSavedAt((cur) => (cur === k ? null : cur));
      }, 2000);
      // Re-fetch so server-truth wins and we drop the edit.
      await load();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      aria-labelledby="default-profiles-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="default-profiles-heading" className="text-base font-medium">
            Default profiles per (backend, workspace, network)
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            When a post comes in for a given platform, outbox sends to the
            profile(s) you check here. Empty selection → falls back to the
            most-recently-synced profile. Multiple checked → fan out to all
            of them in one publisher call. Each backend (Ocoya, SocialChamp,
            …) has its own per-workspace defaults.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={pending}
          aria-label="Reload defaults"
        >
          <RefreshCw
            className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"}
            aria-hidden="true"
          />
          <span>Reload</span>
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {pending && !data ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : null}

      {data && data.workspaces.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
          No social profiles cached yet. Run <strong>Sync social profiles</strong>{" "}
          above first.
        </p>
      ) : null}

      {data?.workspaces.map((ws) => {
        const networkCount = Object.keys(ws.byNetwork).length;
        const defaultsSetCount = Object.values(ws.byNetwork).filter(
          (slot) => slot.defaults.length > 0
        ).length;
        return (
          <details
            key={`${ws.backend}|${ws.workspaceId}`}
            className="group rounded-md border border-slate-200 dark:border-slate-700"
          >
            <summary className="cursor-pointer list-none p-3 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 rounded-md">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-4 text-slate-400 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                >
                  ▶
                </span>
                <span className="text-sm font-medium">
                  {ws.workspaceName ?? "Workspace"}
                </span>
                <Badge
                  tone={ws.backend === data.activeBackend ? "violet" : "muted"}
                >
                  {ws.backend}
                  {ws.backend === data.activeBackend ? " · active" : ""}
                </Badge>
                <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
                  {networkCount} network{networkCount === 1 ? "" : "s"} ·{" "}
                  {defaultsSetCount} default
                  {defaultsSetCount === 1 ? "" : "s"} set
                </span>
              </div>
              <div className="mt-1 ml-6 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <code className="font-mono break-all">{ws.workspaceId}</code>
                {ws.backend === "ocoya" ? (
                  <a
                    href={`/api/admin/ocoya-profile-debug?workspaceId=${encodeURIComponent(ws.workspaceId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:text-violet-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    inspect raw response
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                ) : null}
                {ws.backend === "socialchamp" ? (
                  <a
                    href="/api/admin/socialchamp-debug?path=v1/rest/profile"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:text-violet-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    inspect raw response
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                ) : null}
              </div>
            </summary>
            <div className="space-y-3 border-t border-slate-200 dark:border-slate-700 p-3">
            {Object.entries(ws.byNetwork)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([network, slot]) => {
                const selected = currentSelection(
                  ws.backend,
                  ws.workspaceId,
                  network,
                  slot
                );
                const k = key(ws.backend, ws.workspaceId, network);
                const isDirty = edits[k] !== undefined;
                return (
                  <fieldset
                    key={network}
                    className="rounded border border-slate-200 dark:border-slate-700 p-3"
                  >
                    <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                      {platformLabel(network)} ({slot.available.length} available)
                    </legend>
                    <ul className="space-y-2">
                      {slot.available.map((p) => {
                        const checked = selected.includes(p.publisherProfileId);
                        return (
                          <li key={p.publisherProfileId}>
                            <label className="flex items-start gap-3 cursor-pointer min-h-11 py-1">
                              <input
                                type="checkbox"
                                className="mt-1 size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                                checked={checked}
                                onChange={() =>
                                  toggle(
                                    ws.backend,
                                    ws.workspaceId,
                                    network,
                                    slot,
                                    p.publisherProfileId
                                  )
                                }
                                disabled={saving === k}
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
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={isDirty ? "primary" : "secondary"}
                        disabled={!isDirty || saving === k}
                        onClick={() =>
                          save(ws.backend, ws.workspaceId, network, slot)
                        }
                      >
                        {savedAt === k ? (
                          <>
                            <Check className="size-4" aria-hidden="true" />
                            <span>Saved</span>
                          </>
                        ) : (
                          <>
                            <Save className="size-4" aria-hidden="true" />
                            <span>{saving === k ? "Saving…" : "Save"}</span>
                          </>
                        )}
                      </Button>
                      {slot.defaults.length === 0 ? (
                        <Badge tone="muted">Falls back to any-match</Badge>
                      ) : (
                        <Badge tone="emerald">
                          {slot.defaults.length} default
                          {slot.defaults.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </details>
        );
      })}
    </section>
  );
}
