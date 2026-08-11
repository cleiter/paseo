import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { selectHostFeature, useHostFeature, useHostFeatureMap } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLabelCatalogStore } from "@/stores/workspace-label-catalog-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { WorkspaceLabelCatalogEntry } from "./catalog";
import type { WorkspaceLabelCatalogHost, WorkspaceLabelCatalogWriteDeps } from "./catalog-writes";
import {
  collectKnownWorkspaceLabels,
  countWorkspaceLabelUsage,
  mergeOfferedWorkspaceLabels,
  sameWorkspaceLabels,
  toggleWorkspaceLabel,
} from "./known-labels";

const NO_LABELS: readonly string[] = [];

export interface WorkspaceLabelTarget {
  serverId: string;
  workspaceId: string;
}

/**
 * A row's `workspaceKey` split back into the two halves it was built from
 * (`sidebar-workspaces-view-model.ts`). The menu takes the key rather than the workspace so that
 * nothing has to thread a new prop down the ten components between the sidebar and a row.
 */
export function parseWorkspaceKey(workspaceKey: string): WorkspaceLabelTarget | null {
  const separatorIndex = workspaceKey.indexOf(":");
  if (separatorIndex <= 0) return null;
  const serverId = workspaceKey.slice(0, separatorIndex);
  const workspaceId = workspaceKey.slice(separatorIndex + 1);
  if (serverId.length === 0 || workspaceId.length === 0) return null;
  return { serverId, workspaceId };
}

export function useWorkspaceLabels(target: WorkspaceLabelTarget | null): readonly string[] {
  return useSessionStore((state) => {
    if (!target) return NO_LABELS;
    const workspaces = state.sessions[target.serverId]?.workspaces;
    const key = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId: target.workspaceId });
    const labels = key ? workspaces?.get(key)?.labels : undefined;
    return labels && labels.length > 0 ? labels : NO_LABELS;
  });
}

/**
 * Every label the menu can offer, from every host rather than the one this row lives on. Labels
 * mean the same thing across hosts, so a label you invented on your laptop has to be one tap away
 * on a workspace that lives on your server — otherwise the same word gets typed twice and the
 * cross-host merge has nothing to merge.
 */
export function useKnownWorkspaceLabels(): string[] {
  const sessions = useSessionStore((state) => state.sessions);
  const catalogs = useWorkspaceLabelCatalogStore((state) => state.catalogs);
  return useMemo(() => {
    const catalog: WorkspaceLabelCatalogEntry[] = [];
    for (const entries of Object.values(catalogs)) {
      if (entries) catalog.push(...entries);
    }
    return collectKnownWorkspaceLabels({
      catalog,
      workspaces: Object.values(sessions).flatMap((session) =>
        session ? Array.from(session.workspaces.values()) : [],
      ),
    });
  }, [catalogs, sessions]);
}

/**
 * The same list, but it only ever grows for as long as the caller is mounted.
 *
 * For a surface that toggles labels rather than reading them: taking a label off the last
 * workspace carrying it drops it out of `useKnownWorkspaceLabels`, and a row that leaves the menu
 * the moment you press it cannot be pressed again. Mount this per open menu — the menu engine
 * unmounts a page when it is popped or the menu closes, which is exactly how long a label should
 * outlive its last carrier.
 */
export function useOfferedWorkspaceLabels(): readonly string[] {
  const known = useKnownWorkspaceLabels();
  const [offered, setOffered] = useState<readonly string[]>(known);
  // Merged during render rather than in the effect, so the row is still there in the same frame
  // the label stops being known. The effect only remembers it for the next one.
  const merged = useMemo(() => mergeOfferedWorkspaceLabels(offered, known), [known, offered]);
  useEffect(() => {
    setOffered((current) => (sameWorkspaceLabels(current, merged) ? current : merged));
  }, [merged]);
  return merged;
}

/**
 * How many workspaces carry each label, across every host — what the Labels settings page says
 * under each name, so the size of a delete is on screen before you press it.
 */
export function useWorkspaceLabelUsageCounts(): ReadonlyMap<string, number> {
  const sessions = useSessionStore((state) => state.sessions);
  return useMemo(
    () =>
      countWorkspaceLabelUsage(
        Object.values(sessions).flatMap((session) =>
          session ? Array.from(session.workspaces.values()) : [],
        ),
      ),
    [sessions],
  );
}

export function useWorkspaceLabelsSupported(target: WorkspaceLabelTarget | null): boolean {
  return useHostFeature(target?.serverId, "workspaceLabels");
}

/**
 * Which hosts exist, which are online, which understand labels — for deciding what to *render*.
 *
 * Do not write from this. `useHostRuntimeConnectionStatuses` hands a component that rendered
 * before the daemon finished connecting a `connecting` status it never revises, so a surface
 * mounted at the app root (the rename prompt) sees every host offline forever while the same hook
 * inside a menu opened a second later sees them online. Writes read the hosts through
 * `readWorkspaceLabelCatalogHosts` at the moment they fire instead.
 */
export function useWorkspaceLabelCatalogHosts(): WorkspaceLabelCatalogHost[] {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const supported = useHostFeatureMap(serverIds, "workspaceLabels");
  const renameSupported = useHostFeatureMap(serverIds, "workspaceLabelRename");
  return useMemo(
    () =>
      serverIds.map((serverId) => ({
        serverId,
        connected: statuses.get(serverId) === "online",
        supported: supported.get(serverId) === true,
        supportsRename: renameSupported.get(serverId) === true,
      })),
    [serverIds, statuses, supported, renameSupported],
  );
}

/**
 * The same list, read from the stores at the instant it is asked for rather than at render time.
 *
 * `connected` is whether there is a client to write through, which is the question the fan-out is
 * actually asking, and it cannot go stale between a render and a press.
 */
export function readWorkspaceLabelCatalogHosts(): WorkspaceLabelCatalogHost[] {
  const runtime = getHostRuntimeStore();
  const sessionState = useSessionStore.getState();
  return runtime.getHosts().map((host) => ({
    serverId: host.serverId,
    connected: runtime.getClient(host.serverId) !== null,
    supported: selectHostFeature(sessionState, host.serverId, "workspaceLabels"),
    supportsRename: selectHostFeature(sessionState, host.serverId, "workspaceLabelRename"),
  }));
}

/** Stable, because both halves read their stores when called rather than closing over a render. */
const WORKSPACE_LABEL_CATALOG_WRITE_DEPS: WorkspaceLabelCatalogWriteDeps = {
  getHosts: readWorkspaceLabelCatalogHosts,
  getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
};

export function useWorkspaceLabelCatalogWriteDeps(): WorkspaceLabelCatalogWriteDeps {
  return WORKSPACE_LABEL_CATALOG_WRITE_DEPS;
}

/**
 * A workspace's labels at the instant they are asked for, for the write paths.
 *
 * A dialog can sit open while another device labels the same workspace, and a write built from
 * the set captured when it opened would silently undo that.
 */
export function readWorkspaceLabels(target: WorkspaceLabelTarget | null): readonly string[] {
  if (!target) return NO_LABELS;
  const workspaces = useSessionStore.getState().sessions[target.serverId]?.workspaces;
  const key = resolveWorkspaceMapKeyByIdentity({ workspaces, workspaceId: target.workspaceId });
  return (key ? workspaces?.get(key)?.labels : undefined) ?? NO_LABELS;
}

export async function writeWorkspaceLabels(input: {
  target: WorkspaceLabelTarget;
  labels: readonly string[];
  hostDisconnectedMessage: string;
}): Promise<void> {
  const client = getHostRuntimeStore().getClient(input.target.serverId);
  if (!client) throw new Error(input.hostDisconnectedMessage);
  await client.setWorkspaceLabels(input.target.workspaceId, [...input.labels]);
}

/**
 * Toggling reads the workspace's labels at press time rather than from a value captured when the
 * menu opened. The menu can sit open while another device labels the same workspace, and sending
 * a stale set would silently undo that write.
 */
export function useToggleWorkspaceLabel(input: {
  target: WorkspaceLabelTarget | null;
  hostDisconnectedMessage: string;
  onError: (error: unknown) => void;
}): (label: string) => void {
  const { target, hostDisconnectedMessage, onError } = input;
  return useCallback(
    (label: string) => {
      if (!target) return;
      void writeWorkspaceLabels({
        target,
        labels: toggleWorkspaceLabel(readWorkspaceLabels(target), label),
        hostDisconnectedMessage,
      }).catch(onError);
    },
    [hostDisconnectedMessage, onError, target],
  );
}
