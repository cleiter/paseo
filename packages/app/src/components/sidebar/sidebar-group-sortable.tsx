import type { ReactElement, ReactNode } from "react";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";

export interface SidebarGroupSortableInfo {
  dragHandleProps?: DraggableListDragHandleProps;
  isDragging: boolean;
}

// Native. react-native-draggable-flatlist cannot drag an item between two separate lists
// at all, so there is no shared drag context here to register a group section with.
// Reordering groups and moving a row between them go through the row and header menus,
// which work on every platform.
export function SidebarGroupSortable({
  children,
}: {
  groupId: string;
  children: (info: SidebarGroupSortableInfo) => ReactElement;
}) {
  return children({ isDragging: false });
}

export function SidebarGroupDropTarget({
  children,
}: {
  groupId: string | null;
  children: (isOver: boolean) => ReactElement;
}) {
  return children(false);
}

// Native never renders a drag overlay: there is no shared drag context to carry one.
export function SidebarDragOverlaySurface({ children }: { children: ReactNode }) {
  return children;
}
