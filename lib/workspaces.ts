import "server-only";
import { z } from "zod";
import { getEnv } from "./env";

const WorkspaceEntry = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
});
const WorkspacesSchema = z.array(WorkspaceEntry);

export interface WorkspaceConfig {
  name: string;
  id: string;
}

let cached: { byName: Map<string, string>; ordered: WorkspaceConfig[] } | null =
  null;

function loadWorkspaces(): {
  byName: Map<string, string>;
  ordered: WorkspaceConfig[];
} {
  if (cached) return cached;
  const raw = getEnv().OCOYA_WORKSPACE_IDS;
  const byName = new Map<string, string>();
  const ordered: WorkspaceConfig[] = [];
  if (!raw) {
    cached = { byName, ordered };
    return cached;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[workspaces] OCOYA_WORKSPACE_IDS is not valid JSON");
    cached = { byName, ordered };
    return cached;
  }
  const result = WorkspacesSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[workspaces] OCOYA_WORKSPACE_IDS schema invalid");
    cached = { byName, ordered };
    return cached;
  }
  for (const entry of result.data) {
    byName.set(entry.name, entry.id);
    ordered.push({ name: entry.name, id: entry.id });
  }
  cached = { byName, ordered };
  return cached;
}

export function getWorkspaceIdByName(name: string): string | null {
  return loadWorkspaces().byName.get(name) ?? null;
}

export function listConfiguredWorkspaces(): WorkspaceConfig[] {
  return loadWorkspaces().ordered;
}

/**
 * The first configured workspace, used as a fallback when a source has no
 * `workspace_name` set. Returns null when no workspaces are configured —
 * caller should treat that as "dev-log mode" or "no real send."
 */
export function getDefaultWorkspaceId(): string | null {
  return loadWorkspaces().ordered[0]?.id ?? null;
}
