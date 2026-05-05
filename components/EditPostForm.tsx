"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Edit form for caption + mediaUrls (slice 33). Renders inline on
 * /outbox/[id] when status ∈ {draft, queued, error, cancelled}. The
 * server-side editPost guard refuses non-editable statuses, but this
 * component is also conditionally rendered on the page.
 *
 * Reschedule + profile selection are handled by their own components
 * (PostActions and RowProfileOverride respectively); this one is only
 * the content editor.
 */
export function EditPostForm({
  postId,
  initialCaption,
  initialMediaUrls,
}: {
  postId: string;
  initialCaption: string;
  initialMediaUrls: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(initialCaption);
  const [mediaUrls, setMediaUrls] = useState<string[]>(
    initialMediaUrls.length === 0 ? [""] : initialMediaUrls
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCaption(initialCaption);
    setMediaUrls(initialMediaUrls.length === 0 ? [""] : initialMediaUrls);
    setError(null);
  }

  function cancel() {
    reset();
    setEditing(false);
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

  async function save() {
    setError(null);
    setPending(true);
    try {
      const cleanedMedia = mediaUrls
        .map((u) => u.trim())
        .filter((u) => u.length > 0);
      const captionTrimmed = caption.trim();
      const body: { caption?: string; mediaUrls?: string[] } = {};
      if (captionTrimmed !== initialCaption) body.caption = captionTrimmed;
      if (
        cleanedMedia.length !== initialMediaUrls.length ||
        cleanedMedia.some((u, i) => u !== initialMediaUrls[i])
      ) {
        body.mediaUrls = cleanedMedia;
      }
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      const res = await fetch(
        `/api/admin/scheduled-posts/${encodeURIComponent(postId)}/edit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const responseBody = await res.json();
      if (!res.ok || responseBody.ok !== true) {
        setError(responseBody.error ?? `failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setEditing(true)}
      >
        Edit caption / media
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Caption</label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={6}
          className="block w-full rounded-md border border-slate-300 bg-white p-3 text-sm focus-visible:border-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Media URLs
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
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={save}
          disabled={pending}
        >
          <Save className="size-4" aria-hidden="true" />
          <span>{pending ? "Saving…" : "Save changes"}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={cancel}
          disabled={pending}
        >
          <X className="size-4" aria-hidden="true" />
          <span>Cancel</span>
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
