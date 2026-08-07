import type { SidebarLayout } from "@getpaseo/protocol/messages";
import type { SidebarDropIntent } from "./sidebar-flat-drop-policy";
import {
  adoptVisibleProjectKeys,
  adoptVisibleWorkspaceKeys,
  moveProjectToGroup,
  moveWorkspaceToGroup,
  reorderProjectGroups,
  reorderWorkspaceGroups,
  setPinnedWorkspaceOrder,
} from "./sidebar-layout-edits";

// One intent, one document edit.
//
// The policy reads the rows the drag was FROZEN against; this applies the result to the
// document as it is NOW, which is a different thing whenever a replica arrived mid-drag.
// The edits are anchored to rows rather than to indices, so ordinary drift resolves
// itself — but one kind does not, and that is what the guard below is for.
//
// Returning null means "this drop no longer says anything the document can honour". The
// caller must then write NOTHING: a write that silently means less than the intent did is
// worse than a snap-back the user can simply repeat.

export function applyDropIntent(
  layout: SidebarLayout,
  intent: SidebarDropIntent,
): SidebarLayout | null {
  switch (intent.kind) {
    case "none":
      return null;

    case "reorder-pinned":
      return setPinnedWorkspaceOrder(layout, { orderedVisibleKeys: intent.orderedVisibleKeys });

    case "move-workspace": {
      // The group was deleted while the row was in the air. setWorkspaceKeysInGroup matches
      // groups by id, so writing into an id nobody holds matches nothing at all — and since
      // the move lifts the key out of its old group first, the key would end up stored
      // NOWHERE and the workspace would fall back to ungrouped without being asked to.
      if (intent.groupId !== null && !hasWorkspaceGroup(layout, intent)) {
        return null;
      }
      return moveWorkspaceToGroup(
        adoptVisibleWorkspaceKeys(layout, {
          projectKey: intent.projectKey,
          groupId: intent.groupId,
          visibleKeys: intent.visibleKeys,
          movingKey: intent.workspaceKey,
        }),
        intent,
      );
    }

    case "move-project": {
      if (intent.groupId !== null && !hasProjectGroup(layout, intent.groupId)) {
        return null;
      }
      return moveProjectToGroup(
        adoptVisibleProjectKeys(layout, {
          groupId: intent.groupId,
          visibleKeys: intent.visibleKeys,
          movingKey: intent.projectKey,
        }),
        intent,
      );
    }

    // No guard on either reorder: they name ids rather than move a key between lists, and
    // reorderById keeps every group the caller did not mention. A group deleted mid-drag —
    // including the dragged one — simply drops out of the ordering, leaving the survivors
    // in the relative order they already had.
    case "reorder-workspace-groups":
      return reorderWorkspaceGroups(layout, {
        projectKey: intent.projectKey,
        orderedIds: intent.orderedIds,
      });

    case "reorder-project-groups":
      return reorderProjectGroups(layout, intent.orderedIds);
  }
}

function hasWorkspaceGroup(
  layout: SidebarLayout,
  intent: { projectKey: string; groupId: string | null },
): boolean {
  return layout.workspaceGroups.some(
    (group) => group.id === intent.groupId && group.projectKey === intent.projectKey,
  );
}

function hasProjectGroup(layout: SidebarLayout, groupId: string): boolean {
  return layout.projectGroups.some((group) => group.id === groupId);
}

// What a host too old to store a layout document can still honour.
//
// Grouping is hidden entirely on such a host, so the only rows it draws are projects and
// their workspaces in one list each — and the only intents the policy can produce are
// moves within those lists, which are plain reorders. Everything else is unreachable, and
// answering null for it keeps it that way rather than half-applying it locally.
export type LegacyDropFallback =
  | { kind: "reorder-projects"; orderedVisibleKeys: string[] }
  | { kind: "reorder-workspaces"; projectKey: string; orderedVisibleKeys: string[] };

export function legacyDropFallback(intent: SidebarDropIntent): LegacyDropFallback | null {
  if (intent.kind === "move-project" && intent.groupId === null) {
    return { kind: "reorder-projects", orderedVisibleKeys: intent.visibleKeys };
  }
  if (intent.kind === "move-workspace" && intent.groupId === null) {
    return {
      kind: "reorder-workspaces",
      projectKey: intent.projectKey,
      orderedVisibleKeys: intent.visibleKeys,
    };
  }
  return null;
}
