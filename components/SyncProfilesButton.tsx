"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SyncSuccess {
  ok: true;
  backends: Array<{
    backend: string;
    profilesUpserted: number;
    workspaces: Array<{ workspaceId: string | null; profilesFound: number }>;
  }>;
  totalUpserted: number;
  notConfigured?: boolean;
}

interface SyncFailure {
  ok: false;
  error: string;
}

type SyncResponse = SyncSuccess | SyncFailure;

export function SyncProfilesButton() {
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<SyncSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function syncNow() {
    setError(null);
    setData(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/sync-profiles", {
        method: "POST",
        cache: "no-store",
      });
      const body: SyncResponse = await res.json();
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

  return (
    <section
      aria-labelledby="sync-profiles-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <header className="space-y-1">
        <h2 id="sync-profiles-heading" className="text-base font-medium">
          Sync social profiles
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Pulls connected social accounts from <strong>every configured
          publisher backend</strong> (Ocoya, SocialChamp, etc.) into the
          local cache. Run after connecting accounts in any vendor&rsquo;s
          dashboard. Backends without an API key in env are skipped.
        </p>
      </header>

      <Button
        type="button"
        onClick={syncNow}
        disabled={pending}
        className="w-full sm:w-auto"
        aria-describedby={error ? "sync-profiles-error" : undefined}
      >
        <RefreshCw
          className={pending ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"}
          aria-hidden="true"
        />
        <span>{pending ? "Syncing…" : "Sync now"}</span>
      </Button>

      {error ? (
        <p
          id="sync-profiles-error"
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {data?.notConfigured ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
          No publisher backend has credentials in this environment.
          Set <code>OCOYA_API_KEY</code> and/or <code>SOCIAL_CHAMP_API_KEY</code>{" "}
          to enable syncing.
        </p>
      ) : data ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Synced from <strong>{data.backends.length}</strong> backend
            {data.backends.length === 1 ? "" : "s"}:{" "}
            <Badge tone={data.totalUpserted > 0 ? "emerald" : "amber"}>
              {data.totalUpserted} profile
              {data.totalUpserted === 1 ? "" : "s"}
            </Badge>
          </p>
          {data.backends.length > 0 ? (
            <ul className="space-y-2 text-xs">
              {data.backends.map((b) => (
                <li
                  key={b.backend}
                  className="rounded border border-slate-200 dark:border-slate-700 p-2"
                >
                  <div className="font-medium text-slate-900 dark:text-slate-50">
                    {b.backend}
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    {b.profilesUpserted} upserted ·{" "}
                    {b.workspaces.length} workspace
                    {b.workspaces.length === 1 ? "" : "s"}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {data.totalUpserted === 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
              0 profiles upserted. Connect social accounts in your publisher
              dashboard(s):{" "}
              <a
                href="https://app.ocoya.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              >
                app.ocoya.com
              </a>{" "}
              ·{" "}
              <a
                href="https://app.socialchamp.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-amber-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
              >
                app.socialchamp.com
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
