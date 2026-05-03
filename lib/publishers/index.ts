import "server-only";
import { getEnv } from "@/lib/env";
import { ocoyaAdapter } from "./ocoya";
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
  const backend = getEnv().PUBLISHER_BACKEND;
  if (backend === "ocoya") return ocoyaAdapter;
  throw new Error(`Unknown PUBLISHER_BACKEND: ${backend}`);
}

export function getPublisherByBackend(backend: string): PublisherAdapter {
  if (backend === "ocoya") return ocoyaAdapter;
  throw new Error(`Unknown publisher backend: ${backend}`);
}
