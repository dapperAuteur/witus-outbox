"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Calls router.refresh() on a fixed interval so /outbox and /outbox/[id]
 * pick up new server state (drafts arriving from publishers, status flips
 * from the reconciler, etc.) without an explicit reload (slice 39).
 *
 * Pauses while the document is hidden — a backgrounded tab doesn't need
 * polling traffic. Resumes on visibility return.
 *
 * Default 15s cadence: small enough to feel near-real-time when watching
 * a draft promote → submit → posted, large enough that ten tabs open
 * isn't a measurable load tax. Caller can override per-page.
 */
export function AutoRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    function onVisibility() {
      setPaused(document.visibilityState !== "visible");
    }
    onVisibility(); // initialize
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [paused, intervalMs, router]);

  return null;
}
