import { createContext, useContext, type ReactNode } from "react";

// Shared by BOTH platform implementations of sidebar-group-drag-context.
//
// This file exists because a `.web.tsx` file cannot import from its own base
// specifier: on web, Metro resolves "./sidebar-group-drag-context" back to the
// `.web.tsx` file itself, so the module imports itself and blows the stack. Anything
// both platforms need has to live in a third module like this one.

// Two kinds of thing can be dragged inside a project: a workspace row, and a workspace
// group. They share one drag context — nesting a second one inside the first would trap
// each drag in its own context and make a cross-group drop impossible.
export interface SidebarGroupItemDragData {
  kind: "sidebar-group-item";
  groupId: string | null;
  itemKey: string;
}

// The group SECTION, as a sortable. Dragging this is what reorders groups.
export interface SidebarGroupSectionDragData {
  kind: "sidebar-group-section";
  groupId: string;
}

// The group HEADER, as a drop target for rows. Deliberately a separate registration from
// the section above: the section's rectangle spans all of its rows, and if it were also
// the row drop target it would compete with those very rows for the same drop.
//
// A null groupId is the UNGROUPED remainder's label, which is a drop target for the same
// reason a group header is: it is the only way to drag a row back OUT of a group once the
// remainder is empty and has no rows left to drop between.
export interface SidebarGroupHeaderDropData {
  kind: "sidebar-group-header";
  groupId: string | null;
}

export type SidebarGroupDragData =
  | SidebarGroupItemDragData
  | SidebarGroupSectionDragData
  | SidebarGroupHeaderDropData;

// Ids are namespaced so they can never collide with a itemKey — or with each other —
// in the one id space the drag context shares.
export function sidebarGroupSectionId(groupId: string): string {
  return `group:${groupId}`;
}

export function sidebarGroupHeaderId(groupId: string | null): string {
  return groupId === null ? "group-header:ungrouped" : `group-header:${groupId}`;
}

export interface SidebarGroupDropEvent {
  itemKey: string;
  fromGroupId: string | null;
  toGroupId: string | null;
  // The row it was dropped ON, which decides where in the target list it lands. Null
  // when the row was dropped on a group HEADER rather than on another row — the header
  // names the group but no position within it, so the row goes to the end.
  overItemKey: string | null;
  // Which SIDE of that row, decided by which way the dragged row is travelling past it.
  //
  // A position has to be expressed relative to a row that is not moving, or a preview
  // cannot be applied twice. "Take index 1" reads a list the last preview already
  // rewrote, so a second dragOver over the same row swaps the two rows straight back and
  // the preview flickers between them under a hand that is barely moving. "After task" is
  // the same answer however many times it is applied.
  //
  // It is also the only way to reach the slot below the last row of another group: an
  // insert that is always "before" leaves that position unaddressable, so the row had to
  // be dropped and dragged a second time to get there.
  after: boolean;
}

export interface SidebarGroupDragContextProps {
  children: ReactNode;
  // The project's workspace groups, in order. Needed so the headers can sort against
  // each other.
  groupIds: string[];
  onDrop: (event: SidebarGroupDropEvent) => void;
  onReorderGroups: (orderedGroupIds: string[]) => void;
  // Renders the row being dragged, for the drag overlay.
  //
  // Each group's list is its own SortableContext, so when a row hovers ANOTHER group the
  // sorting strategy sees overIndex === -1 inside the row's own context and returns no
  // transform at all — the row snaps back to where it started while the cursor is
  // somewhere else entirely. An overlay follows the cursor unconditionally, which is what
  // makes a cross-group drag readable.
  renderDragOverlay: (itemKey: string) => ReactNode;
  // Fired while a row hovers a group it is not in. Moves the row there WITHOUT saving, so
  // the group's list really contains it and dnd-kit's sorting strategy opens a gap — a
  // strategy can only shift rows it knows about, which is why a row dragged in from
  // another group never displaced anything.
  onDragPreview: (event: SidebarGroupDropEvent) => void;
  onDragPreviewCancel: () => void;
}

// The id of the row currently being dragged, published by whichever platform owns the
// drag so each group's list can render its own item as active. Always null on native,
// where the lists drag independently.
const ActiveIdContext = createContext<string | null>(null);

export const SidebarGroupDragActiveIdProvider = ActiveIdContext.Provider;

export function useSidebarGroupDragActiveId(): string | null {
  return useContext(ActiveIdContext);
}

// Whether a ROW is in flight, as opposed to a group section. The ungrouped remainder
// appears while one is, so there is something to drop onto; dragging a GROUP must not
// summon it, since a group cannot be dropped there.
const ActiveRowContext = createContext<boolean>(false);

export const SidebarGroupDragActiveItemProvider = ActiveRowContext.Provider;

export function useIsSidebarGroupItemDragging(): boolean {
  return useContext(ActiveRowContext);
}
