import type { SidebarGroupMode } from "@/stores/sidebar-view-store";

/** The order every surface offers the grouping modes in. */
export const SIDEBAR_GROUP_MODES: readonly SidebarGroupMode[] = ["project", "status", "label"];

/**
 * One name per grouping mode, shared by the display menu, the saved-view editor, and the summary a
 * view describes itself with — three places that would otherwise each pick their own wording for
 * the same three modes.
 */
export const SIDEBAR_GROUP_MODE_LABEL_KEYS: Record<SidebarGroupMode, string> = {
  project: "sidebar.display.grouping.project",
  status: "sidebar.display.grouping.status",
  label: "sidebar.display.grouping.byLabel",
};
