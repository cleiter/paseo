import { useCallback, useEffect } from "react";
import { create } from "zustand";

interface SidebarRowMenuStoreState {
  /** The workspace whose row menu is up, or null when none is. */
  workspaceKey: string | null;
  setOpen: (workspaceKey: string, open: boolean) => void;
}

/**
 * Which sidebar row has a menu open, lifted out of the row.
 *
 * `useOpenKebabMenuVisibility` makes the same move one level down: a menu cannot own the state
 * that decides whether its own trigger is rendered. Here the deciding component is the sidebar
 * list, because the filter takes rows out of it — and a label toggled off in the menu is a filter
 * the row can stop passing while you are standing in it. The row unmounts, and the menu goes with
 * the anchor it was measured against.
 *
 * A close only clears the key when it is still the one that was set, so a menu closing late
 * cannot unpin the row that opened one after it.
 */
export const useSidebarRowMenuStore = create<SidebarRowMenuStoreState>((set) => ({
  workspaceKey: null,
  setOpen: (workspaceKey, open) =>
    set((state) => {
      if (open) return { workspaceKey };
      return state.workspaceKey === workspaceKey ? { workspaceKey: null } : state;
    }),
}));

/**
 * Reports a row's menu open state for as long as the row is mounted.
 *
 * The unmount clears too: a row can go for reasons that have nothing to do with its menu — the
 * host disconnecting, the workspace being archived — and a key left behind would exempt a
 * workspace that is not on screen from a filter forever.
 */
export function useReportSidebarRowMenu(workspaceKey: string): (open: boolean) => void {
  const setOpen = useSidebarRowMenuStore((state) => state.setOpen);
  useEffect(() => () => setOpen(workspaceKey, false), [setOpen, workspaceKey]);
  return useCallback((open: boolean) => setOpen(workspaceKey, open), [setOpen, workspaceKey]);
}
