"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copy this row into a fresh draft (slice 33). Always allowed —
 * works on any status. Server creates a new row with same caption /
 * media / platform / profile selection, status=draft, scheduled_at
 * placeholder. Client redirects to the new row's detail page so the
 * operator can edit + schedule.
 */
export function CopyPostButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/scheduled-posts/${encodeURIComponent(postId)}/copy`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!res.ok || body.ok !== true || !body.newId) {
        setError(body.error ?? `failed (${res.status})`);
        return;
      }
      router.push(`/outbox/${body.newId}`);
    } catch (err) {
      const code = err instanceof Error ? err.name : "UnknownError";
      setError(`Network error: ${code}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={copy}
        disabled={pending}
      >
        <Copy className="size-4" aria-hidden="true" />
        <span>{pending ? "Copying…" : "Copy to new draft"}</span>
      </Button>
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
