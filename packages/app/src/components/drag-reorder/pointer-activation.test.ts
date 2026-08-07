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

  // A mouse drag inside a group once did nothing at all, because a second sidebar
  // DndContext held its own copy of these numbers and kept a mouse hold delay after this
  // one dropped it.
  it("never makes a mouse drag wait on a hold", () => {
    const constraints = getDragActivationConstraints(true, DEFAULT_DRAG_ACTIVATION_CONFIG);

    expect(constraints.mouse).not.toHaveProperty("delay");
    expect(constraints.mouse).toEqual({
      distance: DEFAULT_DRAG_ACTIVATION_CONFIG.movementDistance,
    });
  });
});
