import { useMemo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import {
  sidebarGroupHeaderId,
  sidebarGroupSectionId,
  type SidebarGroupHeaderDropData,
  type SidebarGroupSectionDragData,
} from "./sidebar-group-drag-shared";

export interface SidebarGroupSortableInfo {
  dragHandleProps?: DraggableListDragHandleProps;
  isDragging: boolean;
}

const NO_LAYOUT_ANIMATION = () => false;

// The WHOLE SECTION is the sortable node — header and rows together — and the header is
// only its handle.
//
// Making just the header sortable looked equivalent and was not: the rows live outside
// that node, so a group drag translated the bare headers around while their contents sat
// still, and everything snapped into place at the end. The headers are not DOM siblings
// either (each sits inside its own section), which is exactly what
// verticalListSortingStrategy assumes when it computes offsets. Sections ARE siblings, so
// sorting them behaves.
export function SidebarGroupSortable({
  groupId,
  children,
}: {
  groupId: string;
  children: (info: SidebarGroupSortableInfo) => ReactElement;
}) {
  const data: SidebarGroupSectionDragData = { kind: "sidebar-group-section", groupId };
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sidebarGroupSectionId(groupId),
    data,
    // The new group order arrives as DATA, so the section is already where it belongs by
    // the time dnd-kit would animate it there. Leaving the layout animation on makes the
    // two fight and the section flies in from the position it no longer occupies.
    animateLayoutChanges: NO_LAYOUT_ANIMATION,
  });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition: isDragging ? transition : undefined,
      opacity: isDragging ? 0.9 : 1,
      zIndex: isDragging ? 1000 : 1,
    }),
    [transform, transition, isDragging],
  );

  const info: SidebarGroupSortableInfo = {
    dragHandleProps: {
      attributes: attributes as unknown as Record<string, unknown>,
      listeners: listeners as unknown as Record<string, unknown>,
      setActivatorNodeRef: setActivatorNodeRef as unknown as (node: unknown) => void,
    },
    isDragging,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children(info)}
    </div>
  );
}

// The header is separately a DROP TARGET for rows, distinct from the section's own
// sortable registration. Keeping them apart is what lets a row be dropped onto a group
// (its header) without the section's much larger rectangle competing with the individual
// rows inside it for the same drop.
//
// `isOver` is handed to the header rather than styled here, so the highlight can be a
// real theme token. Dimming it — the obvious thing — reads as DISABLED, which is the
// opposite of what a drop target is trying to say.
export function SidebarGroupDropTarget({
  groupId,
  children,
}: {
  // Null addresses the ungrouped remainder.
  groupId: string | null;
  children: (isOver: boolean) => ReactElement;
}) {
  const data: SidebarGroupHeaderDropData = {
    kind: "sidebar-group-header",
    groupId,
  };
  const { setNodeRef, isOver } = useDroppable({ id: sidebarGroupHeaderId(groupId), data });

  return <div ref={setNodeRef}>{children(isOver)}</div>;
}

// What the drag overlay carries. Its ONLY job is to be opaque: the overlay floats over the
// list it came from, and without a background of its own the rows underneath show straight
// through it — two sets of titles printed on top of each other.
//
// Opaque, and nothing else. A border and a shadow were the obvious next step and they were
// wrong: the rows already have their own shape, so the chrome draws a second box around a
// thing that is already a box. The item you are dragging should look like the item, just
// carried.
export function SidebarDragOverlaySurface({ children }: { children: ReactNode }) {
  return <View style={styles.surface}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  surface: {
    backgroundColor: theme.colors.surfaceSidebar,
    borderRadius: theme.borderRadius.lg,
  },
}));
