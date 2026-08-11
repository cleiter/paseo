import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/** Long enough for a sentence fragment, short enough to fit the menu row it becomes. */
export const MAX_SAVED_VIEW_NAME_LENGTH = 40;

let counter = 0;

/**
 * An id for a saved view. Only ever compared against other ids on this device — views do not sync —
 * so a timestamp plus a counter is enough, and the counter is what keeps two views saved inside the
 * same millisecond apart.
 */
export function createSavedViewId(): string {
  counter += 1;
  return `view-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Whether there is anything to save. An empty arrangement is the sidebar's default, and naming it
 * would produce a view that does nothing when applied.
 */
export function useHasSidebarFilters(): boolean {
  return useSidebarViewStore(
    (state) =>
      state.hostFilters.length > 0 ||
      state.projectFilters.length > 0 ||
      Object.keys(state.labelFilters).length > 0,
  );
}
