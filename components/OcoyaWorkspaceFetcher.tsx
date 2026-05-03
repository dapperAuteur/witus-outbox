"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface OcoyaWorkspace {
  id: string;
  name: string | null;
}

interface ConfiguredWorkspace {
  name: string;
  id: string;
}

interface FetchSuccess {
  ok: true;
  workspaces: OcoyaWorkspace[];
  configured: ConfiguredWorkspace[];
}

interface FetchFailure {
  ok: false;
  error: string;
  status?: number;
}

type FetchResponse = FetchSuccess | FetchFailure;

export function OcoyaWorkspaceFetcher() {
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<FetchSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function fetchWorkspaces() {
    setError(null);
    setData(null);
    setCopiedId(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/ocoya-workspaces", {
        method: "GET",
        cache: "no-store",
      });
      const body: FetchResponse = await res.json();
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setData(body);
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(false);
    }
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setError("Could not copy. Select the ID manually and copy with your keyboard.");
    }
  }

  return (
    <section
      aria-labelledby="ocoya-workspace-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <header className="space-y-1">
        <h2 id="ocoya-workspace-heading" className="text-base font-medium">
          Ocoya workspaces
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Fetches the list of workspaces from the Ocoya API using the
          server-side <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">OCOYA_API_KEY</code>.
          Copy each workspace ID you want outbox to publish into, then save
          them as a JSON array in{" "}
          <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-xs">OCOYA_WORKSPACE_IDS</code>{" "}
          (Production + Preview + local). Format:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-100 dark:bg-slate-800 p-2 text-[11px] leading-relaxed">
{`OCOYA_WORKSPACE_IDS='[
  {"name":"WitUS Main","id":"abc123"},
  {"name":"Tour","id":"def456"}
]'`}
        </pre>
      </header>

      <Button
        type="button"
        onClick={fetchWorkspaces}
        disabled={pending}
        className="w-full sm:w-auto"
        aria-describedby={error ? "ocoya-workspace-error" : undefined}
      >
        <RefreshCw
          className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"}
          aria-hidden="true"
        />
        <span>{pending ? "Fetching workspaces…" : "Fetch workspaces"}</span>
      </Button>

      {error ? (
        <p
          id="ocoya-workspace-error"
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {data ? (
        data.workspaces.length === 0 ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
            Ocoya returned an empty workspace list. Make sure the API key has
            access to at least one workspace.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.workspaces.map((w) => {
              const configured = data.configured.find((c) => c.id === w.id);
              return (
                <li
                  key={w.id}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
                      {w.name ?? "(unnamed workspace)"}
                    </span>
                    {configured ? (
                      <Badge tone="emerald">
                        Configured as &ldquo;{configured.name}&rdquo;
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs break-all text-slate-700 dark:text-slate-300 flex-1 min-w-0">
                      {w.id}
                    </code>
                    <Button
                      type="button"
                      variant={copiedId === w.id ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => copyId(w.id)}
                      aria-label={`Copy workspace ID ${w.id}`}
                      className="shrink-0"
                    >
                      {copiedId === w.id ? (
                        <>
                          <Check className="size-4" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-4" aria-hidden="true" />
                          <span>Copy ID</span>
                        </>
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {data && data.configured.length > 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 p-3 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Currently configured (OCOYA_WORKSPACE_IDS)
          </p>
          <ul className="space-y-1 text-xs">
            {data.configured.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-slate-900 dark:text-slate-50">
                  {c.name}
                </span>
                <code className="font-mono break-all text-slate-600 dark:text-slate-400">
                  {c.id}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
