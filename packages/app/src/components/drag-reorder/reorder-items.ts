import { arrayMove } from "@dnd-kit/sortable";

export interface DragEndInput<T> {
  items: T[];
  activeId: string;
  overId: string | null | undefined;
  keyExtractor: (item: T, index: number) => string;
}

export interface DragEndResult<T> {
  items: T[];
  from: number;
  to: number;
}

// The over row's index IS the insertion index: arrayMove(items, from, to) removes the
// dragged row first, so `to` counts positions in the list without it — which is what the
// native list reports too, and what lets one policy read both.
export function reorderItemsOnDragEnd<T>({
  items,
  activeId,
  overId,
  keyExtractor,
}: DragEndInput<T>): DragEndResult<T> | null {
  if (!overId || activeId === overId) return null;

  const oldIndex = items.findIndex((item, i) => keyExtractor(item, i) === activeId);
  const newIndex = items.findIndex((item, i) => keyExtractor(item, i) === overId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  return { items: arrayMove(items, oldIndex, newIndex), from: oldIndex, to: newIndex };
}
