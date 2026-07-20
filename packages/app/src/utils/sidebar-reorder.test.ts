import { describe, expect, it } from "vitest";

import {
  hasVisibleOrderChanged,
  mergeWithinSlots,
  mergeWithRemainder,
  moveKeyToPosition,
} from "./sidebar-reorder";

describe("hasVisibleOrderChanged", () => {
  it("returns false when visible order is unchanged", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["a", "b", "c"],
      }),
    ).toBe(false);
  });

  it("returns true when visible items are reordered", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b", "c", "d"],
        reorderedVisibleKeys: ["b", "a", "c"],
      }),
    ).toBe(true);
  });

  it("returns true when a visible key is missing from current order", () => {
    expect(
      hasVisibleOrderChanged({
        currentOrder: ["a", "b"],
        reorderedVisibleKeys: ["a", "c"],
      }),
    ).toBe(true);
  });
});

describe("mergeWithRemainder", () => {
  it("appends non-visible stored keys after reordered visible keys", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["a", "x", "b", "y"],
        reorderedVisibleKeys: ["b", "a"],
      }),
    ).toEqual(["b", "a", "x", "y"]);
  });

  it("keeps unknown current keys when no visible keys are reordered", () => {
    expect(
      mergeWithRemainder({
        currentOrder: ["stale", "hidden"],
        reorderedVisibleKeys: [],
      }),
    ).toEqual(["stale", "hidden"]);
  });
});

describe("mergeWithinSlots", () => {
  it("permutes a group's members without moving the group", () => {
    // "b" and "d" are one group, sitting in slots 1 and 3. Swapping them must not
    // pull the group above "a".
    const merged = mergeWithinSlots({
      currentOrder: ["a", "b", "c", "d", "e"],
      reorderedVisibleKeys: ["d", "b"],
    });

    expect(merged).toEqual(["a", "d", "c", "b", "e"]);
  });

  it("leaves untouched keys exactly where they were", () => {
    const merged = mergeWithinSlots({
      currentOrder: ["main", "wip", "review-1", "review-2"],
      reorderedVisibleKeys: ["review-2", "review-1"],
    });

    expect(merged).toEqual(["main", "wip", "review-2", "review-1"]);
  });

  it("appends members the stored order has never seen", () => {
    const merged = mergeWithinSlots({
      currentOrder: ["a", "b"],
      reorderedVisibleKeys: ["b", "fresh"],
    });

    expect(merged).toEqual(["a", "b", "fresh"]);
  });

  it("is a no-op when the subset is already in order", () => {
    const merged = mergeWithinSlots({
      currentOrder: ["a", "b", "c"],
      reorderedVisibleKeys: ["a", "c"],
    });

    expect(merged).toEqual(["a", "b", "c"]);
  });
});

describe("moveKeyToPosition", () => {
  it("lands the moved key next to the row it was dropped on, dragging down", () => {
    // "a" (group 1) dropped onto "d" (group 2) must end up beside "d", which is what
    // makes it render inside "d"'s group rather than snapping back.
    const next = moveKeyToPosition({
      currentOrder: ["a", "b", "c", "d", "e"],
      movedKey: "a",
      overKey: "d",
    });

    expect(next).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("inserts before the target when dragging upward", () => {
    const next = moveKeyToPosition({
      currentOrder: ["a", "b", "c", "d"],
      movedKey: "d",
      overKey: "b",
    });

    expect(next).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when dropped on itself", () => {
    const order = ["a", "b", "c"];
    expect(moveKeyToPosition({ currentOrder: order, movedKey: "b", overKey: "b" })).toBe(order);
  });

  it("keeps the move when the target isn't in the stored order yet", () => {
    const next = moveKeyToPosition({
      currentOrder: ["a", "b"],
      movedKey: "a",
      overKey: "fresh",
    });

    expect(next).toEqual(["b", "a"]);
  });

  it("never drops or duplicates a key", () => {
    const next = moveKeyToPosition({
      currentOrder: ["a", "b", "c", "d"],
      movedKey: "c",
      overKey: "a",
    });

    expect([...next].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
