export interface DragState<T> {
  activeId: string | null;
  activeIndex: number;
  dragItems: T[] | null;
}

export type DragAction<T> =
  | { type: "start"; id: string; index: number; data: T[] }
  | { type: "clear" };

export function dragStateInitial<T>(): DragState<T> {
  return { activeId: null, activeIndex: -1, dragItems: null };
}

export function dragStateReducer<T>(state: DragState<T>, action: DragAction<T>): DragState<T> {
  switch (action.type) {
    case "start":
      return { activeId: action.id, activeIndex: action.index, dragItems: action.data };
    case "clear":
      return { activeId: null, activeIndex: -1, dragItems: null };
  }
}
