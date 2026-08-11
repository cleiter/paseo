import { SIDEBAR_GROUP_MODES } from "@/components/sidebar/grouping-labels";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface GroupingCommandCenterSource {
  groupMode: SidebarGroupMode;
  sectionTitle: string;
  labels: Record<SidebarGroupMode, string>;
  icons: Partial<Record<SidebarGroupMode, CommandCenterIcon>>;
  setGroupMode(mode: SidebarGroupMode): void;
}

/** Words that should find any of the entries, whichever mode you are in. */
const SHARED_KEYWORDS = ["group", "grouping", "sort", "sidebar"];

const MODE_KEYWORDS: Record<SidebarGroupMode, readonly string[]> = {
  project: ["project", "repo", "folder"],
  status: ["status", "state"],
  label: ["label", "labels", "tag", "tags"],
};

/**
 * One entry per mode you are not in, so none of them can read as a no-op and every mode is
 * reachable in a single press. Driven by `SIDEBAR_GROUP_MODES` rather than a list of its own —
 * the palette is the fourth surface offering these modes, and a fifth mode should not need a
 * fifth edit.
 */
export function buildGroupingContributions(
  source: GroupingCommandCenterSource,
): CommandCenterContribution[] {
  return SIDEBAR_GROUP_MODES.filter((mode) => mode !== source.groupMode).map((mode, index) => ({
    id: `sidebar-grouping-${mode}`,
    group: "actions",
    groupRank: 0,
    // 6 is keyboard-shortcuts and 7 belongs to the workspace actions in #3013. The offset keeps
    // the entries in SIDEBAR_GROUP_MODES order; equal ranks would sort them by id instead.
    rank: 8 + index,
    keywords: [...SHARED_KEYWORDS, ...MODE_KEYWORDS[mode]],
    visibility: "query",
    run: () => source.setGroupMode(mode),
    presentation: {
      kind: "action",
      title: source.labels[mode],
      sectionTitle: source.sectionTitle,
      icon: source.icons[mode],
    },
  }));
}
