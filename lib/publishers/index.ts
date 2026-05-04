import "server-only";
import { getEnv } from "@/lib/env";
import { ocoyaAdapter } from "./ocoya";
import { socialChampAdapter } from "./socialchamp";
import type { PublisherAdapter } from "./types";

/**
 * Returns the active publisher adapter for the current request.
 *
 * Selection is by the `PUBLISHER_BACKEND` env var (default `"ocoya"`).
 * Adding a new backend means: implement `PublisherAdapter` in
 * `lib/publishers/<backend>.ts`, add it to the dispatch below, and flip
 * `PUBLISHER_BACKEND` in the target environment.
 *
 * In-flight rows record their own `publisher_backend`, so a swap mid-stream
 * does NOT break reconciliation for already-submitted posts — the reconciler
 * routes each row through the adapter that originally created it.
 */
export function getPublisher(): PublisherAdapter {
  return getPublisherByBackend(getEnv().PUBLISHER_BACKEND);
}

export function getPublisherByBackend(backend: string): PublisherAdapter {
  if (backend === "ocoya") return ocoyaAdapter;
  if (backend === "socialchamp") return socialChampAdapter;
  throw new Error(`Unknown publisher backend: ${backend}`);
}

const ALL_ADAPTERS: PublisherAdapter[] = [ocoyaAdapter, socialChampAdapter];

/**
 * Returns every adapter that's currently "live" (has the credentials it
 * needs to talk to its vendor). Used by sync-profiles and the multi-
 * backend admin views — the active `PUBLISHER_BACKEND` env decides where
 * NEW posts go, but configured-but-not-active backends are still worth
 * reflecting in the UI so the operator can see their cached profiles.
 */
export function listConfiguredAdapters(): PublisherAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.isLive);
}
