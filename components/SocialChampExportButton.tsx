"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_PRESETS: Array<{
  label: string;
  value: string;
  description: string;
}> = [
  {
    label: "queued + error",
    value: "queued,error",
    description: "Rows outbox hasn't shipped yet — the typical fallback set.",
  },
  {
    label: "queued only",
    value: "queued",
    description: "Just the rows that haven't tried to publish yet.",
  },
  {
    label: "error only",
    value: "error",
    description: "Just the rows the publisher rejected.",
  },
  {
    label: "all statuses",
    value: "all",
    description: "Every row regardless of state.",
  },
];

const FORMAT_OPTIONS: Array<{
  value: "universal" | "youtube";
  label: string;
  description: string;
}> = [
  {
    value: "universal",
    label: "Universal (non-YouTube)",
    description:
      "Twitter, LinkedIn, Facebook, Instagram, Bluesky, TikTok, Pinterest. SocialChamp's wide bulk-uploader template.",
  },
  {
    value: "youtube",
    label: "YouTube",
    description:
      "YouTube-only template with video title, privacy, category, and channel-flag columns. Defaults to VIDEO post type and PUBLIC privacy — re-edit in SocialChamp's UI before publishing.",
  },
];

export function SocialChampExportButton() {
  const [format, setFormat] = useState<"universal" | "youtube">("universal");
  const [statusValue, setStatusValue] = useState(STATUS_PRESETS[0].value);
  const [pending, setPending] = useState(false);

  const selectedFormat = FORMAT_OPTIONS.find((f) => f.value === format);
  const selectedPreset = STATUS_PRESETS.find((p) => p.value === statusValue);

  function buildHref(): string {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("status", statusValue);
    return `/api/admin/export-socialchamp-csv?${params.toString()}`;
  }

  function onDownload() {
    setPending(true);
    const a = document.createElement("a");
    a.href = buildHref();
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => setPending(false), 800);
  }

  return (
    <section
      aria-labelledby="socialchamp-export-heading"
      className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900 space-y-4"
    >
      <header className="space-y-1">
        <h2 id="socialchamp-export-heading" className="text-base font-medium">
          Export to SocialChamp CSV
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Download a SocialChamp-format CSV of the rows you pick below, then
          upload it via{" "}
          <a
            href="https://app.socialchamp.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded underline underline-offset-2 hover:text-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:text-violet-400"
          >
            SocialChamp&rsquo;s bulk-uploader
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          . SocialChamp uses two separate templates depending on whether the
          rows target YouTube — pick the matching one.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Template
          </span>
          <select
            value={format}
            onChange={(e) =>
              setFormat(e.target.value as "universal" | "youtube")
            }
            disabled={pending}
            className="block w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {selectedFormat ? (
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {selectedFormat.description}
            </span>
          ) : null}
        </label>

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
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={onDownload}
          disabled={pending}
          className="w-full sm:w-auto"
        >
          <Download className="size-4" aria-hidden="true" />
          <span>{pending ? "Preparing…" : "Download CSV"}</span>
        </Button>
        <Badge tone="muted">
          Times emit as UTC — pick UTC at upload
        </Badge>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-500">
        SocialChamp&rsquo;s import has no platform/account column — pick
        target accounts in SocialChamp&rsquo;s UI at upload time.
      </p>
    </section>
  );
}
