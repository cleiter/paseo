import { describe, expect, it } from "vitest";
import type { SavedSidebarView } from "@/stores/sidebar-view-store";
import {
  cycleDraftLabel,
  draftFromSavedView,
  planSavedViewEdit,
  toggleDraftEntry,
  type SavedViewDraft,
} from "./view-editor";

function view(overrides: Partial<SavedSidebarView> = {}): SavedSidebarView {
  return {
    id: "v1",
    name: "Blocked",
    groupMode: "project",
    hostFilters: [],
    projectFilters: [],
    labelFilters: {},
    labelMatch: "any",
    ...overrides,
  };
}

function draft(overrides: Partial<SavedViewDraft> = {}): SavedViewDraft {
  return { ...draftFromSavedView(view()), ...overrides };
}

describe("draftFromSavedView", () => {
  // Closing the dialog has to throw the edit away, which it cannot do if the draft shares the
  // arrays the view is holding.
  it("copies what it captured instead of sharing it", () => {
    const original = view({ hostFilters: ["h1"], labelFilters: { b: "include" } });
    const copy = draftFromSavedView(original);

    copy.hostFilters = [...copy.hostFilters, "h2"];

    expect(original.hostFilters).toEqual(["h1"]);
    expect(copy.labelFilters).not.toBe(original.labelFilters);
  });
});

describe("toggleDraftEntry", () => {
  it("adds an entry that is not there and drops one that is", () => {
    expect(toggleDraftEntry(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleDraftEntry(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("cycleDraftLabel", () => {
  it("walks neutral, include, exclude, neutral", () => {
    const first = cycleDraftLabel({}, "Blocked");
    expect(first).toEqual({ blocked: "include" });
    const second = cycleDraftLabel(first, "Blocked");
    expect(second).toEqual({ blocked: "exclude" });
    expect(cycleDraftLabel(second, "Blocked")).toEqual({});
  });

  it("leaves the other labels where they are", () => {
    expect(cycleDraftLabel({ oss: "exclude" }, "blocked")).toEqual({
      oss: "exclude",
      blocked: "include",
    });
  });
});

describe("planSavedViewEdit", () => {
  it("hands back the draft as the store holds it, with the name trimmed", () => {
    const plan = planSavedViewEdit({
      viewId: "v1",
      draft: draft({ name: "  Review  ", labelFilters: { b: "include" } }),
      existing: [view()],
    });

    expect(plan).toEqual({
      ok: true,
      edit: {
        name: "Review",
        groupMode: "project",
        hostFilters: [],
        projectFilters: [],
        labelFilters: { b: "include" },
        labelMatch: "any",
      },
    });
  });

  it("refuses a name that is only whitespace", () => {
    expect(
      planSavedViewEdit({ viewId: "v1", draft: draft({ name: "   " }), existing: [view()] }),
    ).toEqual({ ok: false, problem: "nameEmpty" });
  });

  it("refuses a name another view already answers to, whatever its case", () => {
    expect(
      planSavedViewEdit({
        viewId: "v1",
        draft: draft({ name: "review" }),
        existing: [view(), view({ id: "v2", name: "Review" })],
      }),
    ).toEqual({ ok: false, problem: "nameTaken" });
  });

  // Saving a view without renaming it is the common case, and it is not a clash with itself.
  it("lets a view keep its own name", () => {
    expect(
      planSavedViewEdit({ viewId: "v1", draft: draft({ name: "Blocked" }), existing: [view()] }).ok,
    ).toBe(true);
  });
});
