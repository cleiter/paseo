import type {
  SidebarLayout,
  SidebarProjectGroup,
  SidebarWorkspaceGroup,
} from "@getpaseo/protocol/messages";
import { mergeWithinSlots } from "@/utils/sidebar-reorder";

// Every edit the sidebar can make to the layout document, as a pure function of the
// document. The hooks decide WHEN to apply one and where to send the result; this file
// decides what each one means.
//
// The invariant all of these preserve: a key lives in exactly one place per level —
// either in one group, or in the ungrouped list, never both and never neither.
//
// `pinnedWorkspaceKeys` is the one list that is NOT a level, and so is the one exception:
// it is an overlay order that deliberately overlaps the group lists. See
// setPinnedWorkspaceOrder.

export function createGroupId(): string {
  // Not Math.random(). These ids are compared across devices and merged, and a
  // collision would not produce a visible glitch — it would silently fuse two
  // different groups into one.
  return `grp_${crypto.randomUUID()}`;
}

// A drop names the row it landed ON, not a position. Turning that into a new list is two
// different operations depending on whether the row is already in this list:
//
//   - Already here: it is a REORDER. Move it from where it is to where the target row is
//     (arrayMove). Inserting "before the target" instead would make a downward drag a
//     no-op — drag row 1 onto row 2, insert before row 2, and you get [1, 2] back.
//   - Coming from elsewhere: it is an INSERT, before the target row.
function moveWithinList(keys: readonly string[], fromIndex: number, toIndex: number): string[] {
  const next = [...keys];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return next;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

function dropIntoList(keys: readonly string[], key: string, overKey: string | null): string[] {
  const fromIndex = keys.indexOf(key);
  const overIndex = overKey === null ? -1 : keys.indexOf(overKey);

  if (fromIndex >= 0) {
    // Reorder. A drop with no target row (onto a group header) means "no position was
    // named", so it goes to the end.
    return moveWithinList(keys, fromIndex, overIndex >= 0 ? overIndex : keys.length - 1);
  }

  if (overIndex < 0) {
    return [...keys, key];
  }
  return [...keys.slice(0, overIndex), key, ...keys.slice(overIndex)];
}

function withoutProjectKey(layout: SidebarLayout, projectKey: string): SidebarLayout {
  return {
    ...layout,
    projectGroups: layout.projectGroups.map((group) => ({
      id: group.id,
      name: group.name,
      projectKeys: group.projectKeys.filter((key) => key !== projectKey),
    })),
    ungroupedProjectKeys: layout.ungroupedProjectKeys.filter((key) => key !== projectKey),
  };
}

function withoutWorkspaceKey(
  layout: SidebarLayout,
  projectKey: string,
  workspaceKey: string,
): SidebarLayout {
  const ungrouped = layout.ungroupedWorkspaceKeysByProject[projectKey] ?? [];
  return {
    ...layout,
    workspaceGroups: layout.workspaceGroups.map((group) =>
      group.projectKey === projectKey
        ? {
            id: group.id,
            name: group.name,
            projectKey: group.projectKey,
            workspaceKeys: group.workspaceKeys.filter((key) => key !== workspaceKey),
          }
        : group,
    ),
    ungroupedWorkspaceKeysByProject: {
      ...layout.ungroupedWorkspaceKeysByProject,
      [projectKey]: ungrouped.filter((key) => key !== workspaceKey),
    },
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// Idempotent by id. Adding a group whose id is already there is nonsense — ids are unique
// by construction — and the one time it happened, the group appeared twice in the sidebar.
// Cheap to make impossible; expensive to debug.
export function createProjectGroup(
  layout: SidebarLayout,
  input: { id: string; name: string },
): SidebarLayout {
  if (layout.projectGroups.some((group) => group.id === input.id)) {
    return layout;
  }
  return {
    ...layout,
    projectGroups: [...layout.projectGroups, { id: input.id, name: input.name, projectKeys: [] }],
  };
}

export function renameProjectGroup(
  layout: SidebarLayout,
  input: { id: string; name: string },
): SidebarLayout {
  return {
    ...layout,
    projectGroups: layout.projectGroups.map((group) =>
      group.id === input.id
        ? { id: group.id, name: input.name, projectKeys: group.projectKeys }
        : group,
    ),
  };
}

// Deleting a group must never delete what was inside it. Members fall back to
// ungrouped, in the order they had within the group.
export function deleteProjectGroup(layout: SidebarLayout, groupId: string): SidebarLayout {
  const doomed = layout.projectGroups.find((group) => group.id === groupId);
  if (!doomed) {
    return layout;
  }
  return {
    ...layout,
    projectGroups: layout.projectGroups.filter((group) => group.id !== groupId),
    ungroupedProjectKeys: [...layout.ungroupedProjectKeys, ...doomed.projectKeys],
  };
}

// Moving something into a group id that does not exist yet CREATES that group. This is
// what lets the menu offer "Move to new group…" and "Move to Work" through one path:
// the caller mints an id, names it, and the group comes into being around the member.
export function ensureProjectGroup(
  layout: SidebarLayout,
  input: { id: string; name: string },
): SidebarLayout {
  if (layout.projectGroups.some((group) => group.id === input.id)) {
    return layout;
  }
  return createProjectGroup(layout, input);
}

export function ensureWorkspaceGroup(
  layout: SidebarLayout,
  input: { id: string; name: string; projectKey: string },
): SidebarLayout {
  if (layout.workspaceGroups.some((group) => group.id === input.id)) {
    return layout;
  }
  return createWorkspaceGroup(layout, input);
}

function readProjectKeys(layout: SidebarLayout, groupId: string | null): string[] {
  if (groupId === null) {
    return layout.ungroupedProjectKeys;
  }
  return layout.projectGroups.find((group) => group.id === groupId)?.projectKeys ?? [];
}

export function moveProjectToGroup(
  layout: SidebarLayout,
  input: { projectKey: string; groupId: string | null; beforeKey?: string | null },
): SidebarLayout {
  const overKey = input.beforeKey ?? null;

  // Already in the target list: this is a reorder, and the key must NOT be stripped out
  // first — dropIntoList needs its current index to know which way it moved.
  const target = readProjectKeys(layout, input.groupId);
  if (target.includes(input.projectKey)) {
    return setProjectKeysInGroup(layout, {
      groupId: input.groupId,
      projectKeys: dropIntoList(target, input.projectKey, overKey),
    });
  }

  const base = withoutProjectKey(layout, input.projectKey);
  return setProjectKeysInGroup(base, {
    groupId: input.groupId,
    projectKeys: dropIntoList(readProjectKeys(base, input.groupId), input.projectKey, overKey),
  });
}

export function reorderProjectGroups(layout: SidebarLayout, orderedIds: string[]): SidebarLayout {
  return {
    ...layout,
    projectGroups: reorderById(layout.projectGroups, orderedIds),
  };
}

// A group's drag list is capped at a visible window (the rest hide behind "show more"), so
// a drag hands back only the rows that were ON SCREEN — a subset of the group's members.
// Writing that subset verbatim through setProjectKeysInGroup would drop everything past the
// cap out of the group. Merge it into the stored order instead: the visible rows permute
// among the slots they already held and the rows below the cap stay put — the same
// slot-preserving move the Pinned overlay and the local-order fallback already use.
export function reorderProjectsInGroup(
  layout: SidebarLayout,
  input: { groupId: string | null; orderedVisibleKeys: string[] },
): SidebarLayout {
  return setProjectKeysInGroup(layout, {
    groupId: input.groupId,
    projectKeys: mergeWithinSlots({
      currentOrder: readProjectKeys(layout, input.groupId),
      reorderedVisibleKeys: input.orderedVisibleKeys,
    }),
  });
}

// Replaces one list wholesale. Every list the sidebar draws IS a document array — a
// group's members, or the ungrouped remainder — so a drag that reorders a list can just
// hand back that list. No merge, no slot arithmetic, no second ordering to keep in step.
//
// `groupId: null` addresses the ungrouped remainder, which is the same shape as a group
// for this purpose.
export function setProjectKeysInGroup(
  layout: SidebarLayout,
  input: { groupId: string | null; projectKeys: string[] },
): SidebarLayout {
  if (input.groupId === null) {
    return { ...layout, ungroupedProjectKeys: input.projectKeys };
  }
  return {
    ...layout,
    projectGroups: layout.projectGroups.map((group) =>
      group.id === input.groupId
        ? { id: group.id, name: group.name, projectKeys: input.projectKeys }
        : group,
    ),
  };
}

export function setWorkspaceKeysInGroup(
  layout: SidebarLayout,
  input: { projectKey: string; groupId: string | null; workspaceKeys: string[] },
): SidebarLayout {
  if (input.groupId === null) {
    return {
      ...layout,
      ungroupedWorkspaceKeysByProject: {
        ...layout.ungroupedWorkspaceKeysByProject,
        [input.projectKey]: input.workspaceKeys,
      },
    };
  }
  return {
    ...layout,
    workspaceGroups: layout.workspaceGroups.map((group) =>
      group.id === input.groupId
        ? {
            id: group.id,
            name: group.name,
            projectKey: group.projectKey,
            workspaceKeys: input.workspaceKeys,
          }
        : group,
    ),
  };
}

// ---------------------------------------------------------------------------
// Workspaces (always scoped to one project — a workspace group never spans projects)
// ---------------------------------------------------------------------------

// Idempotent by id, for the same reason as createProjectGroup.
export function createWorkspaceGroup(
  layout: SidebarLayout,
  input: { id: string; name: string; projectKey: string },
): SidebarLayout {
  if (layout.workspaceGroups.some((group) => group.id === input.id)) {
    return layout;
  }
  return {
    ...layout,
    workspaceGroups: [
      ...layout.workspaceGroups,
      { id: input.id, name: input.name, projectKey: input.projectKey, workspaceKeys: [] },
    ],
  };
}

export function renameWorkspaceGroup(
  layout: SidebarLayout,
  input: { id: string; name: string },
): SidebarLayout {
  return {
    ...layout,
    workspaceGroups: layout.workspaceGroups.map((group) =>
      group.id === input.id
        ? {
            id: group.id,
            name: input.name,
            projectKey: group.projectKey,
            workspaceKeys: group.workspaceKeys,
          }
        : group,
    ),
  };
}

export function deleteWorkspaceGroup(layout: SidebarLayout, groupId: string): SidebarLayout {
  const doomed = layout.workspaceGroups.find((group) => group.id === groupId);
  if (!doomed) {
    return layout;
  }
  const ungrouped = layout.ungroupedWorkspaceKeysByProject[doomed.projectKey] ?? [];
  return {
    ...layout,
    workspaceGroups: layout.workspaceGroups.filter((group) => group.id !== groupId),
    ungroupedWorkspaceKeysByProject: {
      ...layout.ungroupedWorkspaceKeysByProject,
      [doomed.projectKey]: [...ungrouped, ...doomed.workspaceKeys],
    },
  };
}

function readWorkspaceKeys(
  layout: SidebarLayout,
  projectKey: string,
  groupId: string | null,
): string[] {
  if (groupId === null) {
    return layout.ungroupedWorkspaceKeysByProject[projectKey] ?? [];
  }
  return layout.workspaceGroups.find((group) => group.id === groupId)?.workspaceKeys ?? [];
}

export function moveWorkspaceToGroup(
  layout: SidebarLayout,
  input: {
    projectKey: string;
    workspaceKey: string;
    groupId: string | null;
    beforeKey?: string | null;
  },
): SidebarLayout {
  const overKey = input.beforeKey ?? null;

  const target = readWorkspaceKeys(layout, input.projectKey, input.groupId);
  if (target.includes(input.workspaceKey)) {
    return setWorkspaceKeysInGroup(layout, {
      projectKey: input.projectKey,
      groupId: input.groupId,
      workspaceKeys: dropIntoList(target, input.workspaceKey, overKey),
    });
  }

  const base = withoutWorkspaceKey(layout, input.projectKey, input.workspaceKey);
  return setWorkspaceKeysInGroup(base, {
    projectKey: input.projectKey,
    groupId: input.groupId,
    workspaceKeys: dropIntoList(
      readWorkspaceKeys(base, input.projectKey, input.groupId),
      input.workspaceKey,
      overKey,
    ),
  });
}

// The workspace twin of reorderProjectsInGroup: a capped group (or the ungrouped
// remainder, groupId null) hands back only its visible rows, so the reorder is merged into
// the stored keys rather than written wholesale, keeping the rows below the cap in place.
export function reorderWorkspacesInGroup(
  layout: SidebarLayout,
  input: { projectKey: string; groupId: string | null; orderedVisibleKeys: string[] },
): SidebarLayout {
  return setWorkspaceKeysInGroup(layout, {
    projectKey: input.projectKey,
    groupId: input.groupId,
    workspaceKeys: mergeWithinSlots({
      currentOrder: readWorkspaceKeys(layout, input.projectKey, input.groupId),
      reorderedVisibleKeys: input.orderedVisibleKeys,
    }),
  });
}

export function reorderWorkspaceGroups(
  layout: SidebarLayout,
  input: { projectKey: string; orderedIds: string[] },
): SidebarLayout {
  const mine = layout.workspaceGroups.filter((group) => group.projectKey === input.projectKey);
  const others = layout.workspaceGroups.filter((group) => group.projectKey !== input.projectKey);
  return {
    ...layout,
    workspaceGroups: [...others, ...reorderById(mine, input.orderedIds)],
  };
}

// ---------------------------------------------------------------------------
// Pinned workspaces (an overlay order, not a level)
// ---------------------------------------------------------------------------

// The order of the Pinned section, which is its OWN order and not the group one.
//
// A pinned workspace stays in its group in the document — it is hoisted into the Pinned
// section at render, and unpinning has to put it back exactly where it was. So this list
// overlapping `workspaceGroups[].workspaceKeys` is the point, not a bug: the same key is
// legitimately in both, carrying a different position in each.
//
// This edit never changes WHICH workspaces are pinned. That is `pinnedAt` on the workspace
// record, owned by the daemon the workspace lives on.
export function setPinnedWorkspaceOrder(
  layout: SidebarLayout,
  input: { orderedVisibleKeys: string[] },
): SidebarLayout {
  return {
    ...layout,
    // Merged into the stored order rather than written verbatim: a pin whose host is
    // offline is not on screen, so writing what is on screen would silently drop it. Its
    // slot survives, and the visible rows permute among the slots they already held.
    pinnedWorkspaceKeys: mergeWithinSlots({
      currentOrder: [...(layout.pinnedWorkspaceKeys ?? [])],
      reorderedVisibleKeys: input.orderedVisibleKeys,
    }),
  };
}

// ---------------------------------------------------------------------------

// Reorders by the ids given, and keeps anything the caller did not mention. A drag only
// knows about the groups it can see; it must not silently drop the ones it cannot.
function reorderById<TGroup extends SidebarProjectGroup | SidebarWorkspaceGroup>(
  groups: readonly TGroup[],
  orderedIds: readonly string[],
): TGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const reordered: TGroup[] = [];
  for (const id of orderedIds) {
    const group = byId.get(id);
    if (group) {
      reordered.push(group);
      byId.delete(id);
    }
  }
  return [...reordered, ...byId.values()];
}
