import { describe, expect, it } from "vitest";
import { dragStateInitial, dragStateReducer } from "./drag-reducer";

describe("dragStateReducer", () => {
  it("starts tracking the active item with a snapshot of the data", () => {
    const next = dragStateReducer(dragStateInitial<string>(), {
      type: "start",
      id: "alpha",
      index: 0,
      data: ["alpha", "beta"],
    });

    expect(next).toEqual({ activeId: "alpha", activeIndex: 0, dragItems: ["alpha", "beta"] });
  });

  it("clears the active item and the snapshot", () => {
    const next = dragStateReducer(
      { activeId: "alpha", activeIndex: 0, dragItems: ["alpha", "beta"] },
      { type: "clear" },
    );

    expect(next).toEqual({ activeId: null, activeIndex: -1, dragItems: null });
  });

  it("replaces an in-flight drag when a new one starts", () => {
    const next = dragStateReducer(
      { activeId: "alpha", activeIndex: 0, dragItems: ["alpha", "beta"] },
      { type: "start", id: "beta", index: 1, data: ["alpha", "beta", "gamma"] },
    );

    expect(next).toEqual({
      activeId: "beta",
      activeIndex: 1,
      dragItems: ["alpha", "beta", "gamma"],
    });
  });
});
