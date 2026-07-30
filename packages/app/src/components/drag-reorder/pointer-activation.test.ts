import { describe, expect, it } from "vitest";
import { DEFAULT_DRAG_ACTIVATION_CONFIG, getDragActivationConstraints } from "./pointer-activation";

const config = { movementDistance: 6, touchHoldDelayMs: 180, touchHoldTolerance: 8 };

describe("getDragActivationConstraints", () => {
  it("starts mouse drags after deliberate pointer movement", () => {
    expect(getDragActivationConstraints(true, config).mouse).toEqual({ distance: 6 });
  });

  it("requires a short hold before starting touch drags", () => {
    expect(getDragActivationConstraints(true, config).touch).toEqual({
      delay: 180,
      tolerance: 8,
    });
  });

  it("starts ordinary touch rows after deliberate movement", () => {
    expect(getDragActivationConstraints(false, config).touch).toEqual({ distance: 6 });
  });

  // The shared default is what both sidebar DndContexts read — DraggableList's own and the
  // hoisted one that spans a project's groups. When they held separate copies, one kept a
  // mouse hold delay the other had dropped, and a mouse drag inside a group did nothing.
  it("never makes a mouse drag wait on a hold", () => {
    const constraints = getDragActivationConstraints(true, DEFAULT_DRAG_ACTIVATION_CONFIG);

    expect(constraints.mouse).not.toHaveProperty("delay");
    expect(constraints.mouse).toEqual({
      distance: DEFAULT_DRAG_ACTIVATION_CONFIG.movementDistance,
    });
  });
});
