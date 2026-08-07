import { useMemo } from "react";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { applyDropIntent } from "@/sidebar/sidebar-flat-drop-apply";
import type { SidebarDropIntent } from "@/sidebar/sidebar-flat-drop-policy";
import {
  adoptVisibleProjectKeys,
  adoptVisibleWorkspaceKeys,
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
  reorderProjectsInGroup,
  reorderWorkspaceGroups,
  reorderWorkspacesInGroup,
  setPinnedWorkspaceOrder,
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
    // Which side of `beforeKey` the row lands on. REQUIRED on all four of these, and not
    // defaulted: a missing side reads as "above", so forgetting it does not fail — it
    // silently makes one drag direction a no-op. That shipped, on the project handlers
    // only, while the workspace ones next to them were correct.
    after: boolean;
    // The target list AS DRAWN. A drop positions one row against another, which is index
    // arithmetic over the stored list — so the document has to know both rows first. See
    // adoptVisibleProjectKeys.
    visibleKeys?: readonly string[];
  }) => void;
  reorderProjectGroups: (orderedIds: string[]) => void;
  // A drag hands back the rows it reordered — only the VISIBLE ones, since a long list is
  // capped behind "show more". The edit merges them into the group's stored order, so the
  // rows below the cap keep their place instead of being written out of the group.
  reorderProjectsInGroup: (input: { groupId: string | null; orderedVisibleKeys: string[] }) => void;

  createWorkspaceGroup: (input: { projectKey: string; name: string }) => string;
  renameWorkspaceGroup: (groupId: string, name: string) => void;
  deleteWorkspaceGroup: (groupId: string) => void;
  moveWorkspaceToGroup: (input: {
    projectKey: string;
    workspaceKey: string;
    groupId: string | null;
    beforeKey?: string | null;
    after: boolean;
    visibleKeys?: readonly string[];
  }) => void;
  reorderWorkspaceGroups: (input: { projectKey: string; orderedIds: string[] }) => void;
  reorderWorkspacesInGroup: (input: {
    projectKey: string;
    groupId: string | null;
    orderedVisibleKeys: string[];
  }) => void;

  // Every drop in the sidebar, as one action: the drag hands over what it meant and this
  // decides what the document says. Writes nothing when the drop no longer means anything
  // the document can honour — see applyDropIntent.
  applyDropIntent: (intent: SidebarDropIntent) => void;

  // The Pinned section's order — its own, separate from the order those same workspaces
  // have inside their groups. Takes what is on SCREEN; the edit merges it into the stored
  // order so pins from a host that is currently offline keep their slots.
  setPinnedWorkspaceOrder: (orderedVisibleKeys: string[]) => void;
}

// A move is positional, so it runs against a document that already knows every row the
// user can see in the target list. Callers that have that list hand it over; the ones that
// do not — the row menus, which name a group rather than a position — pass nothing and get
// the document unchanged.
function withAdoptedProjects(
  layout: SidebarLayout,
  input: { projectKey: string; groupId: string | null; visibleKeys?: readonly string[] },
): SidebarLayout {
  if (!input.visibleKeys) {
    return layout;
  }
  return adoptVisibleProjectKeys(layout, {
    groupId: input.groupId,
    visibleKeys: input.visibleKeys,
    movingKey: input.projectKey,
  });
}

function withAdoptedWorkspaces(
  layout: SidebarLayout,
  input: {
    projectKey: string;
    workspaceKey: string;
    groupId: string | null;
    visibleKeys?: readonly string[];
  },
): SidebarLayout {
  if (!input.visibleKeys) {
    return layout;
  }
  return adoptVisibleWorkspaceKeys(layout, {
    projectKey: input.projectKey,
    groupId: input.groupId,
    visibleKeys: input.visibleKeys,
    movingKey: input.workspaceKey,
  });
}

export function useGroupActions(): GroupActions {
  const { layout: currentLayout, isAvailable, edit } = useSidebarLayout();

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
        edit((layout) => moveProjectToGroup(withAdoptedProjects(layout, input), input));
      },
      reorderProjectGroups: (orderedIds) => {
        edit((layout) => reorderProjectGroups(layout, orderedIds));
      },
      reorderProjectsInGroup: (input) => {
        edit((layout) => reorderProjectsInGroup(layout, input));
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
        edit((layout) => moveWorkspaceToGroup(withAdoptedWorkspaces(layout, input), input));
      },
      reorderWorkspaceGroups: (input) => {
        edit((layout) => reorderWorkspaceGroups(layout, input));
      },
      reorderWorkspacesInGroup: (input) => {
        edit((layout) => reorderWorkspacesInGroup(layout, input));
      },
      setPinnedWorkspaceOrder: (orderedVisibleKeys) => {
        edit((layout) => setPinnedWorkspaceOrder(layout, { orderedVisibleKeys }));
      },
      applyDropIntent: (intent) => {
        // Asked twice on purpose. This one decides whether to write AT ALL, because `edit`
        // publishes a new revision to every host whether or not the recipe changed
        // anything — and a drag that ends where it started must not do that. The one
        // inside the recipe is the write, applied to whichever document the edit queue
        // hands it.
        if (!isAvailable || applyDropIntent(currentLayout, intent) === null) {
          return;
        }
        edit((current) => applyDropIntent(current, intent) ?? current);
      },
    }),
    [isAvailable, currentLayout, edit],
  );
}
