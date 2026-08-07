import { describe, expect, it } from "vitest";
import { reorderItemsOnDragEnd } from "./reorder-items";

const items = ["alpha", "beta", "gamma"];
const byValue = (item: string): string => item;

describe("reorderItemsOnDragEnd", () => {
  it("moves the active item to the over position", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: "gamma",
        keyExtractor: byValue,
      }),
    ).toEqual({ items: ["beta", "gamma", "alpha"], from: 0, to: 2 });
  });

  // `to` counts positions in the list WITHOUT the dragged row, which is what the native
  // list reports as well. Reporting the over row's index in the original list instead
  // would be off by one for every downward move, and the two platforms would disagree.
  it("reports where the row ends up, not where the row it passed used to be", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "gamma",
        overId: "alpha",
        keyExtractor: byValue,
      }),
    ).toEqual({ items: ["gamma", "alpha", "beta"], from: 2, to: 0 });
  });

  it("is a no-op when the drop target is missing", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: null,
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the active and over items are the same", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "beta",
        overId: "beta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the active id is not in the list", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "delta",
        overId: "beta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });

  it("is a no-op when the over id is not in the list", () => {
    expect(
      reorderItemsOnDragEnd({
        items,
        activeId: "alpha",
        overId: "delta",
        keyExtractor: byValue,
      }),
    ).toBeNull();
  });
});
