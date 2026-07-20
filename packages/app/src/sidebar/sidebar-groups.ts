import type { SidebarLayout } from "@getpaseo/protocol/messages";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";

// Sidebar groups sit below the Pinned section: run this on the `unpinnedProjects` that
// splitPinnedSidebarGroups() hands back, never on the raw project list.
//
// Groups come from the layout document, which is the only place they exist. They are
// NOT inferred from the rows they contain, and that distinction is the whole design: a
// group inferred from its members cannot be empty (it disappears when the last row
// leaves) and cannot be reordered (it has no position of its own, only its members').
//
// The rows arriving here are already in document order — useWorkspaceStructure applied
// it — so this only has to decide which bucket each row falls into.

export interface SidebarGroupRef {
  groupId: string;
  groupName: string;
}

export interface SidebarWorkspaceGroup extends SidebarGroupRef {
  workspaces: SidebarWorkspacePlacement[];
}

// `workspaces` is inherited untouched and stays the flat list every existing consumer
// (selection, keyboard shortcuts, creation cleanup) iterates. The grouped fields are
// additive; nothing downstream is forced to know about them.
export interface GroupedSidebarProject extends SidebarProjectEntry {
  workspaceGroups: SidebarWorkspaceGroup[];
  ungroupedWorkspaces: SidebarWorkspacePlacement[];
  // The group this project itself belongs to, so a project row can render its own menu
  // state without the parent having to hand it a lookup table.
  projectGroup: SidebarGroupRef | null;
}

export interface SidebarProjectGroup extends SidebarGroupRef {
  projects: GroupedSidebarProject[];
}

export interface GroupedSidebar {
  projectGroups: SidebarProjectGroup[];
  ungroupedProjects: GroupedSidebarProject[];
  // False when the user has never made a group. The sidebar renders its existing flat
  // path in that case, so someone who does not use grouping sees no change at all.
  hasGroups: boolean;
}

function groupWorkspacesWithinProject(
  project: SidebarProjectEntry,
  layout: SidebarLayout,
  projectGroup: SidebarGroupRef | null,
): GroupedSidebarProject {
  const groups = layout.workspaceGroups.filter((group) => group.projectKey === project.viewKey);
  if (groups.length === 0) {
    return {
      ...project,
      workspaceGroups: [],
      ungroupedWorkspaces: project.workspaces,
      projectGroup,
    };
  }

  const groupIdByWorkspaceKey = new Map<string, string>();
  for (const group of groups) {
    for (const workspaceKey of group.workspaceKeys) {
      groupIdByWorkspaceKey.set(workspaceKey, group.id);
    }
  }

  const membersByGroupId = new Map<string, SidebarWorkspacePlacement[]>();
  const ungroupedWorkspaces: SidebarWorkspacePlacement[] = [];
  for (const workspace of project.workspaces) {
    const groupId = groupIdByWorkspaceKey.get(workspace.workspaceKey);
    if (!groupId) {
      ungroupedWorkspaces.push(workspace);
      continue;
    }
    const members = membersByGroupId.get(groupId) ?? [];
    members.push(workspace);
    membersByGroupId.set(groupId, members);
  }

  return {
    ...project,
    // Straight from the document, so a group with nothing in it still renders. Group
    // order is the document's array order.
    workspaceGroups: groups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      workspaces: membersByGroupId.get(group.id) ?? [],
    })),
    ungroupedWorkspaces,
    projectGroup,
  };
}

export function groupSidebar(input: {
  projects: SidebarProjectEntry[];
  layout: SidebarLayout;
}): GroupedSidebar {
  const { projects, layout } = input;
  const hasGroups = layout.projectGroups.length > 0 || layout.workspaceGroups.length > 0;

  if (!hasGroups) {
    // Nobody has grouped anything: every project falls through with no group headers and
    // its full workspace list intact, so the sidebar renders exactly what it renders
    // today. This is the opt-in invariant, and it is structural rather than a promise —
    // there is no group to bucket by, so no bucketing happens.
    return {
      projectGroups: [],
      ungroupedProjects: projects.map((project) => ({
        ...project,
        workspaceGroups: [],
        ungroupedWorkspaces: project.workspaces,
        projectGroup: null,
      })),
      hasGroups: false,
    };
  }

  const groupIdByProjectKey = new Map<string, string>();
  for (const group of layout.projectGroups) {
    for (const projectKey of group.projectKeys) {
      groupIdByProjectKey.set(projectKey, group.id);
    }
  }
  const groupRefById = new Map<string, SidebarGroupRef>(
    layout.projectGroups.map((group) => [group.id, { groupId: group.id, groupName: group.name }]),
  );

  const membersByGroupId = new Map<string, GroupedSidebarProject[]>();
  const ungroupedProjects: GroupedSidebarProject[] = [];
  for (const project of projects) {
    const groupId = groupIdByProjectKey.get(project.viewKey);
    const grouped = groupWorkspacesWithinProject(
      project,
      layout,
      groupId ? (groupRefById.get(groupId) ?? null) : null,
    );
    if (!groupId) {
      ungroupedProjects.push(grouped);
      continue;
    }
    const members = membersByGroupId.get(groupId) ?? [];
    members.push(grouped);
    membersByGroupId.set(groupId, members);
  }

  return {
    projectGroups: layout.projectGroups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      projects: membersByGroupId.get(group.id) ?? [],
    })),
    ungroupedProjects,
    hasGroups: true,
  };
}
