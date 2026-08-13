import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  createSidebarViewStorage,
  migrateSidebarViewState,
  useSidebarViewStore,
} from "./sidebar-view-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

/**
 * What the "Save as new view" dialog does when nothing in it is touched: the live arrangement,
 * under a name. The store takes a whole view now, because the dialog can change the arrangement
 * before saving it.
 */
function saveCurrentView(input: { id: string; name: string }): void {
  const state = useSidebarViewStore.getState();
  state.createSavedSidebarView({
    id: input.id,
    name: input.name,
    groupMode: state.groupMode,
    hostFilters: [...state.hostFilters],
    projectFilters: [...state.projectFilters],
    labelFilters: { ...state.labelFilters },
    labelMatch: state.labelMatch,
  });
}

interface MemoryStorage extends StateStorage<Promise<void>> {
  reads: string[];
}

function createMemoryStorage(entries: Record<string, string | null>): MemoryStorage {
  const reads: string[] = [];
  return {
    reads,
    getItem: async (name) => {
      reads.push(name);
      return entries[name] ?? null;
    },
    setItem: async (name, value) => {
      entries[name] = value;
    },
    removeItem: async (name) => {
      entries[name] = null;
    },
  };
}

describe("sidebar view store", () => {
  beforeEach(() => {
    useSidebarViewStore.setState({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("carries the match mode into a saved view and back out when it is applied", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("backend");
    store.cycleLabelFilter("in progress");
    store.setLabelMatch("all");
    saveCurrentView({ id: "view-1", name: "Backend in progress" });

    useSidebarViewStore.getState().setLabelMatch("any");
    useSidebarViewStore.getState().applySavedSidebarView("view-1");

    expect(useSidebarViewStore.getState().savedViews[0]?.labelMatch).toBe("all");
    expect(useSidebarViewStore.getState().labelMatch).toBe("all");
  });

  // The mode says how a set of labels reads, so with the labels gone there is nothing to reset.
  it("keeps the match mode when the filters are cleared", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("backend");
    store.setLabelMatch("all");

    useSidebarViewStore.getState().clearActiveSidebarView();

    const state = useSidebarViewStore.getState();
    expect(state.labelFilters).toEqual({});
    expect(state.labelMatch).toBe("all");
  });

  it("toggles multiple hosts into and out of the filter", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);

    store.toggleHostFilter("host-a");

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-b"]);

    store.clearHostFilters();

    expect(useSidebarViewStore.getState().hostFilters).toEqual([]);
  });

  it("keeps host filters that still point at available hosts", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("host-b");

    store.reconcileHostFilters(["host-a", "host-b", "host-c"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a", "host-b"]);
  });

  it("drops a host filter after that host is removed", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("host-a");
    store.toggleHostFilter("removed-host");

    store.reconcileHostFilters(["host-a"]);

    expect(useSidebarViewStore.getState().hostFilters).toEqual(["host-a"]);
  });

  it("toggles projects into and out of the allowlist", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("alpha");
    store.toggleProjectFilter("beta");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["alpha", "beta"]);

    store.toggleProjectFilter("alpha");

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["beta"]);

    store.clearProjectFilters();

    expect(useSidebarViewStore.getState().projectFilters).toEqual([]);
  });

  it("drops a project filter after that project is gone", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("alpha");
    store.toggleProjectFilter("removed");

    store.reconcileProjectFilters(["alpha"]);

    expect(useSidebarViewStore.getState().projectFilters).toEqual(["alpha"]);
  });

  it("means all projects again once the filter has lost every project it named", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("removed");

    store.reconcileProjectFilters(["alpha"]);

    expect(useSidebarViewStore.getState().projectFilters).toEqual([]);
  });

  it("rejects the complete persisted view when a project filter is invalid", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "project",
        projectFilters: ["alpha", 7, null, "beta"],
      }),
    ).toEqual({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      // Absent from the payload and read as "any" — the mode every persisted state predates.
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("reads a persisted match mode and defaults a view without one", () => {
    const migrated = migrateSidebarViewState({
      groupMode: "project",
      labelMatch: "all",
      savedViews: [
        { id: "view-1", name: "Backend in progress", labelFilters: { backend: "include" } },
      ],
    });

    expect(migrated.labelMatch).toBe("all");
    expect(migrated.savedViews[0]?.labelMatch).toBe("any");
  });

  it("migrates legacy per-host group modes to the new global mode", () => {
    expect(
      migrateSidebarViewState({
        groupModeByServerId: {
          "host-a": "project",
          "host-b": "status",
        },
      }),
    ).toEqual({
      groupMode: "status",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("migrates a pre-v2 single host filter to the multi-host list", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        hostFilter: "host-a",
      }),
    ).toEqual({
      groupMode: "status",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("keeps a persisted label grouping, and falls back for one it does not know", () => {
    expect(migrateSidebarViewState({ groupMode: "label" }).groupMode).toBe("label");
    expect(migrateSidebarViewState({ groupMode: "folder" }).groupMode).toBe("project");
  });

  it("keeps current persisted sidebar view state during version migration", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "status",
        hostFilters: ["host-a", "host-b"],
      }),
    ).toEqual({
      groupMode: "status",
      hostFilters: ["host-a", "host-b"],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("cycles one label through neutral, include, exclude and back", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({ blocked: "include" });

    store.cycleLabelFilter("blocked");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({ blocked: "exclude" });

    store.cycleLabelFilter("blocked");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({});
  });

  it("cycles backward through the same three states", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked", "backward");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({ blocked: "exclude" });

    store.cycleLabelFilter("blocked", "backward");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({ blocked: "include" });

    store.cycleLabelFilter("blocked", "backward");
    expect(useSidebarViewStore.getState().labelFilters).toEqual({});
  });

  // The two directions are one ring, so a press the wrong way is undone by a press the other way
  // rather than by going round.
  it("undoes a forward cycle with a backward one", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    store.cycleLabelFilter("blocked", "backward");

    expect(useSidebarViewStore.getState().labelFilters).toEqual({});
  });

  it("leaves the other labels alone when one is cycled backward", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("oss");

    store.cycleLabelFilter("blocked", "backward");

    expect(useSidebarViewStore.getState().labelFilters).toEqual({
      oss: "include",
      blocked: "exclude",
    });
  });

  it("treats two spellings of a label as one filter", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("Blocked");
    store.cycleLabelFilter("blocked");

    expect(useSidebarViewStore.getState().labelFilters).toEqual({ blocked: "exclude" });
  });

  it("clears every label filter at once", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    store.cycleLabelFilter("oss");

    store.clearLabelFilters();

    expect(useSidebarViewStore.getState().labelFilters).toEqual({});
  });

  // A deleted label is on no workspace, so an include filter naming it hides the whole sidebar and
  // the chip that would cycle it back off is gone with the label.
  it("drops a deleted label out of the live filter and out of every saved view", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    store.cycleLabelFilter("oss");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().forgetLabelFilter("Blocked");

    const state = useSidebarViewStore.getState();
    expect(state.labelFilters).toEqual({ oss: "include" });
    expect(state.savedViews[0].labelFilters).toEqual({ oss: "include" });
  });

  it("leaves the filters alone when the deleted label was never filtered by", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    const before = useSidebarViewStore.getState().labelFilters;

    useSidebarViewStore.getState().forgetLabelFilter("oss");

    expect(useSidebarViewStore.getState().labelFilters).toBe(before);
  });

  // A rename keeps the label, so the filter follows it rather than being dropped — dropping it
  // would quietly widen what you are looking at.
  it("moves a renamed label to its new key in the filter and in saved views", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().renameLabelFilter("Blocked", "  Waiting  ");

    const state = useSidebarViewStore.getState();
    expect(state.labelFilters).toEqual({ waiting: "exclude" });
    expect(state.savedViews[0].labelFilters).toEqual({ waiting: "exclude" });
  });

  it("leaves the filters alone when the renamed label was never filtered by", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    const before = useSidebarViewStore.getState().labelFilters;

    useSidebarViewStore.getState().renameLabelFilter("oss", "open source");

    expect(useSidebarViewStore.getState().labelFilters).toBe(before);
  });

  it("treats a change of spelling as no change to the filter key", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    const before = useSidebarViewStore.getState().labelFilters;

    useSidebarViewStore.getState().renameLabelFilter("blocked", "Blocked");

    expect(useSidebarViewStore.getState().labelFilters).toBe(before);
  });

  it("rejects the complete persisted view when a label filter is invalid", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "project",
        labelFilters: { Blocked: "include", oss: "sideways", "  ": "exclude" },
      }),
    ).toEqual({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("captures the current filters under a name and marks that view active", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("alpha");
    store.cycleLabelFilter("blocked");

    saveCurrentView({ id: "view-1", name: "  Blocked in alpha  " });

    const state = useSidebarViewStore.getState();
    expect(state.activeSavedViewId).toBe("view-1");
    expect(state.savedViews).toEqual([
      {
        id: "view-1",
        name: "Blocked in alpha",
        groupMode: "project",
        hostFilters: [],
        projectFilters: ["alpha"],
        labelFilters: { blocked: "include" },
        labelMatch: "any",
      },
    ]);
  });

  // The dialog can change the arrangement before saving it, so what lands in the store is the
  // draft, and the sidebar follows it — otherwise a brand new view is active while the sidebar
  // shows something else.
  it("moves the sidebar to a new view whose filters differ from the live ones", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");

    store.createSavedSidebarView({
      id: "view-1",
      name: "OSS",
      groupMode: "status",
      hostFilters: [],
      projectFilters: ["alpha"],
      labelFilters: { oss: "include" },
      labelMatch: "any",
    });

    const state = useSidebarViewStore.getState();
    expect(state.activeSavedViewId).toBe("view-1");
    expect(state.groupMode).toBe("status");
    expect(state.projectFilters).toEqual(["alpha"]);
    expect(state.labelFilters).toEqual({ oss: "include" });
  });

  it("refuses to save a view with a blank name", () => {
    const store = useSidebarViewStore.getState();

    store.createSavedSidebarView({
      id: "view-1",
      name: "   ",
      groupMode: null,
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
    });

    expect(useSidebarViewStore.getState().savedViews).toEqual([]);
  });

  it("puts the filters back when a view is applied", () => {
    const store = useSidebarViewStore.getState();
    store.toggleProjectFilter("alpha");
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.clearProjectFilters();
    store.clearLabelFilters();

    useSidebarViewStore.getState().applySavedSidebarView("view-1");

    const state = useSidebarViewStore.getState();
    expect(state.projectFilters).toEqual(["alpha"]);
    expect(state.labelFilters).toEqual({ blocked: "include" });
    expect(state.activeSavedViewId).toBe("view-1");
  });

  it("leaves the view and clears the filters it narrowed with, keeping the host scope", () => {
    const store = useSidebarViewStore.getState();
    store.toggleHostFilter("srv-1");
    store.toggleProjectFilter("alpha");
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().clearActiveSidebarView();

    const state = useSidebarViewStore.getState();
    expect(state.activeSavedViewId).toBeNull();
    expect(state.projectFilters).toEqual([]);
    expect(state.labelFilters).toEqual({});
    // Which machines you are looking at is not what the view was narrowing, so it survives — the
    // same split the hidden rail's Clear makes.
    expect(state.hostFilters).toEqual(["srv-1"]);
  });

  it("keeps the saved views themselves when one is left", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().clearActiveSidebarView();

    expect(useSidebarViewStore.getState().savedViews.map((view) => view.id)).toEqual(["view-1"]);
  });

  // Editing a view is applying it and moving the filters, so the id has to survive the move.
  // Whether the arrangement still matches is derived from the view, not tracked here.
  it("stays in the view while you edit its filters", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().cycleLabelFilter("oss");

    expect(useSidebarViewStore.getState().activeSavedViewId).toBe("view-1");
  });

  it("writes the current filters back over the view being updated", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.cycleLabelFilter("oss");
    store.toggleProjectFilter("alpha");

    useSidebarViewStore.getState().updateSavedSidebarView("view-1");

    const state = useSidebarViewStore.getState();
    expect(state.activeSavedViewId).toBe("view-1");
    expect(state.savedViews).toEqual([
      {
        id: "view-1",
        name: "Blocked",
        groupMode: "project",
        hostFilters: [],
        projectFilters: ["alpha"],
        labelFilters: { blocked: "include", oss: "include" },
        labelMatch: "any",
      },
    ]);
  });

  it("leaves other views alone when one is updated", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.clearLabelFilters();
    store.cycleLabelFilter("oss");
    saveCurrentView({ id: "view-2", name: "OSS" });

    useSidebarViewStore.getState().updateSavedSidebarView("view-2");

    const [first] = useSidebarViewStore.getState().savedViews;
    expect(first?.labelFilters).toEqual({ blocked: "include" });
  });

  it("keeps the filters when the view holding them is deleted", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().deleteSavedSidebarView("view-1");

    const state = useSidebarViewStore.getState();
    expect(state.savedViews).toEqual([]);
    expect(state.activeSavedViewId).toBeNull();
    expect(state.labelFilters).toEqual({ blocked: "include" });
  });

  it("writes an edited view back and moves the sidebar with it", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });

    useSidebarViewStore.getState().editSavedSidebarView("view-1", {
      name: "Waiting on review",
      groupMode: "status",
      hostFilters: ["host-a"],
      projectFilters: [],
      labelFilters: { review: "include" },
      labelMatch: "any",
    });

    const state = useSidebarViewStore.getState();
    expect(state.savedViews[0]?.name).toBe("Waiting on review");
    expect(state.groupMode).toBe("status");
    expect(state.hostFilters).toEqual(["host-a"]);
    expect(state.labelFilters).toEqual({ review: "include" });
  });

  it("leaves the grouping alone when the view being applied holds none", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.editSavedSidebarView("view-1", {
      name: "Blocked",
      groupMode: null,
      hostFilters: [],
      projectFilters: [],
      labelFilters: { blocked: "include" },
      labelMatch: "any",
    });
    useSidebarViewStore.getState().setGroupMode("label");
    useSidebarViewStore.getState().clearLabelFilters();

    useSidebarViewStore.getState().applySavedSidebarView("view-1");

    const state = useSidebarViewStore.getState();
    expect(state.groupMode).toBe("label");
    expect(state.labelFilters).toEqual({ blocked: "include" });
  });

  // Update captures the filters you moved, not a rule the view was deliberately written without.
  it("keeps a view grouping-less when it is updated from the sidebar", () => {
    const store = useSidebarViewStore.getState();
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.editSavedSidebarView("view-1", {
      name: "Blocked",
      groupMode: null,
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
    });
    useSidebarViewStore.getState().setGroupMode("status");
    useSidebarViewStore.getState().cycleLabelFilter("oss");

    useSidebarViewStore.getState().updateSavedSidebarView("view-1");

    const [view] = useSidebarViewStore.getState().savedViews;
    expect(view?.groupMode).toBeNull();
    expect(view?.labelFilters).toEqual({ oss: "include" });
  });

  // Editing a view you are not in must not move the sidebar out from under you.
  it("leaves the filters alone when the edited view is not the active one", () => {
    const store = useSidebarViewStore.getState();
    store.cycleLabelFilter("blocked");
    saveCurrentView({ id: "view-1", name: "Blocked" });
    store.clearLabelFilters();
    store.cycleLabelFilter("oss");
    saveCurrentView({ id: "view-2", name: "OSS" });

    useSidebarViewStore.getState().editSavedSidebarView("view-1", {
      name: "Blocked",
      groupMode: "status",
      hostFilters: [],
      projectFilters: [],
      labelFilters: { blocked: "exclude" },
      labelMatch: "any",
    });

    const state = useSidebarViewStore.getState();
    expect(state.activeSavedViewId).toBe("view-2");
    expect(state.groupMode).toBe("project");
    expect(state.labelFilters).toEqual({ oss: "include" });
    expect(state.savedViews[0]?.labelFilters).toEqual({ blocked: "exclude" });
  });

  it("rejects the complete persisted view list when one entry is invalid", () => {
    expect(
      migrateSidebarViewState({
        groupMode: "project",
        activeSavedViewId: "gone",
        savedViews: [
          { id: "view-1", name: "Blocked", groupMode: "status", labelFilters: { OSS: "exclude" } },
          { id: "", name: "Nameless" },
          { id: "view-2" },
          "not a view",
        ],
      }),
    ).toEqual({
      groupMode: "project",
      hostFilters: [],
      projectFilters: [],
      labelFilters: {},
      labelMatch: "any",
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("falls back to the legacy storage key when the new key is empty", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": null,
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupModeByServerId: { "host-a": "status" } },
        version: 0,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view", "sidebar-group-mode"]);
  });

  it("uses the new storage key without reading the legacy key when current state exists", async () => {
    const storage = createMemoryStorage({
      "sidebar-view": JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
      "sidebar-group-mode": JSON.stringify({
        state: { groupModeByServerId: { "host-b": "status" } },
        version: 0,
      }),
    });

    const value = await createSidebarViewStorage(storage).getItem("sidebar-view");

    expect(value).toBe(
      JSON.stringify({
        state: { groupMode: "project", hostFilters: ["host-a"] },
        version: 2,
      }),
    );
    expect(storage.reads).toEqual(["sidebar-view"]);
  });
});
