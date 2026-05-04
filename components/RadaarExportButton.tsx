"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { platformLabel } from "@/lib/platforms";

const STATUS_PRESETS: Array<{
  label: string;
  value: string;
  description: string;
}> = [
  {
    label: "queued + error",
    value: "queued,error",
    description: "Rows outbox hasn't shipped to Ocoya — the typical RADAAR fallback set.",
  },
  {
    label: "queued only",
    value: "queued",
    description: "Just the rows that haven't tried to publish yet.",
  },
  {
    label: "error only",
    value: "error",
    description: "Just the rows Ocoya rejected.",
  },
  {
    label: "all statuses",
    value: "all",
    description: "Every row regardless of state. Use with caution.",
  },
];

const PLATFORMS = [
  "all",
  "twitter",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "tiktok",
  "pinterest",
] as const;

export function RadaarExportButton() {
  const [statusValue, setStatusValue] = useState(STATUS_PRESETS[0].value);
  const [platformValue, setPlatformValue] = useState<string>("all");
  const [pending, setPending] = useState(false);

  const selectedPreset = STATUS_PRESETS.find((p) => p.value === statusValue);

  function buildHref(): string {
    const params = new URLSearchParams();
    params.set("status", statusValue);
    if (platformValue !== "all") params.set("platform", platformValue);
    return `/api/admin/export-radaar-csv?${params.toString()}`;
  }

  function onDownload() {
    setPending(true);
    // Use a transient anchor click so we keep the SPA mount and the
    // browser handles the download via Content-Disposition.
    const a = document.createElement("a");
    a.href = buildHref();
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // No reliable client-side "download finished" event — drop pending
    // shortly so the button re-enables.
    setTimeout(() => setPending(false), 800);
  }

  return (
    <section
      aria-labelledby="radaar-export-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <header className="space-y-1">
        <h2 id="radaar-export-heading" className="text-base font-medium">
          Export to RADAAR CSV
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Download a RADAAR-format CSV of the rows you pick below, then
          upload it via{" "}
          <a
            href="https://app.radaar.io"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:text-violet-400"
          >
            RADAAR&rsquo;s bulk-import flow
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          . Useful as a fallback when Ocoya rejected rows or when you want to
          schedule into RADAAR-managed accounts.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-500">
          All rows export with{" "}
          <Badge tone="muted">status=DRAFT</Badge> so RADAAR doesn&rsquo;t
          auto-publish. Confirm + activate inside RADAAR&rsquo;s UI.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Statuses
          </span>
          <select
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value)}
            disabled={pending}
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            {STATUS_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {selectedPreset ? (
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {selectedPreset.description}
            </span>
          ) : null}
        </label>

        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Platform
          </span>
          <select
            value={platformValue}
            onChange={(e) => setPlatformValue(e.target.value)}
            disabled={pending}
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            <option value="all">All platforms</option>
            {PLATFORMS.filter((p) => p !== "all").map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </select>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            RADAAR&rsquo;s import has no platform column — pick one to filter
            here, then select matching accounts in RADAAR at upload time.
          </span>
        </label>
      </div>

      <Button
        type="button"
        onClick={onDownload}
        disabled={pending}
        className="w-full sm:w-auto"
      >
        <Download className="size-4" aria-hidden="true" />
        <span>{pending ? "Preparing…" : "Download CSV"}</span>
      </Button>
    </section>
  );
}
