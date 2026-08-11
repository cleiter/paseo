import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { SidebarFilterResult } from "./sidebar-filter";
import {
  buildLabelSidebarGroups,
  toSidebarGroupsFromStatus,
  type SidebarGroup,
} from "./sidebar-groups";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  /** The headed sections of a flat mode — status buckets or labels. Empty in project mode. */
  groups: SidebarGroup[];
  shortcutModel: SidebarShortcutModel;
}

/**
 * The filter is applied once, here, before the pinned split. Every downstream shape — the pinned
 * section, the status buckets, the project sections, the number keys — is built from the result,
 * so a hidden workspace is hidden everywhere and counted exactly once.
 *
 * `splitPinnedSidebarGroups` filtering pinned keys out before `buildStatusGroups` is the existing
 * miniature of getting this wrong: collapse the Pinned section and a pinned workspace that needs
 * input is nowhere in the sidebar.
 */
function applyFilterToProjects(
  projects: SidebarProjectEntry[],
  filter: SidebarFilterResult,
): SidebarProjectEntry[] {
  if (!filter.isFiltering) return projects;
  const passesProject = (project: SidebarProjectEntry): boolean =>
    filter.includedProjectKeys.size === 0 || filter.includedProjectKeys.has(project.viewKey);
  const filtered: SidebarProjectEntry[] = [];
  for (const project of projects) {
    const workspaces = project.workspaces.filter((workspace) =>
      filter.visibleKeys.has(workspace.workspaceKey),
    );
    // A project that lost every row goes with them, rather than sitting there as a header with
    // nothing under it. The one empty project the sidebar keeps is the one that was empty to begin
    // with — its "new workspace" row is the only way into it — and even that goes if the project
    // filter is the thing excluding it.
    if (workspaces.length === 0 && (project.workspaces.length > 0 || !passesProject(project))) {
      continue;
    }
    filtered.push(
      workspaces.length === project.workspaces.length ? project : { ...project, workspaces },
    );
  }
  return filtered;
}

export function buildSidebarProjection(input: {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  knownLabels: readonly string[];
  unlabelledLabel: string;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedStatusGroupKeys: ReadonlySet<string>;
  collapsedLabelGroupKeys: ReadonlySet<string>;
  filter: SidebarFilterResult;
}): SidebarProjection {
  const projects = applyFilterToProjects(input.projects, input.filter);
  const pinnedGroups = splitPinnedSidebarGroups({
    projects,
    keys: input.pinnedKeys,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const isFlatMode = input.groupMode === "status" || input.groupMode === "label";
  const flatWorkspaces = isFlatMode
    ? Array.from(input.workspaceEntriesByKey.values()).filter(
        (workspace) =>
          !pinnedWorkspaceKeys.has(workspace.workspaceKey) &&
          (!input.filter.isFiltering || input.filter.visibleKeys.has(workspace.workspaceKey)),
      )
    : [];
  const groups = buildFlatGroups({ ...input, workspaces: flatWorkspaces });

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (isFlatMode) {
    const collapsedKeys =
      input.groupMode === "status" ? input.collapsedStatusGroupKeys : input.collapsedLabelGroupKeys;
    sections.push(
      ...groups.map((group) => ({
        workspaces: group.rows,
        collapsed: collapsedKeys.has(group.key),
      })),
    );
  } else {
    sections.push(
      ...pinnedGroups.unpinnedProjects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.viewKey),
      })),
    );
  }

  return {
    pinnedGroups,
    groups,
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

function buildFlatGroups(input: {
  workspaces: SidebarWorkspaceEntry[];
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  knownLabels: readonly string[];
  unlabelledLabel: string;
}): SidebarGroup[] {
  if (input.groupMode === "status") {
    return toSidebarGroupsFromStatus(
      buildStatusGroups(input.workspaces, input.projectNamesByViewKey),
    );
  }
  if (input.groupMode === "label") {
    return buildLabelSidebarGroups({
      workspaces: input.workspaces,
      knownLabels: input.knownLabels,
      projectNamesByViewKey: input.projectNamesByViewKey,
      unlabelledLabel: input.unlabelledLabel,
    });
  }
  return [];
}
