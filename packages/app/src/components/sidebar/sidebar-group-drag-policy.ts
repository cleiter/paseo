import type { SidebarGroupDragData, SidebarGroupDropEvent } from "./sidebar-group-drag-shared";

// What a drag DECIDES, separated from how dnd-kit tells us about it.
//
// Every drag bug in this feature has been a policy bug — previewing on a target that then
// moves, cancelling a preview that should have committed, treating a drop on nothing as an
// abort. None of them were visible to a test, because the policy lived inside dnd-kit
// event handlers, tangled up with sensors and rects and transforms.
//
// It lives here instead: pure, platform-free, and exhaustively testable. The web context
// translates dnd-kit's events into these inputs and does what it is told. If you are about
// to change how a drag behaves, change it HERE, and write the case down in the test.

export type SidebarGroupDragAction =
  | { kind: "none" }
  // Show the move, do not save it. Committed by a later "commit", discarded by "cancel".
  | { kind: "preview"; event: SidebarGroupDropEvent }
  | { kind: "commit"; event: SidebarGroupDropEvent }
  | { kind: "reorder-groups"; orderedGroupIds: string[] }
  | { kind: "cancel-preview" };

const NONE: SidebarGroupDragAction = { kind: "none" };

function asRow(data: SidebarGroupDragData | null) {
  return data?.kind === "sidebar-group-item" ? data : null;
}

function asGroupSection(data: SidebarGroupDragData | null) {
  return data?.kind === "sidebar-group-section" ? data : null;
}

export function decideDragOver(input: {
  active: SidebarGroupDragData | null;
  over: SidebarGroupDragData | null;
}): SidebarGroupDragAction {
  const activeRow = asRow(input.active);
  if (!activeRow || !input.over) {
    return NONE;
  }

  // A group section drag has nothing to preview into.
  if (input.over.kind === "sidebar-group-section") {
    return NONE;
  }

  // A HEADER previews too — hovering a group and seeing nothing happen is exactly the
  // dead feeling this whole preview exists to remove. It lands at the end, because a
  // header names a group but no position within it.
  //
  // This used to oscillate, and the diagnosis was wrong. The problem was never "headers
  // preview"; it was that a RE-LAYOUT could re-fire dragOver and change the target with
  // the pointer standing still. The caller now refuses to act on a dragOver whose pointer
  // delta has not changed, which forbids that outright — so a header can preview safely.
  if (input.over.kind === "sidebar-group-header") {
    if (input.over.groupId === activeRow.groupId) {
      return NONE;
    }
    return {
      kind: "preview",
      event: {
        itemKey: activeRow.itemKey,
        fromGroupId: activeRow.groupId,
        toGroupId: input.over.groupId,
        overItemKey: null,
      },
    };
  }

  const overRow = asRow(input.over);
  if (!overRow || overRow.groupId === activeRow.groupId) {
    return NONE;
  }

  return {
    kind: "preview",
    event: {
      itemKey: activeRow.itemKey,
      fromGroupId: activeRow.groupId,
      toGroupId: overRow.groupId,
      overItemKey: overRow.itemKey,
    },
  };
}

export function decideDragEnd(input: {
  active: SidebarGroupDragData | null;
  over: SidebarGroupDragData | null;
  // Whether this drag already carried the row into another group.
  hasPreview: boolean;
  groupIds: readonly string[];
}): SidebarGroupDragAction {
  const { active, over, hasPreview, groupIds } = input;

  // A group section was dragged.
  const activeGroup = asGroupSection(active);
  if (activeGroup) {
    const overGroup = asGroupSection(over);
    if (!overGroup || overGroup.groupId === activeGroup.groupId) {
      return NONE;
    }
    const from = groupIds.indexOf(activeGroup.groupId);
    const to = groupIds.indexOf(overGroup.groupId);
    if (from < 0 || to < 0) {
      return NONE;
    }
    const orderedGroupIds = [...groupIds];
    orderedGroupIds.splice(from, 1);
    orderedGroupIds.splice(to, 0, activeGroup.groupId);
    return { kind: "reorder-groups", orderedGroupIds };
  }

  const activeRow = asRow(active);
  if (!activeRow) {
    return hasPreview ? { kind: "cancel-preview" } : NONE;
  }

  // Released over nothing. Commit the preview WHERE IT SITS rather than snapping the row
  // home: that is what is on screen, and a pointer resting in the gap the drag opened is
  // the most ordinary way to finish the gesture. Naming itself as the target holds the
  // position without reordering.
  if (!over) {
    return hasPreview ? commitInPlace(activeRow) : NONE;
  }

  // Dropped on a group header: the group is named, no position within it is. The row goes
  // to the end. This is the only way to fill a group that is still empty.
  if (over.kind === "sidebar-group-header") {
    return {
      kind: "commit",
      event: {
        itemKey: activeRow.itemKey,
        fromGroupId: activeRow.groupId,
        toGroupId: over.groupId,
        overItemKey: null,
      },
    };
  }

  const overRow = asRow(over);
  if (!overRow) {
    return hasPreview ? { kind: "cancel-preview" } : NONE;
  }

  // Dropped on itself. A no-op — UNLESS a preview already carried it into another group,
  // in which case that move is exactly what has to be committed.
  if (overRow.itemKey === activeRow.itemKey) {
    return hasPreview ? commitInPlace(activeRow) : NONE;
  }

  return {
    kind: "commit",
    event: {
      itemKey: activeRow.itemKey,
      fromGroupId: activeRow.groupId,
      toGroupId: overRow.groupId,
      overItemKey: overRow.itemKey,
    },
  };
}

function commitInPlace(activeRow: {
  itemKey: string;
  groupId: string | null;
}): SidebarGroupDragAction {
  return {
    kind: "commit",
    event: {
      itemKey: activeRow.itemKey,
      fromGroupId: activeRow.groupId,
      toGroupId: activeRow.groupId,
      overItemKey: activeRow.itemKey,
    },
  };
}
