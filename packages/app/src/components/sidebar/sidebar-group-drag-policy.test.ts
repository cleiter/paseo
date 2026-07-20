import { describe, expect, it } from "vitest";
import { decideDragEnd, decideDragOver } from "./sidebar-group-drag-policy";
import type { SidebarGroupDragData } from "./sidebar-group-drag-shared";

// One test per bug that actually shipped in this feature, each named for the SYMPTOM it
// prevents rather than the function it calls. If you break one, the failure tells you what
// the user would have seen.

function row(itemKey: string, groupId: string | null): SidebarGroupDragData {
  return { kind: "sidebar-group-item", groupId, itemKey };
}

function header(groupId: string | null): SidebarGroupDragData {
  return { kind: "sidebar-group-header", groupId };
}

function section(groupId: string): SidebarGroupDragData {
  return { kind: "sidebar-group-section", groupId };
}

describe("drag over", () => {
  it("previews a row into the group it is hovering, so a gap opens for it", () => {
    // Without this the target group's SortableContext does not contain the row, its sorting
    // strategy has nothing to shift, and a row dragged in from elsewhere displaces nothing.
    const action = decideDragOver({ active: row("w1", "a"), over: row("w2", "b") });

    expect(action).toEqual({
      kind: "preview",
      event: {
        itemKey: "w1",
        fromGroupId: "a",
        toGroupId: "b",
        overItemKey: "w2",
      },
    });
  });

  it("previews onto a group header, landing at the end", () => {
    // Hovering a group and seeing NOTHING happen is the dead feeling the preview exists to
    // remove. A header names a group but no position within it, so the row lands last.
    //
    // This used to oscillate, and the diagnosis was wrong: the problem was never that
    // headers preview, it was that a re-layout could re-fire dragOver and change the target
    // with the pointer standing still. The context forbids that now (see the delta guard),
    // so a header can preview safely.
    expect(decideDragOver({ active: row("w1", "a"), over: header("b") })).toEqual({
      kind: "preview",
      event: { itemKey: "w1", fromGroupId: "a", toGroupId: "b", overItemKey: null },
    });
  });

  it("does not preview onto the header of the group it is already in", () => {
    expect(decideDragOver({ active: row("w1", "a"), over: header("a") })).toEqual({
      kind: "none",
    });
  });

  it("previews onto the ungrouped remainder's label", () => {
    // Dragging a row back OUT of a group. The label is a header with a null group.
    expect(decideDragOver({ active: row("w1", "a"), over: header(null) })).toEqual({
      kind: "preview",
      event: { itemKey: "w1", fromGroupId: "a", toGroupId: null, overItemKey: null },
    });
  });

  it("does not preview a row onto its own group", () => {
    expect(decideDragOver({ active: row("w1", "a"), over: row("w2", "a") })).toEqual({
      kind: "none",
    });
  });

  it("does not preview when the pointer is over nothing", () => {
    // Pointer over nothing must mean NOTHING CHANGES. Guessing a target here is what made
    // the row snap back to its own group whenever the cursor sat in the gap the drag had
    // just opened.
    expect(decideDragOver({ active: row("w1", "a"), over: null })).toEqual({ kind: "none" });
  });

  it("does not preview while a group section is being dragged", () => {
    expect(decideDragOver({ active: section("a"), over: row("w2", "b") })).toEqual({
      kind: "none",
    });
  });
});

describe("drag end", () => {
  const groupIds = ["a", "b", "c"];

  it("commits a row onto the row it was dropped on", () => {
    const action = decideDragEnd({
      active: row("w1", "a"),
      over: row("w2", "b"),
      hasPreview: true,
      groupIds,
    });

    expect(action).toEqual({
      kind: "commit",
      event: { itemKey: "w1", fromGroupId: "a", toGroupId: "b", overItemKey: "w2" },
    });
  });

  it("commits to the end of a group when dropped on its header", () => {
    // The only way to fill a group that is still empty: it has no rows to drop between.
    const action = decideDragEnd({
      active: row("w1", "a"),
      over: header("b"),
      hasPreview: false,
      groupIds,
    });

    expect(action).toEqual({
      kind: "commit",
      event: { itemKey: "w1", fromGroupId: "a", toGroupId: "b", overItemKey: null },
    });
  });

  it("commits, not cancels, when released over nothing after a preview", () => {
    // The row is visibly sitting in the other group with a gap held open for it. Snapping
    // it home would throw away exactly what is on screen — and letting go while the pointer
    // rests in that gap is the most ordinary way to finish the gesture.
    const action = decideDragEnd({
      active: row("w1", "b"),
      over: null,
      hasPreview: true,
      groupIds,
    });

    expect(action).toEqual({
      kind: "commit",
      event: { itemKey: "w1", fromGroupId: "b", toGroupId: "b", overItemKey: "w1" },
    });
  });

  it("does nothing when released over nothing WITHOUT a preview", () => {
    expect(
      decideDragEnd({ active: row("w1", "a"), over: null, hasPreview: false, groupIds }),
    ).toEqual({ kind: "none" });
  });

  it("commits a self-drop once a preview has carried the row somewhere new", () => {
    // Dropping a row on itself is normally a no-op. But after a preview the row is NOT
    // where it started, and discarding here would silently undo the move the user watched
    // happen.
    const action = decideDragEnd({
      active: row("w1", "b"),
      over: row("w1", "b"),
      hasPreview: true,
      groupIds,
    });

    expect(action).toEqual({
      kind: "commit",
      event: { itemKey: "w1", fromGroupId: "b", toGroupId: "b", overItemKey: "w1" },
    });
  });

  it("does nothing on a self-drop that never moved", () => {
    expect(
      decideDragEnd({ active: row("w1", "a"), over: row("w1", "a"), hasPreview: false, groupIds }),
    ).toEqual({ kind: "none" });
  });

  it("reorders groups when a section is dropped on another section", () => {
    const action = decideDragEnd({
      active: section("c"),
      over: section("a"),
      hasPreview: false,
      groupIds,
    });

    expect(action).toEqual({ kind: "reorder-groups", orderedGroupIds: ["c", "a", "b"] });
  });

  it("reorders a group DOWNWARD, not just upward", () => {
    // The direction bug, at the group level: a move that only ever inserts before its
    // target makes a downward drag a no-op.
    const action = decideDragEnd({
      active: section("a"),
      over: section("c"),
      hasPreview: false,
      groupIds,
    });

    expect(action).toEqual({ kind: "reorder-groups", orderedGroupIds: ["b", "c", "a"] });
  });

  it("never mixes the two kinds: a section dropped on a row does nothing", () => {
    expect(
      decideDragEnd({ active: section("a"), over: row("w1", "b"), hasPreview: false, groupIds }),
    ).toEqual({ kind: "none" });
  });
});
