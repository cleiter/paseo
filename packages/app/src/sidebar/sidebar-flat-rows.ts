import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import { buildSidebarProjectRowModel } from "@/utils/sidebar-project-row-model";
import type { SidebarProjectHostTarget } from "@/utils/sidebar-project-row-model";
import type {
  GroupedSidebar,
  GroupedSidebarProject,
  SidebarProjectGroup,
  SidebarWorkspaceGroup,
} from "./sidebar-groups";

// The sidebar in project mode is ONE list. Pinned rows, group headers, project rows,
// workspace rows and "show more" toggles are all rows of it, and this module is the only
// place that decides which rows exist and in what order.
//
// It is a flat list because a drag has to be able to cross a group boundary, and a drag
// crosses a boundary for free only when there is no boundary to cross — one list, one
// reorder, on every platform. Nested per-section lists are what made cross-group drag a
// web-only feature with a hoisted dnd-kit context bolted on beside it.
//
// The shape it emits:
//
//   pinned-header                         ─┐
//     pinned-workspace …                   │ Pinned
//     show-more                           ─┘
//   workspaces-header                      the "Workspaces" label the caller supplies
//   project-group-header                  ─┐
//     project-header                       │
//       workspace-group-header             │ a project group
//         workspace …                      │
//         show-more                        │
//       workspace-remainder-header         │
//         workspace …                      │
//     show-more                           ─┘
//   ungrouped-projects-header             ─┐
//     project-header                       │ the remainder: projects in no group
//       workspace …                        │
//     show-more                           ─┘
//
// Indentation is `railLevels`, one per enclosing railed section, and it is a property of
// the row rather than of a wrapper view — there are no wrappers left to hang it on.

export const SIDEBAR_SECTION_ROW_LIMIT = 20;

// The two remainders and the Pinned section have no group id of their own, so their
// collapse state rides fixed keys. Namespaced so they cannot collide with a group uuid.
export const UNGROUPED_PROJECTS_COLLAPSE_KEY = "ungrouped-projects";

export function workspaceRemainderCollapseKey(projectKey: string): string {
  return `ungrouped:${projectKey}`;
}

export type SidebarFlatRowKind =
  | "pinned-header"
  | "pinned-workspace"
  | "workspaces-header"
  | "project-group-header"
  | "ungrouped-projects-header"
  | "project-header"
  | "workspace-group-header"
  | "workspace-remainder-header"
  | "workspace"
  | "show-more"
  | "new-workspace-ghost"
  | "empty-state";

interface SidebarFlatRowBase {
  key: string;
  // How many railed sections enclose this row. The renderer draws one rail segment per
  // level; stacking the segments of consecutive rows is what makes the continuous line
  // the nested section views used to draw in one piece.
  railLevels: number;
  // The row this one hangs under — its section header, or its project. Null at the top
  // level. `buildDragRows` walks this chain to fold a lifted container's descendants.
  containerKey: string | null;
  // Extra space below the row, taken from the block it closes. A project block used to
  // carry its own bottom padding; in a flat list the block's last row carries it.
  trailingGap?: "pinned" | "project";
}

export interface SidebarPinnedHeaderRow extends SidebarFlatRowBase {
  kind: "pinned-header";
  collapsed: boolean;
}

export interface SidebarPinnedWorkspaceRow extends SidebarFlatRowBase {
  kind: "pinned-workspace";
  workspace: SidebarWorkspacePlacement;
}

export interface SidebarWorkspacesHeaderRow extends SidebarFlatRowBase {
  kind: "workspaces-header";
}

export interface SidebarProjectGroupHeaderRow extends SidebarFlatRowBase {
  kind: "project-group-header";
  group: SidebarProjectGroup;
  count: number;
  collapsed: boolean;
}

export interface SidebarUngroupedProjectsHeaderRow extends SidebarFlatRowBase {
  kind: "ungrouped-projects-header";
  count: number;
  collapsed: boolean;
}

export interface SidebarProjectHeaderRow extends SidebarFlatRowBase {
  kind: "project-header";
  project: GroupedSidebarProject;
  parentGroupId: string | null;
  collapsed: boolean;
}

export interface SidebarWorkspaceGroupHeaderRow extends SidebarFlatRowBase {
  kind: "workspace-group-header";
  projectKey: string;
  group: SidebarWorkspaceGroup;
  count: number;
  collapsed: boolean;
}

export interface SidebarWorkspaceRemainderHeaderRow extends SidebarFlatRowBase {
  kind: "workspace-remainder-header";
  projectKey: string;
  count: number;
  collapsed: boolean;
}

export interface SidebarWorkspaceRow extends SidebarFlatRowBase {
  kind: "workspace";
  projectKey: string;
  groupId: string | null;
  workspace: SidebarWorkspacePlacement;
}

export interface SidebarShowMoreRow extends SidebarFlatRowBase {
  kind: "show-more";
  sectionKey: string;
  expanded: boolean;
  testID: string;
}

export interface SidebarNewWorkspaceGhostRow extends SidebarFlatRowBase {
  kind: "new-workspace-ghost";
  project: GroupedSidebarProject;
  worktreeTarget: SidebarProjectHostTarget;
}

export interface SidebarEmptyStateRow extends SidebarFlatRowBase {
  kind: "empty-state";
}

export type SidebarFlatRow =
  | SidebarPinnedHeaderRow
  | SidebarPinnedWorkspaceRow
  | SidebarWorkspacesHeaderRow
  | SidebarProjectGroupHeaderRow
  | SidebarUngroupedProjectsHeaderRow
  | SidebarProjectHeaderRow
  | SidebarWorkspaceGroupHeaderRow
  | SidebarWorkspaceRemainderHeaderRow
  | SidebarWorkspaceRow
  | SidebarShowMoreRow
  | SidebarNewWorkspaceGhostRow
  | SidebarEmptyStateRow;

// The five row kinds a drag can pick up. Everything else is inert: it never calls drag()
// on native and is `disabled.draggable` on web.
export type SidebarDraggableRowKind =
  | "pinned-workspace"
  | "project-group-header"
  | "project-header"
  | "workspace-group-header"
  | "workspace";

export interface SidebarDragOrigin {
  kind: SidebarDraggableRowKind;
  key: string;
  // The project a workspace or workspace group belongs to. Null for the two project-level
  // kinds and for pinned rows.
  projectKey: string | null;
}

export interface SidebarFlatRowsInput {
  grouped: GroupedSidebar;
  pinnedChats: readonly SidebarWorkspacePlacement[];
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedGroupKeys: ReadonlySet<string>;
  // Sections whose "show more" has been pressed, keyed by sectionKey.
  expandedSections: ReadonlySet<string>;
  // Whether the sidebar has any project at all, before pinning splits chats out. Drives
  // the empty state, which is about having no projects rather than no rows.
  hasProjects: boolean;
  // Whether the caller wants its "Workspaces" label row. It is hidden when there is
  // nothing below it and no host filter is narrowing the list.
  showWorkspacesHeader: boolean;
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
  // Set from the moment a drag arms until it ends. It only ever ADDS the remainder header
  // the drag needs to aim at — a row you can see is a row you can drop on, and a header
  // that appears halfway through a drag is a data change the native list cancels on.
  drag: SidebarDragOrigin | null;
}

export function pinnedSectionKey(): string {
  return "pinned";
}

export function projectGroupSectionKey(groupId: string): string {
  return `pgroup:${groupId}`;
}

export function ungroupedProjectsSectionKey(): string {
  return "projects:ungrouped";
}

export function workspaceGroupSectionKey(groupId: string): string {
  return `wgroup:${groupId}`;
}

export function workspaceRemainderSectionKey(projectKey: string): string {
  return `wremainder:${projectKey}`;
}

export function projectWorkspacesSectionKey(projectKey: string): string {
  return `project:${projectKey}`;
}

export function isDraggableRow(row: SidebarFlatRow): row is SidebarFlatRow & {
  kind: SidebarDraggableRowKind;
} {
  switch (row.kind) {
    case "pinned-workspace":
    case "project-group-header":
    case "project-header":
    case "workspace-group-header":
    case "workspace":
      return true;
    default:
      return false;
  }
}

export function dragOriginForRow(row: SidebarFlatRow): SidebarDragOrigin | null {
  switch (row.kind) {
    case "pinned-workspace":
      return { kind: "pinned-workspace", key: row.key, projectKey: null };
    case "project-group-header":
      return { kind: "project-group-header", key: row.key, projectKey: null };
    case "project-header":
      return { kind: "project-header", key: row.key, projectKey: null };
    case "workspace-group-header":
      return { kind: "workspace-group-header", key: row.key, projectKey: row.projectKey };
    case "workspace":
      return { kind: "workspace", key: row.key, projectKey: row.projectKey };
    default:
      return null;
  }
}

class RowEmitter {
  readonly rows: SidebarFlatRow[] = [];
  private readonly expandedSections: ReadonlySet<string>;

  constructor(expandedSections: ReadonlySet<string>) {
    this.expandedSections = expandedSections;
  }

  push(row: SidebarFlatRow): void {
    this.rows.push(row);
  }

  // The shared 20-row cap. The reorder writers only ever see the visible keys, and fold
  // them back into the stored order, so rearranging what is on screen never ejects the
  // hidden tail.
  slice<T>(items: readonly T[], sectionKey: string): readonly T[] {
    if (this.expandedSections.has(sectionKey) || items.length <= SIDEBAR_SECTION_ROW_LIMIT) {
      return items;
    }
    return items.slice(0, SIDEBAR_SECTION_ROW_LIMIT);
  }

  pushShowMore(input: {
    items: readonly unknown[];
    sectionKey: string;
    testID: string;
    railLevels: number;
    containerKey: string | null;
  }): void {
    if (input.items.length <= SIDEBAR_SECTION_ROW_LIMIT) {
      return;
    }
    this.push({
      kind: "show-more",
      key: `more:${input.sectionKey}`,
      sectionKey: input.sectionKey,
      expanded: this.expandedSections.has(input.sectionKey),
      testID: input.testID,
      railLevels: input.railLevels,
      containerKey: input.containerKey,
    });
  }

  // The block's bottom padding belongs to whichever row ends up last in it.
  markTrailingGap(gap: "pinned" | "project"): void {
    const last = this.rows[this.rows.length - 1];
    if (!last) {
      return;
    }
    this.rows[this.rows.length - 1] = { ...last, trailingGap: gap };
  }
}

export function buildSidebarFlatRows(input: SidebarFlatRowsInput): SidebarFlatRow[] {
  const emitter = new RowEmitter(input.expandedSections);

  emitPinned(emitter, input);

  if (input.showWorkspacesHeader) {
    emitter.push({
      kind: "workspaces-header",
      key: "workspaces:header",
      railLevels: 0,
      containerKey: null,
    });
  }

  if (!input.hasProjects) {
    emitter.push({ kind: "empty-state", key: "empty", railLevels: 0, containerKey: null });
    return emitter.rows;
  }

  for (const group of input.grouped.projectGroups) {
    emitProjectGroup(emitter, input, group);
  }
  emitUngroupedProjects(emitter, input);

  return emitter.rows;
}

function emitPinned(emitter: RowEmitter, input: SidebarFlatRowsInput): void {
  if (input.pinnedChats.length === 0) {
    return;
  }
  emitter.push({
    kind: "pinned-header",
    key: "pinned:header",
    collapsed: input.pinnedCollapsed,
    railLevels: 0,
    containerKey: null,
  });
  if (!input.pinnedCollapsed) {
    const sectionKey = pinnedSectionKey();
    for (const workspace of emitter.slice(input.pinnedChats, sectionKey)) {
      emitter.push({
        kind: "pinned-workspace",
        key: `pinned:${workspace.workspaceKey}`,
        workspace,
        railLevels: 0,
        containerKey: "pinned:header",
      });
    }
    emitter.pushShowMore({
      items: input.pinnedChats,
      sectionKey,
      testID: "sidebar-pinned-show-more",
      railLevels: 0,
      containerKey: "pinned:header",
    });
  }
  emitter.markTrailingGap("pinned");
}

function emitProjectGroup(
  emitter: RowEmitter,
  input: SidebarFlatRowsInput,
  group: SidebarProjectGroup,
): void {
  const headerKey = `pgroup:${group.groupId}`;
  const collapsed = input.collapsedGroupKeys.has(group.groupId);
  emitter.push({
    kind: "project-group-header",
    key: headerKey,
    group,
    count: group.projects.length,
    collapsed,
    railLevels: 0,
    containerKey: null,
  });
  if (collapsed) {
    return;
  }
  const sectionKey = projectGroupSectionKey(group.groupId);
  for (const project of emitter.slice(group.projects, sectionKey)) {
    emitProject(emitter, input, project, {
      parentGroupId: group.groupId,
      containerKey: headerKey,
      railLevels: 1,
    });
  }
  emitter.pushShowMore({
    items: group.projects,
    sectionKey,
    testID: `sidebar-project-group-show-more-${group.groupId}`,
    railLevels: 1,
    containerKey: headerKey,
  });
}

function emitUngroupedProjects(emitter: RowEmitter, input: SidebarFlatRowsInput): void {
  const projects = input.grouped.ungroupedProjects;
  const draggingProject = input.drag?.kind === "project-header";
  if (projects.length === 0 && !draggingProject) {
    return;
  }

  // The header only earns its space once a real project group exists. Without one the
  // projects ARE the sidebar, so a label over them would be a change someone who never
  // groups anything must not see.
  const hasProjectGroups = input.grouped.projectGroups.length > 0;
  const headerKey = "projects-remainder:header";
  const collapsed = input.collapsedGroupKeys.has(UNGROUPED_PROJECTS_COLLAPSE_KEY);
  if (hasProjectGroups) {
    emitter.push({
      kind: "ungrouped-projects-header",
      key: headerKey,
      count: projects.length,
      collapsed,
      railLevels: 0,
      containerKey: null,
    });
    if (collapsed) {
      return;
    }
  }

  const railLevels = hasProjectGroups ? 1 : 0;
  const containerKey = hasProjectGroups ? headerKey : null;
  const sectionKey = ungroupedProjectsSectionKey();
  for (const project of emitter.slice(projects, sectionKey)) {
    emitProject(emitter, input, project, { parentGroupId: null, containerKey, railLevels });
  }
  emitter.pushShowMore({
    items: projects,
    sectionKey,
    testID: "sidebar-project-no-group-show-more",
    railLevels,
    containerKey,
  });
}

function emitProject(
  emitter: RowEmitter,
  input: SidebarFlatRowsInput,
  project: GroupedSidebarProject,
  placement: { parentGroupId: string | null; containerKey: string | null; railLevels: number },
): void {
  const start = emitter.rows.length;
  const headerKey = `project:${project.viewKey}`;
  const collapsed = input.collapsedProjectKeys.has(project.viewKey);
  emitter.push({
    kind: "project-header",
    key: headerKey,
    project,
    parentGroupId: placement.parentGroupId,
    collapsed,
    railLevels: placement.railLevels,
    containerKey: placement.containerKey,
  });
  if (collapsed) {
    return;
  }

  if (project.workspaceGroups.length > 0) {
    for (const group of project.workspaceGroups) {
      emitWorkspaceGroup(emitter, input, project, group, headerKey, placement.railLevels);
    }
    emitWorkspaceRemainder(emitter, input, project, headerKey, placement.railLevels);
  } else if (project.workspaces.length > 0) {
    const sectionKey = projectWorkspacesSectionKey(project.viewKey);
    for (const workspace of emitter.slice(project.workspaces, sectionKey)) {
      emitter.push({
        kind: "workspace",
        key: `ws:${workspace.workspaceKey}`,
        projectKey: project.viewKey,
        groupId: null,
        workspace,
        railLevels: placement.railLevels,
        containerKey: headerKey,
      });
    }
    emitter.pushShowMore({
      items: project.workspaces,
      sectionKey,
      testID: `sidebar-project-show-more-${project.viewKey}`,
      railLevels: placement.railLevels,
      containerKey: headerKey,
    });
  } else {
    const rowModel = buildSidebarProjectRowModel({
      project,
      collapsed,
      supportsMultiplicityByServerId: input.supportsMultiplicityByServerId,
    });
    if (rowModel.trailingAction.kind === "new_workspace") {
      emitter.push({
        kind: "new-workspace-ghost",
        key: `ghost:${project.viewKey}`,
        project,
        worktreeTarget: rowModel.trailingAction.target,
        railLevels: placement.railLevels,
        containerKey: headerKey,
      });
    }
  }

  // Only an expanded project with something under it takes the block gap; a column of
  // collapsed headers closes up to the pitch of a plain list.
  if (emitter.rows.length > start + 1) {
    emitter.markTrailingGap("project");
  }
}

function emitWorkspaceGroup(
  emitter: RowEmitter,
  input: SidebarFlatRowsInput,
  project: GroupedSidebarProject,
  group: SidebarWorkspaceGroup,
  projectHeaderKey: string,
  projectRailLevels: number,
): void {
  const headerKey = `wgroup:${group.groupId}`;
  const collapsed = input.collapsedGroupKeys.has(group.groupId);
  emitter.push({
    kind: "workspace-group-header",
    key: headerKey,
    projectKey: project.viewKey,
    group,
    count: group.workspaces.length,
    collapsed,
    railLevels: projectRailLevels,
    containerKey: projectHeaderKey,
  });
  if (collapsed) {
    return;
  }
  const sectionKey = workspaceGroupSectionKey(group.groupId);
  for (const workspace of emitter.slice(group.workspaces, sectionKey)) {
    emitter.push({
      kind: "workspace",
      key: `ws:${workspace.workspaceKey}`,
      projectKey: project.viewKey,
      groupId: group.groupId,
      workspace,
      railLevels: projectRailLevels + 1,
      containerKey: headerKey,
    });
  }
  emitter.pushShowMore({
    items: group.workspaces,
    sectionKey,
    testID: `sidebar-workspace-group-${project.viewKey}-${group.groupId}-show-more`,
    railLevels: projectRailLevels + 1,
    containerKey: headerKey,
  });
}

// The remainder is the ABSENCE of a group, and it exists as a row for one reason: once
// every workspace has been grouped there is nothing left to drop between, and without a
// header to aim at you could never drag one back out. So it appears while a workspace
// from THIS project is in flight, and stays hidden otherwise.
function emitWorkspaceRemainder(
  emitter: RowEmitter,
  input: SidebarFlatRowsInput,
  project: GroupedSidebarProject,
  projectHeaderKey: string,
  projectRailLevels: number,
): void {
  const draggingOwnWorkspace =
    input.drag?.kind === "workspace" && input.drag.projectKey === project.viewKey;
  if (project.ungroupedWorkspaces.length === 0 && !draggingOwnWorkspace) {
    return;
  }
  const headerKey = `wremainder:${project.viewKey}`;
  const collapsed = input.collapsedGroupKeys.has(workspaceRemainderCollapseKey(project.viewKey));
  emitter.push({
    kind: "workspace-remainder-header",
    key: headerKey,
    projectKey: project.viewKey,
    count: project.ungroupedWorkspaces.length,
    collapsed,
    railLevels: projectRailLevels,
    containerKey: projectHeaderKey,
  });
  if (collapsed) {
    return;
  }
  const sectionKey = workspaceRemainderSectionKey(project.viewKey);
  for (const workspace of emitter.slice(project.ungroupedWorkspaces, sectionKey)) {
    emitter.push({
      kind: "workspace",
      key: `ws:${workspace.workspaceKey}`,
      projectKey: project.viewKey,
      groupId: null,
      workspace,
      railLevels: projectRailLevels + 1,
      containerKey: headerKey,
    });
  }
  emitter.pushShowMore({
    items: project.ungroupedWorkspaces,
    sectionKey,
    testID: `sidebar-workspace-no-group-${project.viewKey}-show-more`,
    railLevels: projectRailLevels + 1,
    containerKey: headerKey,
  });
}

// Everything a drag changes about the rows happens HERE, before the drag activates, and
// nothing changes them again until it ends.
//
// Native cancels a drag whenever the key sequence of its data changes — it nulls the
// active key in the same render pass — so a row that appears or disappears mid-drag ends
// the drag rather than helping it. Both platforms therefore take the same pre-shaped
// array: web snapshots it at dragStart, native builds it on the long-press arm and lifts
// one frame later.
//
// Lifting a container folds its descendants away, because the preview IS the drop: you
// grabbed a header, so the header is what travels, and the sidebar you are aiming at
// stays visible underneath.
//
// The invariant that makes this safe: no row at or above the active row ever changes.
// Descendants sit strictly below their container and a materialized remainder header sits
// strictly below the section its dragged row came from, so the active row keeps its index
// and its measured offset.
export function buildDragRows(
  rows: readonly SidebarFlatRow[],
  activeKey: string,
): SidebarFlatRow[] {
  const activeIndex = rows.findIndex((row) => row.key === activeKey);
  if (activeIndex < 0) {
    return rows.slice();
  }
  const active = rows[activeIndex];
  if (!isContainerRow(active)) {
    return rows.slice();
  }

  const containerByKey = new Map<string, string | null>();
  for (const row of rows) {
    containerByKey.set(row.key, row.containerKey);
  }

  const kept: SidebarFlatRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (index <= activeIndex || !isDescendantOf(containerByKey, row, activeKey)) {
      kept.push(row);
    }
  }
  return kept;
}

function isContainerRow(row: SidebarFlatRow): boolean {
  return (
    row.kind === "project-group-header" ||
    row.kind === "project-header" ||
    row.kind === "workspace-group-header"
  );
}

function isDescendantOf(
  containerByKey: ReadonlyMap<string, string | null>,
  row: SidebarFlatRow,
  ancestorKey: string,
): boolean {
  let current = row.containerKey;
  while (current) {
    if (current === ancestorKey) {
      return true;
    }
    current = containerByKey.get(current) ?? null;
  }
  return false;
}
