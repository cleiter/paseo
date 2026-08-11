import { create } from "zustand";
import type { WorkspaceLabelTarget } from "./model";

/**
 * What the label dialog is currently being asked to do, if anything.
 *
 * A store rather than component state because every caller is a surface that closes as it opens
 * the dialog — a menu page, a settings row's menu — so a modal owned by the caller would be
 * unmounted by the press that asked for it. One request at a time: two label dialogs on screen
 * would be editing the same catalog from two drafts.
 *
 * `create` carries the workspace to hang the new label on, or null when the label is being made
 * from Settings and has nothing to hang on yet.
 */
export type WorkspaceLabelDialogRequest =
  | { mode: "create"; target: WorkspaceLabelTarget | null }
  | { mode: "edit"; label: string };

interface WorkspaceLabelDialogState {
  request: WorkspaceLabelDialogRequest | null;
  open: (request: WorkspaceLabelDialogRequest) => void;
  close: () => void;
}

export const useWorkspaceLabelDialogStore = create<WorkspaceLabelDialogState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/** From a workspace's menu: name it, colour it, and put it on that workspace. */
export function promptForNewWorkspaceLabel(target: WorkspaceLabelTarget): void {
  useWorkspaceLabelDialogStore.getState().open({ mode: "create", target });
}

/** From Settings, where there is no workspace in front of you to attach it to. */
export function promptToCreateWorkspaceLabel(): void {
  useWorkspaceLabelDialogStore.getState().open({ mode: "create", target: null });
}

export function promptToEditWorkspaceLabel(label: string): void {
  useWorkspaceLabelDialogStore.getState().open({ mode: "edit", label });
}
