import type { SidebarLayout } from "@getpaseo/protocol/messages";

// The layout document carries the sidebar's drag order as well as its groups, because
// the two cannot be split. If group order synced but the order of the rows inside them
// did not, a fresh device would show your groups in the right order with their contents
// scrambled — which reads as a bug, and is worse than syncing neither.
//
// Flattening back to a single ordered list is what lets the rest of the sidebar keep
// working exactly as it does today: it receives projects and workspaces already in the
// right order, and grouping is still just a view over that order.
//
// Groups come first, in the order the user put them in, then the ungrouped remainder.

export function deriveProjectOrder(layout: SidebarLayout): string[] {
  return [
    ...layout.projectGroups.flatMap((group) => group.projectKeys),
    ...layout.ungroupedProjectKeys,
  ];
}

export function deriveWorkspaceOrderByProject(layout: SidebarLayout): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const group of layout.workspaceGroups) {
    order[group.projectKey] = [...(order[group.projectKey] ?? []), ...group.workspaceKeys];
  }
  for (const [projectKey, keys] of Object.entries(layout.ungroupedWorkspaceKeysByProject)) {
    order[projectKey] = [...(order[projectKey] ?? []), ...keys];
  }
  return order;
}

// The handover from the old per-device order store to the synced document.
//
// It runs on the FIRST write rather than as a migration on mount, which closes the race
// that a mount-time migration would leave open: if the user's very first action were to
// create a group, a migration racing that write could lose the order they had spent
// months arranging. Folding the local order into whatever the first write happens to be
// makes that impossible — there is no window in which the document exists without it.
export function seedLayoutFromLocalOrder(
  layout: SidebarLayout,
  local: { projectOrder: string[]; workspaceOrderByProject: Record<string, string[]> },
): SidebarLayout {
  return {
    ...layout,
    ungroupedProjectKeys:
      layout.ungroupedProjectKeys.length > 0 ? layout.ungroupedProjectKeys : local.projectOrder,
    ungroupedWorkspaceKeysByProject:
      Object.keys(layout.ungroupedWorkspaceKeysByProject).length > 0
        ? layout.ungroupedWorkspaceKeysByProject
        : local.workspaceOrderByProject,
  };
}

// Revision 0 means no device has ever written a layout, so the sidebar keeps reading the
// per-device order it always has. That is also what an old daemon looks like, which is
// why old hosts need no special case: they simply never reach revision 1.
export function isLayoutOrderAuthoritative(layout: SidebarLayout): boolean {
  return layout.revision > 0;
}
