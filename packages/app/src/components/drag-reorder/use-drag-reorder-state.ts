import { useCallback, useReducer } from "react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { DraggableListDropMeta } from "../draggable-list.types";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";
import { reorderItemsOnDragEnd } from "./reorder-items";

export interface DragReorderHandlers {
  onDragStart: (event: DragStartEvent) => void;
  onDragCancel: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

export interface DragReorderState<T> {
  activeId: string | null;
  activeIndex: number;
  items: T[];
  handlers: DragReorderHandlers;
}

export function useDragReorderState<T>({
  data,
  keyExtractor,
  onDragEnd,
  onDragBegin,
  onDragTerminate,
  snapshotForDrag,
  disabled = false,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  onDragEnd?: (items: T[], meta: DraggableListDropMeta) => void;
  onDragBegin?: (index: number) => void;
  onDragTerminate?: () => void;
  // The rows the drag runs against, given the row picked up. Snapshotted here rather than
  // read live: dragStart is the last moment the list can be reshaped without the reshape
  // racing the drag it is meant to prepare for.
  snapshotForDrag?: (data: T[], from: number) => T[];
  disabled?: boolean;
}): DragReorderState<T> {
  const [state, dispatch] = useReducer(dragStateReducer<T>, undefined, dragStateInitial<T>);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (disabled) return;
      const id = String(event.active.id);
      const from = data.findIndex((item, index) => keyExtractor(item, index) === id);
      if (from < 0) return;
      dispatch({ type: "start", id, index: from, data: snapshotForDrag?.(data, from) ?? data });
      onDragBegin?.(from);
    },
    [data, disabled, keyExtractor, onDragBegin, snapshotForDrag],
  );

  const clearDragState = useCallback(() => {
    dispatch({ type: "clear" });
    onDragTerminate?.();
  }, [onDragTerminate]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const items = state.dragItems ?? data;
      dispatch({ type: "clear" });
      if (disabled) return;

      const reordered = reorderItemsOnDragEnd({
        items,
        activeId: String(active.id),
        overId: over ? String(over.id) : null,
        keyExtractor,
      });
      if (reordered) {
        onDragEnd?.(reordered.items, { from: reordered.from, to: reordered.to });
      } else {
        onDragTerminate?.();
      }
    },
    [data, disabled, keyExtractor, onDragEnd, onDragTerminate, state.dragItems],
  );

  return {
    activeId: state.activeId,
    activeIndex: state.activeIndex,
    items: state.dragItems ?? data,
    handlers: {
      onDragStart: handleDragStart,
      onDragCancel: clearDragState,
      onDragEnd: handleDragEnd,
    },
  };
}
