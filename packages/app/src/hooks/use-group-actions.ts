import { useMemo } from "react";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import {
  createGroupId,
  createProjectGroup,
  createWorkspaceGroup,
  deleteProjectGroup,
  deleteWorkspaceGroup,
  ensureProjectGroup,
  ensureWorkspaceGroup,
  moveProjectToGroup,
  moveWorkspaceToGroup,
  renameProjectGroup,
  renameWorkspaceGroup,
  reorderProjectGroups,
  reorderWorkspaceGroups,
  setPinnedWorkspaceOrder,
  setProjectKeysInGroup,
  setWorkspaceKeysInGroup,
} from "@/sidebar/sidebar-layout-edits";

// Every group action is one edit to the layout document, applied optimistically and
// written to every connected host.
//
// There is no fan-out here and no readiness gate, because there is nothing to fan out:
// the document is replicated whole rather than assembled from per-host fragments, so a
// group is never half-written across hosts. A host that missed an edit is simply behind,
// and useSidebarLayout catches it up from the winning document when it reappears.

// What the menus speak: "put this row in that group", where a group with an id nobody
// has seen before is simply created on the spot. Null clears the group.
export interface GroupAssignment {
  groupId: string | null;
  groupName: string | null;
}

export interface WorkspaceGroupTarget {
  projectKey: string;
  workspaceKey: string;
}

export { createGroupId } from "@/sidebar/sidebar-layout-edits";

export interface GroupActions {
  // False when no connected host can store a layout. The sidebar hides grouping rather
  // than offering an action that would not persist.
  isAvailable: boolean;

  // Assignment API, used by the row menus. Takes a list because one action can move
  // several rows at once.
  assignProjectGroup: (projectKeys: string[], assignment: GroupAssignment) => void;
  assignWorkspaceGroup: (targets: WorkspaceGroupTarget[], assignment: GroupAssignment) => void;

  createProjectGroup: (name: string) => string;
  renameProjectGroup: (groupId: string, name: string) => void;
  deleteProjectGroup: (groupId: string) => void;
  moveProjectToGroup: (input: {
    projectKey: string;
    groupId: string | null;
    beforeKey?: string | null;
  }) => void;
  reorderProjectGroups: (orderedIds: string[]) => void;
  previewProjectMove: (input: {
    projectKey: string;
    groupId: string | null;
    beforeKey?: string | null;
  }) => void;
  // A drag hands back the list it reordered. Every list the sidebar draws is a document
  // array, so the whole list can just be written back.
  setProjectOrderInGroup: (input: { groupId: string | null; projectKeys: string[] }) => void;

  createWorkspaceGroup: (input: { projectKey: string; name: string }) => string;
  renameWorkspaceGroup: (groupId: string, name: string) => void;
  deleteWorkspaceGroup: (groupId: string) => void;
  moveWorkspaceToGroup: (input: {
    projectKey: string;
    workspaceKey: string;
    groupId: string | null;
    beforeKey?: string | null;
  }) => void;
  reorderWorkspaceGroups: (input: { projectKey: string; orderedIds: string[] }) => void;
  // Shows the move without saving it, so the target group's list opens a gap under the
  // cursor. Committed by the drop, discarded if the drag is abandoned.
  previewWorkspaceMove: (input: {
    projectKey: string;
    workspaceKey: string;
    groupId: string | null;
    beforeKey?: string | null;
  }) => void;
  // One cancel for both levels: only one drag can be in flight.
  cancelMovePreview: () => void;
  setWorkspaceOrderInGroup: (input: {
    projectKey: string;
    groupId: string | null;
    workspaceKeys: string[];
  }) => void;

  // The Pinned section's order — its own, separate from the order those same workspaces
  // have inside their groups. Takes what is on SCREEN; the edit merges it into the stored
  // order so pins from a host that is currently offline keep their slots.
  setPinnedWorkspaceOrder: (orderedVisibleKeys: string[]) => void;
}

export function useGroupActions(): GroupActions {
  const { isAvailable, edit, preview, cancelPreview } = useSidebarLayout();

  return useMemo<GroupActions>(
    () => ({
      isAvailable,

      assignProjectGroup: (projectKeys, assignment) => {
        if (projectKeys.length === 0) {
          return;
        }
        edit((layout) => {
          let next =
            assignment.groupId && assignment.groupName
              ? ensureProjectGroup(layout, { id: assignment.groupId, name: assignment.groupName })
              : layout;
          for (const projectKey of projectKeys) {
            next = moveProjectToGroup(next, { projectKey, groupId: assignment.groupId });
          }
          return next;
        });
      },
      assignWorkspaceGroup: (targets, assignment) => {
        if (targets.length === 0) {
          return;
        }
        edit((layout) => {
          let next = layout;
          for (const target of targets) {
            if (assignment.groupId && assignment.groupName) {
              next = ensureWorkspaceGroup(next, {
                id: assignment.groupId,
                name: assignment.groupName,
                projectKey: target.projectKey,
              });
            }
            next = moveWorkspaceToGroup(next, {
              projectKey: target.projectKey,
              workspaceKey: target.workspaceKey,
              groupId: assignment.groupId,
            });
          }
          return next;
        });
      },

      // Returns the new id so the caller can immediately move something into it, or
      // scroll to it. Creating an EMPTY group is the point: it is what an attribute on
      // the member records could never express.
      createProjectGroup: (name) => {
        const id = createGroupId();
        edit((layout) => createProjectGroup(layout, { id, name }));
        return id;
      },
      renameProjectGroup: (groupId, name) => {
        edit((layout) => renameProjectGroup(layout, { id: groupId, name }));
      },
      // Deleting a group never deletes what was in it — members fall back to ungrouped.
      deleteProjectGroup: (groupId) => {
        edit((layout) => deleteProjectGroup(layout, groupId));
      },
      moveProjectToGroup: (input) => {
        edit((layout) => moveProjectToGroup(layout, input));
      },
      reorderProjectGroups: (orderedIds) => {
        edit((layout) => reorderProjectGroups(layout, orderedIds));
      },
      setProjectOrderInGroup: (input) => {
        edit((layout) => setProjectKeysInGroup(layout, input));
      },
      previewProjectMove: (input) => {
        preview((layout) => moveProjectToGroup(layout, input));
      },

      createWorkspaceGroup: ({ projectKey, name }) => {
        const id = createGroupId();
        edit((layout) => createWorkspaceGroup(layout, { id, name, projectKey }));
        return id;
      },
      renameWorkspaceGroup: (groupId, name) => {
        edit((layout) => renameWorkspaceGroup(layout, { id: groupId, name }));
      },
      deleteWorkspaceGroup: (groupId) => {
        edit((layout) => deleteWorkspaceGroup(layout, groupId));
      },
      moveWorkspaceToGroup: (input) => {
        edit((layout) => moveWorkspaceToGroup(layout, input));
      },
      reorderWorkspaceGroups: (input) => {
        edit((layout) => reorderWorkspaceGroups(layout, input));
      },
      setWorkspaceOrderInGroup: (input) => {
        edit((layout) => setWorkspaceKeysInGroup(layout, input));
      },
      previewWorkspaceMove: (input) => {
        preview((layout) => moveWorkspaceToGroup(layout, input));
      },
      setPinnedWorkspaceOrder: (orderedVisibleKeys) => {
        edit((layout) => setPinnedWorkspaceOrder(layout, { orderedVisibleKeys }));
      },
      cancelMovePreview: cancelPreview,
    }),
    [isAvailable, edit, preview, cancelPreview],
  );
}
