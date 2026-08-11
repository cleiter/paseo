import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  toggleLabelFiltersCollapsed,
  togglePinnedCollapsed,
  toggleLabelGroupCollapsed,
  toggleProjectCollapsed,
  toggleStatusGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedStatusGroupKeys: new Set(),
    collapsedLabelGroupKeys: new Set(),
    collapsedPinned: false,
    collapsedLabelFilters: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleStatusGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedStatusGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedStatusGroupKeys: new Set(["running"]),
      collapsedLabelGroupKeys: new Set(["label:oss"]),
      collapsedPinned: true,
      collapsedLabelFilters: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedStatusGroupKeys: ["running"],
      collapsedLabelGroupKeys: ["label:oss"],
      collapsedPinned: true,
      collapsedLabelFilters: true,
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("toggles and restores the label filter track collapse flag on its own", () => {
    const toggled = toggleLabelFiltersCollapsed(emptyState());
    expect(toggled.collapsedLabelFilters).toBe(true);
    // The label *groups* in the list are a different section that happens to share the word.
    expect(Array.from(toggled.collapsedLabelGroupKeys)).toEqual([]);
    expect(toggled.collapsedPinned).toBe(false);

    const restored = mergePersistedCollapsedProjects({ collapsedLabelFilters: true }, emptyState());
    expect(restored.collapsedLabelFilters).toBe(true);
  });

  it("leaves the label filter track expanded for preferences saved before it existed", () => {
    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedLabelFilters).toBe(false);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedStatusGroupKeys)).toEqual([]);
    expect(Array.from(restored.collapsedLabelGroupKeys)).toEqual([]);
  });

  it("keeps status and label collapse state apart", () => {
    let state = toggleStatusGroupCollapsed(emptyState(), "done");
    state = toggleLabelGroupCollapsed(state, "label:done");

    expect(Array.from(state.collapsedStatusGroupKeys)).toEqual(["done"]);
    expect(Array.from(state.collapsedLabelGroupKeys)).toEqual(["label:done"]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
