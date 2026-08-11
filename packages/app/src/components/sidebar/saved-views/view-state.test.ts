import { describe, expect, it } from "vitest";
import {
  describeSidebarViewSwitcher,
  resolveActiveSavedView,
  savedViewMatchesArrangement,
  sortSavedViewsByName,
  summarizeSavedView,
  type SavedViewSummaryLabels,
  type SidebarViewArrangement,
} from "./view-state";
import type { SavedSidebarView } from "@/stores/sidebar-view-store";

const LABELS: SavedViewSummaryLabels = {
  includes: (names) => `Only ${names}`,
  includesAll: (names) => `All of ${names}`,
  excludes: (names) => `Never ${names}`,
  projects: (count) => `${count} projects`,
  hosts: (count) => `${count} hosts`,
  grouping: (mode) => `Grouped by ${mode}`,
  everything: "Everything",
};

function arrangement(overrides: Partial<SidebarViewArrangement> = {}): SidebarViewArrangement {
  return {
    groupMode: "project",
    hostFilters: [],
    projectFilters: [],
    labelFilters: {},
    labelMatch: "any",
    ...overrides,
  };
}

describe("summarizeSavedView", () => {
  it("names the labels and counts the rest", () => {
    const summary = summarizeSavedView(
      arrangement({
        groupMode: "status",
        labelFilters: { blocked: "include", oss: "include", archived: "exclude" },
        projectFilters: ["a", "b"],
        hostFilters: ["h1"],
      }),
      LABELS,
    );

    expect(summary).toBe(
      "Only blocked, oss · Never archived · 2 projects · 1 hosts · Grouped by status",
    );
  });

  // A view can hold nothing but a grouping, and a row with an empty description reads as a bug.
  it("says so when a view narrows nothing", () => {
    expect(summarizeSavedView(arrangement(), LABELS)).toBe("Everything · Grouped by project");
  });

  it("says nothing about grouping when the view keeps the current one", () => {
    expect(summarizeSavedView(arrangement({ groupMode: null }), LABELS)).toBe("Everything");
  });

  it("drops the facets a view does not use", () => {
    expect(summarizeSavedView(arrangement({ labelFilters: { blocked: "include" } }), LABELS)).toBe(
      "Only blocked · Grouped by project",
    );
  });
});

describe("savedViewMatchesArrangement", () => {
  it("ignores the order two filters were toggled in", () => {
    expect(
      savedViewMatchesArrangement(
        arrangement({ hostFilters: ["a", "b"], projectFilters: ["p", "q"] }),
        arrangement({ hostFilters: ["b", "a"], projectFilters: ["q", "p"] }),
      ),
    ).toBe(true);
  });

  it("sees a label that changed side", () => {
    expect(
      savedViewMatchesArrangement(
        arrangement({ labelFilters: { blocked: "include" } }),
        arrangement({ labelFilters: { blocked: "exclude" } }),
      ),
    ).toBe(false);
  });

  it("sees a label that was added", () => {
    expect(
      savedViewMatchesArrangement(
        arrangement({ labelFilters: { blocked: "include" } }),
        arrangement({ labelFilters: { blocked: "include", oss: "include" } }),
      ),
    ).toBe(false);
  });

  it("sees a grouping that changed", () => {
    expect(savedViewMatchesArrangement(arrangement(), arrangement({ groupMode: "label" }))).toBe(
      false,
    );
  });

  // Otherwise switching grouping marks a view edited over a rule it deliberately does not hold.
  it("stays matched when the view keeps whatever grouping you are on", () => {
    expect(
      savedViewMatchesArrangement(
        arrangement({ groupMode: null }),
        arrangement({ groupMode: "label" }),
      ),
    ).toBe(true);
  });

  it("sees a filter that was cleared", () => {
    expect(savedViewMatchesArrangement(arrangement({ hostFilters: ["a"] }), arrangement())).toBe(
      false,
    );
  });
});

describe("summarizeSavedView with all", () => {
  it("says the list is an intersection", () => {
    expect(
      summarizeSavedView(
        arrangement({
          groupMode: null,
          labelFilters: { backend: "include", "in progress": "include" },
          labelMatch: "all",
        }),
        LABELS,
      ),
    ).toBe("All of backend, in progress");
  });

  // One label filters the same either way, so the summary has to read the same either way.
  it("reads as any when only one label is included", () => {
    expect(
      summarizeSavedView(
        arrangement({ groupMode: null, labelFilters: { backend: "include" }, labelMatch: "all" }),
        LABELS,
      ),
    ).toBe("Only backend");
  });
});

describe("sortSavedViewsByName", () => {
  function named(id: string, name: string): SavedSidebarView {
    return {
      id,
      name,
      groupMode: null,
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
    };
  }

  it("orders by name without letting case decide", () => {
    const sorted = sortSavedViewsByName([named("v1", "review"), named("v2", "Blocked")]);

    expect(sorted.map((view) => view.name)).toEqual(["Blocked", "review"]);
  });

  // The store's order is the order they were saved in, and it has to survive being read for display.
  it("leaves the list it was given alone", () => {
    const views = [named("v1", "Zed"), named("v2", "Alpha")];

    sortSavedViewsByName(views);

    expect(views.map((view) => view.name)).toEqual(["Zed", "Alpha"]);
  });
});

describe("resolveActiveSavedView", () => {
  const view: SavedSidebarView = {
    id: "v1",
    name: "Blocked",
    groupMode: "project",
    hostFilters: [],
    projectFilters: [],
    labelFilters: { b: "include" },
    labelMatch: "any",
  };

  it("reports no edit while the sidebar still matches", () => {
    expect(
      resolveActiveSavedView({
        savedViews: [view],
        activeSavedViewId: "v1",
        current: arrangement({ labelFilters: { b: "include" } }),
      }),
    ).toEqual({ view, edited: false });
  });

  it("reports an edit once a filter moves", () => {
    expect(
      resolveActiveSavedView({
        savedViews: [view],
        activeSavedViewId: "v1",
        current: arrangement({ labelFilters: { b: "include", c: "include" } }),
      })?.edited,
    ).toBe(true);
  });

  // Undoing the edit has to take the flag back off, which is why it is derived and not stored.
  it("reports no edit again once the sidebar comes back to what was saved", () => {
    expect(
      resolveActiveSavedView({
        savedViews: [view],
        activeSavedViewId: "v1",
        current: arrangement({ labelFilters: { b: "include" } }),
      })?.edited,
    ).toBe(false);
  });

  it("resolves nothing when the active view was deleted", () => {
    expect(
      resolveActiveSavedView({
        savedViews: [],
        activeSavedViewId: "v1",
        current: arrangement(),
      }),
    ).toBeNull();
  });
});

describe("describeSidebarViewSwitcher", () => {
  const view: SavedSidebarView = {
    id: "v1",
    name: "Review",
    groupMode: null,
    hostFilters: [],
    projectFilters: [],
    labelFilters: { b: "include" },
    labelMatch: "any",
  };

  // The header is unchanged for anyone who has neither saved a view nor filtered.
  it("stays hidden with nothing saved and nothing filtered", () => {
    expect(
      describeSidebarViewSwitcher({
        savedViews: [],
        activeSavedViewId: null,
        current: arrangement(),
        hasFilters: false,
      }).visible,
    ).toBe(false);
  });

  // The switcher owns saving, so it has to exist before the first view does.
  it("appears on the first filter so the first view can be saved from it", () => {
    const state = describeSidebarViewSwitcher({
      savedViews: [],
      activeSavedViewId: null,
      current: arrangement({ labelFilters: { b: "include" } }),
      hasFilters: true,
    });

    expect(state.visible).toBe(true);
    expect(state.canSave).toBe(true);
    expect(state.activeView).toBeNull();
  });

  it("names the applied view and lists the rest by name", () => {
    const other: SavedSidebarView = { ...view, id: "v2", name: "Archive" };
    const state = describeSidebarViewSwitcher({
      savedViews: [view, other],
      activeSavedViewId: "v1",
      current: arrangement({ labelFilters: { b: "include" } }),
      hasFilters: true,
    });

    expect(state.visible).toBe(true);
    expect(state.activeView?.name).toBe("Review");
    expect(state.views.map((entry) => entry.name)).toEqual(["Archive", "Review"]);
  });

  it("reports no view when the active one was deleted", () => {
    const state = describeSidebarViewSwitcher({
      savedViews: [view],
      activeSavedViewId: "gone",
      current: arrangement(),
      hasFilters: false,
    });

    expect(state.activeView).toBeNull();
    expect(state.canReset).toBe(false);
  });

  it("offers the reset while filtering outside a view", () => {
    expect(
      describeSidebarViewSwitcher({
        savedViews: [view],
        activeSavedViewId: null,
        current: arrangement({ projectFilters: ["p"] }),
        hasFilters: true,
      }).canReset,
    ).toBe(true);
  });

  // The Update row is the one thing that says the sidebar drifted, so the trigger keeps naming the
  // view you are in rather than telling the same story worse.
  it("keeps naming the view after the sidebar moves off it", () => {
    const state = describeSidebarViewSwitcher({
      savedViews: [view],
      activeSavedViewId: "v1",
      current: arrangement({ labelFilters: { b: "include", c: "exclude" } }),
      hasFilters: true,
    });

    expect(state.activeView?.name).toBe("Review");
    expect(state.edited).toBe(true);
    expect(state.canReset).toBe(true);
  });

  it("leaves Save and Update out with a view applied and nothing changed", () => {
    const applied: SavedSidebarView = { ...view, labelFilters: {} };
    const state = describeSidebarViewSwitcher({
      savedViews: [applied],
      activeSavedViewId: "v1",
      current: arrangement(),
      hasFilters: false,
    });

    expect(state.visible).toBe(true);
    expect(state.edited).toBe(false);
    expect(state.canSave).toBe(false);
  });
});
