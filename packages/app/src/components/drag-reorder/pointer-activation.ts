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

// Exported rather than left where it is used. The sidebar once ran a second DndContext
// alongside DraggableList's own, each with its own copy of these numbers, and they drifted:
// one kept a mouse hold delay the other had dropped, so a mouse drag inside a group did
// nothing at all. One definition is what stops that happening again.
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
