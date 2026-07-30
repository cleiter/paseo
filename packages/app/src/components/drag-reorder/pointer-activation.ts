export type PointerActivationConstraint =
  | { distance: number }
  | { delay: number; tolerance: number };

export interface DragActivationConfig {
  movementDistance: number;
  touchHoldDelayMs: number;
  touchHoldTolerance: number;
}

export interface DragActivationConstraints {
  mouse: PointerActivationConstraint;
  touch: PointerActivationConstraint;
}

// Exported rather than left where it is used, because there are now two DndContexts in the
// sidebar — DraggableList's own, and the hoisted one that spans a project's groups — and a
// row has to start dragging the same way in both. Two copies of these numbers is how they
// last drifted apart: the hoisted context kept a mouse hold delay for months after
// DraggableList dropped it, so a mouse drag inside a group did nothing at all.
export const DEFAULT_DRAG_ACTIVATION_CONFIG: DragActivationConfig = {
  movementDistance: 6,
  touchHoldDelayMs: 180,
  touchHoldTolerance: 8,
};

export function getDragActivationConstraints(
  useDragHandle: boolean,
  config: DragActivationConfig,
): DragActivationConstraints {
  const movement = { distance: config.movementDistance };
  const touch = useDragHandle
    ? { delay: config.touchHoldDelayMs, tolerance: config.touchHoldTolerance }
    : movement;

  return { mouse: movement, touch };
}
