"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Switch } from "@headlessui/react";
import { Button } from "@/components/ui/button";
import {
  PLATFORMS,
  PLATFORM_CHAR_LIMITS,
  platformLabel,
  type Platform,
} from "@/lib/platforms";

interface AvailableProfile {
  publisherProfileId: string;
  network: string;
  displayName: string | null;
}

interface ProfilesByPlatform {
  [platform: string]: AvailableProfile[];
}

/**
 * In-outbox composer (slice 31). Lets the operator create scheduled
 * posts directly inside outbox without going through an external
 * publisher. Fan-out semantics: ONE click → N rows (one per selected
 * platform), each with its own status, retry budget, and audit trail.
 *
 * Slug stamped on every row: `outbox-composer` (see
 * lib/composer-actions.ts COMPOSER_SOURCE). Filter the triage list
 * via /outbox?source=outbox-composer.
 */
export function Composer({
  defaultScheduledAtIso,
}: {
  defaultScheduledAtIso: string;
}) {
  const router = useRouter();

  const initialLocal = useMemo(() => {
    const d = new Date(defaultScheduledAtIso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [defaultScheduledAtIso]);

  const [caption, setCaption] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([""]);
  const [platforms, setPlatforms] = useState<Set<Platform>>(() => new Set());
  const [scheduledLocal, setScheduledLocal] = useState(initialLocal);
  const [submitNow, setSubmitNow] = useState(false);
  const [pending, setPending] = useState<null | "compose" | "csv-radaar" | "csv-socialchamp">(null);
  const [error, setError] = useState<string | null>(null);

  // Per-platform profile cache: pulled once from /api/admin/default-profiles
  // and indexed by canonical network. Operator picks which profiles each
  // selected platform should fan out to; defaults to ALL available so a
  // first-time submit doesn't error with no_social_profile.
  const [profilesByPlatform, setProfilesByPlatform] = useState<ProfilesByPlatform>({});
  const [profileSelection, setProfileSelection] = useState<
    Partial<Record<Platform, Set<string>>>
  >({});
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/default-profiles", {
          cache: "no-store",
        });
        const body = await res.json();
        if (!body.ok) {
          if (!cancelled) {
            setProfilesError(body.error ?? "failed to load profiles");
            setProfilesLoaded(true);
          }
          return;
        }
        // Flatten across all workspaces of the active backend → indexed
        // by network. Multi-workspace operators can refine via the
        // per-row override on /outbox/[id] after save.
        const byPlatform: ProfilesByPlatform = {};
        type WorkspaceShape = {
          backend: string;
          byNetwork: Record<string, { available: AvailableProfile[] }>;
        };
        const workspaces: WorkspaceShape[] = Array.isArray(body.workspaces)
          ? body.workspaces
          : [];
        for (const ws of workspaces) {
          if (ws.backend !== body.activeBackend) continue;
          for (const [network, slot] of Object.entries(ws.byNetwork)) {
            if (!byPlatform[network]) byPlatform[network] = [];
            for (const p of slot.available) {
              if (
                !byPlatform[network].some(
                  (existing) => existing.publisherProfileId === p.publisherProfileId
                )
              ) {
                byPlatform[network].push(p);
              }
            }
          }
        }
        if (!cancelled) {
          setProfilesByPlatform(byPlatform);
          setProfilesLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          const code = err instanceof Error ? err.name : "UnknownError";
          setProfilesError(`Network error: ${code}`);
          setProfilesLoaded(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlatforms = useMemo(() => Array.from(platforms), [platforms]);
  const cleanedMediaUrls = useMemo(
    () =>
      mediaUrls
        .map((u) => u.trim())
        .filter((u) => u.length > 0),
    [mediaUrls]
  );

  // Per-platform overage list — only shows for selected platforms over their limit.
  const overages = useMemo(() => {
    const out: Array<{ platform: Platform; limit: number; over: number }> = [];
    for (const p of selectedPlatforms) {
      const limit = PLATFORM_CHAR_LIMITS[p];
      if (caption.length > limit) {
        out.push({ platform: p, limit, over: caption.length - limit });
      }
    }
    return out;
  }, [caption, selectedPlatforms]);

  function togglePlatform(p: Platform) {
    setPlatforms((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
    // First-time platform selection: pre-check ALL available profiles for
    // that platform. Saves a click for the common case (1 profile per
    // network) and prevents the "submit now → no_social_profile" error.
    setProfileSelection((cur) => {
      if (cur[p]) return cur; // already initialized
      const available = profilesByPlatform[p] ?? [];
      const next = { ...cur };
      next[p] = new Set(available.map((a) => a.publisherProfileId));
      return next;
    });
  }

  function toggleProfile(p: Platform, profileId: string) {
    setProfileSelection((cur) => {
      const set = new Set(cur[p] ?? []);
      if (set.has(profileId)) set.delete(profileId);
      else set.add(profileId);
      return { ...cur, [p]: set };
    });
  }

  function updateMediaUrl(i: number, value: string) {
    setMediaUrls((cur) => cur.map((u, idx) => (idx === i ? value : u)));
  }

  function addMediaUrl() {
    setMediaUrls((cur) => [...cur, ""]);
  }

  function removeMediaUrl(i: number) {
    setMediaUrls((cur) =>
      cur.length === 1 ? [""] : cur.filter((_, idx) => idx !== i)
    );
  }

  function canSubmit(): boolean {
    if (pending !== null) return false;
    if (caption.trim().length === 0) return false;
    if (selectedPlatforms.length === 0) return false;
    if (!scheduledLocal) return false;
    return true;
  }

  function buildProfileIdsByPlatform(): Partial<Record<Platform, string[]>> {
    const out: Partial<Record<Platform, string[]>> = {};
    for (const p of selectedPlatforms) {
      const ids = Array.from(profileSelection[p] ?? []);
      if (ids.length > 0) out[p] = ids;
    }
    return out;
  }

  async function compose(targetMode: "compose" | "csv-radaar" | "csv-socialchamp") {
    if (!canSubmit()) return;
    setPending(targetMode);
    setError(null);
    try {
      const iso = new Date(scheduledLocal).toISOString();
      // CSV-export modes always save as drafts so the rows are recoverable
      // and so the existing exporters can pick them up by source filter.
      const asDraft = targetMode !== "compose" ? true : !submitNow;
      const res = await fetch("/api/admin/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption: caption.trim(),
          mediaUrls: cleanedMediaUrls,
          platforms: selectedPlatforms,
          scheduledAt: iso,
          asDraft,
          profileIdsByPlatform: buildProfileIdsByPlatform(),
        }),
      });
      const body = await res.json();
      if (!res.ok || body.ok !== true) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      if (targetMode === "csv-radaar") {
        // Trigger CSV download in same tab; status=all so drafts are included.
        window.location.href =
          "/api/admin/export-radaar-csv?source=outbox-composer&status=all";
        return;
      }
      if (targetMode === "csv-socialchamp") {
        // SocialChamp's exporter requires `format` — universal covers all
        // non-YouTube; YouTube needs format=youtube. Send to the universal
        // one; if all selected platforms were youtube, switch.
        const allYouTube = selectedPlatforms.every((p) => p === "youtube");
        const fmt = allYouTube ? "youtube" : "universal";
        window.location.href = `/api/admin/export-socialchamp-csv?format=${fmt}&source=outbox-composer&status=all`;
        return;
      }
      // Default "compose" mode → redirect to triage.
      router.push(
        submitNow
          ? "/outbox?source=outbox-composer"
          : "/outbox?status=draft&source=outbox-composer"
      );
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Caption */}
      <section className="space-y-2">
        <label htmlFor="composer-caption" className="block text-sm font-medium">
          Caption
        </label>
        <textarea
          id="composer-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={6}
          className="block w-full rounded-md border border-slate-300 bg-white p-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
          placeholder="What do you want to say?"
        />
        <CharCounter
          length={caption.length}
          selectedPlatforms={selectedPlatforms}
        />
        {overages.length > 0 ? (
          <ul
            role="alert"
            className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
          >
            {overages.map((o) => (
              <li key={o.platform} className="flex items-start gap-2">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <strong>{platformLabel(o.platform)}</strong> over by{" "}
                  {o.over} chars (limit {o.limit}). Vendor may truncate or
                  reject. Submission allowed; you decide.
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Platforms */}
      <section className="space-y-2">
        <fieldset>
          <legend className="block text-sm font-medium">
            Platforms
            {selectedPlatforms.length > 0 ? (
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                ({selectedPlatforms.length} selected · {selectedPlatforms.length} row{selectedPlatforms.length === 1 ? "" : "s"} will be created)
              </span>
            ) : null}
          </legend>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PLATFORMS.map((p) => {
              const checked = platforms.has(p);
              return (
                <li key={p}>
                  <label className="flex min-h-11 items-center gap-2 cursor-pointer rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50 has-[:checked]:border-violet-500 has-[:checked]:bg-violet-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:has-[:checked]:border-violet-400 dark:has-[:checked]:bg-violet-900/30">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlatform(p)}
                      className="size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                    />
                    <span className="text-sm">{platformLabel(p)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </section>

      {/* Profile picker per selected platform */}
      {selectedPlatforms.length > 0 ? (
        <section className="space-y-2">
          <fieldset>
            <legend className="block text-sm font-medium">
              Profiles
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                pick which account(s) each platform posts from
              </span>
            </legend>
            {!profilesLoaded ? (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Loading profile cache…
              </p>
            ) : profilesError ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
              >
                Could not load profiles ({profilesError}). Submit-now will
                fall back to (workspace, network) defaults; if none exist
                the row flips to error. Save as draft + edit on the detail
                page is safer.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {selectedPlatforms.map((p) => {
                  const available = profilesByPlatform[p] ?? [];
                  const selected = profileSelection[p] ?? new Set();
                  return (
                    <fieldset
                      key={p}
                      className="rounded border border-slate-200 dark:border-slate-700 p-3"
                    >
                      <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        {platformLabel(p)} ({available.length} available)
                      </legend>
                      {available.length === 0 ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          No {platformLabel(p)} profiles cached for this
                          workspace. Sync at <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5">/outbox/setup</code>{" "}
                          first, or submit-now will fail with{" "}
                          <code className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5">no_social_profile</code>.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {available.map((profile) => {
                            const checked = selected.has(profile.publisherProfileId);
                            return (
                              <li key={profile.publisherProfileId}>
                                <label className="flex items-start gap-2 cursor-pointer min-h-11 py-1">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      toggleProfile(p, profile.publisherProfileId)
                                    }
                                    className="mt-1 size-5 rounded border-slate-300 text-violet-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
                                  />
                                  <div className="flex-1 min-w-0 space-y-0.5">
                                    <span className="block text-sm">
                                      {profile.displayName ?? "(unnamed)"}
                                    </span>
                                    <span className="block font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all">
                                      {profile.publisherProfileId}
                                    </span>
                                  </div>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </fieldset>
                  );
                })}
              </div>
            )}
          </fieldset>
        </section>
      ) : null}

      {/* Media URLs */}
      <section className="space-y-2">
        <label className="block text-sm font-medium">
          Media URLs (optional)
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            https only · ≤20
          </span>
        </label>
        <ul className="space-y-2">
          {mediaUrls.map((url, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => updateMediaUrl(i, e.target.value)}
                placeholder="https://cdn.example.com/image.png"
                className="block flex-1 min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
              />
              <button
                type="button"
                onClick={() => removeMediaUrl(i)}
                aria-label="Remove this media URL"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:hover:bg-slate-800"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {mediaUrls.length < 20 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addMediaUrl}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Add another</span>
          </Button>
        ) : null}
      </section>

      {/* Scheduled at */}
      <section className="space-y-2">
        <label htmlFor="composer-when" className="block text-sm font-medium">
          Scheduled for
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            {submitNow ? "≥ 5 min in the future" : "placeholder; you can re-pick at promote"}
          </span>
        </label>
        <input
          id="composer-when"
          type="datetime-local"
          value={scheduledLocal}
          onChange={(e) => setScheduledLocal(e.target.value)}
          className="block w-full sm:w-72 min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </section>

      {/* Mode toggle + submit */}
      <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Switch
            checked={submitNow}
            onChange={setSubmitNow}
            className={
              "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none " +
              (submitNow
                ? "bg-violet-600"
                : "bg-slate-300 dark:bg-slate-700")
            }
            aria-label="Submit now (vs save as draft)"
          >
            <span
              aria-hidden="true"
              className={
                "pointer-events-none inline-block size-6 transform rounded-full bg-white shadow ring-0 transition motion-reduce:transition-none " +
                (submitNow ? "translate-x-5" : "translate-x-0")
              }
            />
          </Switch>
          <div className="text-sm">
            <p className="font-medium">
              {submitNow ? "Submit now" : "Save as draft"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {submitNow
                ? "Each row goes straight to queued and submits to the publisher."
                : "Each row lands as draft. Schedule from /outbox/[id] when ready."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => compose("compose")}
            disabled={!canSubmit()}
          >
            {submitNow ? (
              <>
                <Send className="size-4" aria-hidden="true" />
                <span>
                  {pending === "compose"
                    ? "Submitting…"
                    : `Submit ${selectedPlatforms.length || ""} ${selectedPlatforms.length === 1 ? "post" : "posts"}`.trim()}
                </span>
              </>
            ) : (
              <>
                <Save className="size-4" aria-hidden="true" />
                <span>
                  {pending === "compose"
                    ? "Saving…"
                    : `Save ${selectedPlatforms.length || ""} ${selectedPlatforms.length === 1 ? "draft" : "drafts"}`.trim()}
                </span>
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => compose("csv-radaar")}
            disabled={!canSubmit()}
            title="Save drafts and download as a RADAAR-format CSV"
          >
            <Download className="size-4" aria-hidden="true" />
            <span>
              {pending === "csv-radaar" ? "Building CSV…" : "Save + RADAAR CSV"}
            </span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => compose("csv-socialchamp")}
            disabled={!canSubmit()}
            title="Save drafts and download as a SocialChamp-format CSV"
          >
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            <span>
              {pending === "csv-socialchamp" ? "Building CSV…" : "Save + SocialChamp CSV"}
            </span>
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function CharCounter({
  length,
  selectedPlatforms,
}: {
  length: number;
  selectedPlatforms: Platform[];
}) {
  if (selectedPlatforms.length === 0) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {length} chars · select platforms to see per-vendor limits
      </p>
    );
  }
  const tightest = selectedPlatforms.reduce(
    (acc, p) => Math.min(acc, PLATFORM_CHAR_LIMITS[p]),
    Number.POSITIVE_INFINITY
  );
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      {length} chars · tightest limit:{" "}
      <strong
        className={
          length > tightest
            ? "text-amber-700 dark:text-amber-400"
            : "text-slate-700 dark:text-slate-200"
        }
      >
        {tightest}
      </strong>{" "}
      ({selectedPlatforms.length === 1 ? platformLabel(selectedPlatforms[0]) : "min across selected"})
    </p>
  );
}
