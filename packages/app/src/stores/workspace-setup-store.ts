import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { create } from "zustand";
import type { SetupTabAutoOpen } from "@/hooks/use-settings";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

export type WorkspaceCreationMethod = "open_project" | "create_worktree";

export interface PendingWorkspaceSetup {
  serverId: string;
  sourceDirectory: string;
  sourceWorkspaceId?: string;
  displayName?: string;
  creationMethod: WorkspaceCreationMethod;
}

export type WorkspaceSetupProgressPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_progress" }
>["payload"];

export type WorkspaceSetupStatusResult = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_status_response" }
>["payload"];

export interface WorkspaceSetupStatusClient {
  fetchWorkspaceSetupStatus: (workspaceId: string) => Promise<WorkspaceSetupStatusResult>;
}

export interface WorkspaceSetupSnapshot extends WorkspaceSetupProgressPayload {
  updatedAt: number;
}

export function shouldShowWorkspaceSetup(snapshot: WorkspaceSetupSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.error !== null || snapshot.detail.commands.length > 0;
}

/**
 * How long after a snapshot arrives its workspace still counts as "just set up".
 *
 * Measured from `updatedAt`, which `upsertProgress` stamps on receipt — so this is time since
 * this client learned about the run, not since the run happened. Fetching a status for the
 * first time therefore looks fresh even for an old workspace.
 */
export const WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS = 30_000;

/**
 * Whether setup went wrong. The run status is the authoritative signal — the server aborts on
 * the first non-zero exit — but the commands are scanned too, so a failure is caught in the
 * window before the run is marked failed, and if setup ever gains non-fatal commands.
 */
export function hasWorkspaceSetupFailure(snapshot: WorkspaceSetupSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return (
    snapshot.status === "failed" ||
    snapshot.detail.commands.some((command) => command.status === "failed")
  );
}

/**
 * Whether a focused workspace should get its Setup tab opened in the background.
 *
 * Every mode opens on failure — the Setup tab is the only place a failed setup shows up, so no
 * mode may hide one. Only `always` consults the freshness window; the other two answer from the
 * run itself, which is why `updatedAt` being receipt time can't mislead them.
 */
export function shouldAutoOpenSetupTab(input: {
  snapshot: WorkspaceSetupSnapshot | null;
  mode: SetupTabAutoOpen;
  now: number;
}): boolean {
  const { snapshot, mode, now } = input;
  if (!shouldShowWorkspaceSetup(snapshot) || !snapshot) {
    return false;
  }
  if (mode === "onFailure") {
    return hasWorkspaceSetupFailure(snapshot);
  }
  if (mode === "untilSuccess") {
    return snapshot.status === "running" || hasWorkspaceSetupFailure(snapshot);
  }
  const isFresh = now - snapshot.updatedAt <= WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS;
  return snapshot.status === "running" || isFresh;
}

/**
 * Whether an auto-opened Setup tab has outlived its purpose and should close itself.
 *
 * Only `untilSuccess` closes anything, and only on a clean finish — a failed run keeps the tab.
 * `isAdopted` is the caller's answer to "did someone choose to look at this tab": an adopted tab
 * belongs to whoever focused it, and closing it would pull content out from under them.
 *
 * The caller also has to confirm it opened the tab itself. A tab opened from **Show Setup** is
 * the user's and is never closed on their behalf.
 */
export function shouldAutoCloseSetupTab(input: {
  snapshot: WorkspaceSetupSnapshot | null;
  mode: SetupTabAutoOpen;
  isAdopted: boolean;
}): boolean {
  const { snapshot, mode, isAdopted } = input;
  if (mode !== "untilSuccess" || isAdopted || !snapshot) {
    return false;
  }
  return snapshot.status === "completed" && !hasWorkspaceSetupFailure(snapshot);
}

interface WorkspaceSetupStoreState {
  pendingWorkspaceSetup: PendingWorkspaceSetup | null;
  snapshots: Record<string, WorkspaceSetupSnapshot>;
  requestedKeys: Set<string>;
  beginWorkspaceSetup: (value: PendingWorkspaceSetup) => void;
  clearWorkspaceSetup: () => void;
  upsertProgress: (input: { serverId: string; payload: WorkspaceSetupProgressPayload }) => void;
  ensureSetupStatus: (input: {
    serverId: string;
    workspaceId: string;
    client: WorkspaceSetupStatusClient;
  }) => void;
  removeWorkspace: (input: { serverId: string; workspaceId: string }) => void;
  clearServer: (serverId: string) => void;
}

function buildWorkspaceSetupKey(input: { serverId: string; workspaceId: string }): string | null {
  return buildWorkspaceTabPersistenceKey(input);
}

export const useWorkspaceSetupStore = create<WorkspaceSetupStoreState>()((set, get) => ({
  pendingWorkspaceSetup: null,
  snapshots: {},
  requestedKeys: new Set(),
  beginWorkspaceSetup: (value) => {
    set({ pendingWorkspaceSetup: value });
  },
  clearWorkspaceSetup: () => {
    set({ pendingWorkspaceSetup: null });
  },
  upsertProgress: ({ serverId, payload }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId: payload.workspaceId });
    if (!key) {
      return;
    }

    set((state) => ({
      snapshots: {
        ...state.snapshots,
        [key]: {
          ...payload,
          updatedAt: Date.now(),
        },
      },
    }));
  },
  ensureSetupStatus: async ({ serverId, workspaceId, client }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return;
    }
    const state = get();
    if (state.snapshots[key] || state.requestedKeys.has(key)) {
      return;
    }

    // requestedKeys is a pure in-flight marker: it dedupes concurrent fetches and is
    // released once the request settles. A settle that stored no snapshot (null snapshot,
    // mismatched workspace, or error) leaves no marker, so a later call can retry; once a
    // snapshot lands, the snapshots[key] guard above prevents redundant refetches.
    set((current) => ({ requestedKeys: new Set(current.requestedKeys).add(key) }));

    try {
      const response = await client.fetchWorkspaceSetupStatus(workspaceId);
      if (response.workspaceId === workspaceId && response.snapshot) {
        get().upsertProgress({
          serverId,
          payload: { workspaceId: response.workspaceId, ...response.snapshot },
        });
      }
    } catch {
      // Swallowed: the finally clears the in-flight marker so a later call retries.
    } finally {
      set((current) => {
        const next = new Set(current.requestedKeys);
        next.delete(key);
        return { requestedKeys: next };
      });
    }
  },
  removeWorkspace: ({ serverId, workspaceId }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return;
    }

    set((state) => {
      if (!(key in state.snapshots)) {
        return state;
      }
      const next = { ...state.snapshots };
      delete next[key];
      return { snapshots: next };
    });
  },
  clearServer: (serverId) => {
    set((state) => {
      const nextEntries = Object.entries(state.snapshots).filter(
        ([key]) => !key.startsWith(`${serverId}:`),
      );
      if (nextEntries.length === Object.keys(state.snapshots).length) {
        return state;
      }
      return { snapshots: Object.fromEntries(nextEntries) };
    });
  },
}));
