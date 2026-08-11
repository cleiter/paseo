import { create } from "zustand";

/**
 * Which saved view the editor is open on: a new one, an existing one, or none.
 *
 * A store rather than menu state, for the same reason the label prompt is one: the menu closes as
 * it opens the dialog, so a modal the menu owns is unmounted by the press that asked for it. See
 * `workspace-labels/dialog-store.ts`.
 */
interface SavedViewPromptState {
  /** True while a view that does not exist yet is being described. */
  creating: boolean;
  /** The existing view open in the editor, or null. */
  editingViewId: string | null;
  openCreate: () => void;
  openEditor: (viewId: string) => void;
  close: () => void;
}

export const useSavedViewPromptStore = create<SavedViewPromptState>((set) => ({
  creating: false,
  editingViewId: null,
  openCreate: () => set({ creating: true, editingViewId: null }),
  openEditor: (viewId) => set({ creating: false, editingViewId: viewId }),
  close: () => set({ creating: false, editingViewId: null }),
}));

export function promptToSaveSidebarView(): void {
  useSavedViewPromptStore.getState().openCreate();
}

export function promptToEditSidebarView(viewId: string): void {
  useSavedViewPromptStore.getState().openEditor(viewId);
}
