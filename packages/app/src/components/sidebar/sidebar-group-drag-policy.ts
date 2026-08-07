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
  // Which side of the hovered row the dragged row is on. Supplied by the caller, which is
  // the only place the rectangles live.
  after: boolean;
  // The group the row was in when the drag STARTED. Once a preview has carried it into
  // another group, its own data says it lives there — so "same group" stops meaning "this
  // drag has not moved it" and the preview could never be refined again. That is what made
  // the first crossing final.
  originGroupId: string | null;
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
    // Its own header, and the drag has not moved it: nothing to show. Once it HAS been
    // carried in, the header is a live target again — it is how you say "last in this
    // group" without a row below to aim at.
    if (input.over.groupId === activeRow.groupId && activeRow.groupId === input.originGroupId) {
      return NONE;
    }
    return {
      kind: "preview",
      event: {
        itemKey: activeRow.itemKey,
        fromGroupId: activeRow.groupId,
        toGroupId: input.over.groupId,
        overItemKey: null,
        after: false,
      },
    };
  }

  const overRow = asRow(input.over);
  if (!overRow || overRow.itemKey === activeRow.itemKey) {
    return NONE;
  }

  // A row still in the group it started in sorts against its neighbours inside one
  // SortableContext, and dnd-kit's own strategy draws that. Previewing it as well would
  // write the layout on every hover of an ordinary in-group drag for no visible gain.
  if (overRow.groupId === activeRow.groupId && activeRow.groupId === input.originGroupId) {
    return NONE;
  }

  return {
    kind: "preview",
    event: {
      itemKey: activeRow.itemKey,
      fromGroupId: activeRow.groupId,
      toGroupId: overRow.groupId,
      overItemKey: overRow.itemKey,
      after: input.after,
    },
  };
}

export function decideDragEnd(input: {
  active: SidebarGroupDragData | null;
  over: SidebarGroupDragData | null;
  // Whether this drag already carried the row into another group.
  hasPreview: boolean;
  groupIds: readonly string[];
  after: boolean;
}): SidebarGroupDragAction {
  const { active, over, hasPreview, groupIds, after } = input;

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
        after: false,
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
      after,
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
      after: false,
    },
  };
}
