import type { SidebarGroupDragContextProps } from "./sidebar-group-drag-shared";

// Native. react-native-draggable-flatlist cannot drag an item between two separate
// lists at all, so there is nothing to coordinate here: each group's list keeps
// handling its own reorder, and moving BETWEEN groups goes through the row menu,
// which works on every platform.
export function SidebarGroupDragContext({ children }: SidebarGroupDragContextProps) {
  return children;
}

// Web hoists a shared DndContext and takes the drag over; native leaves each group's
// list dragging on its own.
export const SIDEBAR_GROUP_DRAG_ENABLED = false;
