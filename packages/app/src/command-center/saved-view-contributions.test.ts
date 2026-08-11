import { describe, expect, it } from "vitest";
import {
  buildSavedViewContributions,
  type SavedViewCommandCenterSource,
} from "./saved-view-contributions";

function source(overrides: Partial<SavedViewCommandCenterSource> = {}): {
  value: SavedViewCommandCenterSource;
  applied: string[];
  edited: string[];
  updated: string[];
  saved: number[];
} {
  const applied: string[] = [];
  const edited: string[] = [];
  const updated: string[] = [];
  const saved: number[] = [];
  return {
    applied,
    edited,
    updated,
    saved,
    value: {
      views: [],
      active: null,
      canSave: false,
      labels: {
        section: "Views",
        show: (name: string) => `Show view ${name}`,
        save: "Save view…",
        update: (name: string) => `Update “${name}”`,
        edit: (name: string) => `Edit “${name}”…`,
        keywords: ["view", "filter"],
      },
      icons: {},
      apply: (id: string) => applied.push(id),
      save: () => saved.push(1),
      update: (id: string) => updated.push(id),
      edit: (id: string) => edited.push(id),
      ...overrides,
    },
  };
}

const VIEWS = [
  { id: "v1", name: "Blocked", summary: "Only blocked · Grouped by status" },
  { id: "v2", name: "OSS", summary: "Only oss · Grouped by project" },
];

function titles(contributions: ReturnType<typeof buildSavedViewContributions>): string[] {
  return contributions.map((entry) =>
    entry.presentation.kind === "action" ? entry.presentation.title : "",
  );
}

describe("buildSavedViewContributions", () => {
  // Titled with a verb: the palette matches on the title, and a row reading "Blocked" alone
  // competes with every workspace and label of that name.
  it("offers one command per view, titled with the verb and the name", () => {
    const { value } = source({ views: VIEWS });

    expect(titles(buildSavedViewContributions(value))).toEqual([
      "Show view Blocked",
      "Show view OSS",
    ]);
  });

  // The name alone still finds it, whatever the title says around it.
  it("keeps the view name as a keyword", () => {
    const { value } = source({ views: VIEWS });

    const [first] = buildSavedViewContributions(value);
    expect(first?.keywords).toContain("Blocked");
  });

  // The palette has to say what a view does before you apply it, same as the menu row does.
  it("carries each view's summary as the subtitle", () => {
    const { value } = source({ views: VIEWS });

    const [first] = buildSavedViewContributions(value);
    expect(first?.presentation.kind === "action" ? first.presentation.subtitle : null).toBe(
      "Only blocked · Grouped by status",
    );
  });

  it("applies the view that was run", () => {
    const { value, applied } = source({ views: VIEWS });

    buildSavedViewContributions(value)[1]?.run();

    expect(applied).toEqual(["v2"]);
  });

  it("finds a view by its name as well as by the shared words", () => {
    const { value } = source({ views: VIEWS });

    expect(buildSavedViewContributions(value)[0]?.keywords).toEqual(["view", "filter", "Blocked"]);
  });

  it("leaves out saving when the sidebar is not filtered", () => {
    const { value } = source({ views: VIEWS, canSave: false });

    expect(titles(buildSavedViewContributions(value))).not.toContain("Save view…");
  });

  it("offers to edit the view you are in", () => {
    const { value, edited } = source({
      views: VIEWS,
      active: { id: "v1", name: "Blocked", edited: false },
    });

    const contributions = buildSavedViewContributions(value);
    expect(titles(contributions)).toContain("Edit “Blocked”…");
    contributions.find((entry) => entry.id === "saved-view:edit")?.run();
    expect(edited).toEqual(["v1"]);
  });

  it("offers to write the moved filters back over the view you are in", () => {
    const { value, updated } = source({
      views: VIEWS,
      canSave: true,
      active: { id: "v1", name: "Blocked", edited: true },
    });

    const contributions = buildSavedViewContributions(value);
    expect(titles(contributions)).toContain("Update “Blocked”");
    contributions.find((entry) => entry.id === "saved-view:update")?.run();
    expect(updated).toEqual(["v1"]);
  });

  // Nothing has moved, so the update would store what is already stored.
  it("leaves out updating while the sidebar still matches the view", () => {
    const { value } = source({
      views: VIEWS,
      canSave: true,
      active: { id: "v1", name: "Blocked", edited: false },
    });

    expect(buildSavedViewContributions(value).map((entry) => entry.id)).toEqual([
      "saved-view:v1",
      "saved-view:v2",
      "saved-view:save",
      "saved-view:edit",
    ]);
  });

  it("offers nothing at all before a view exists and with nothing to save", () => {
    expect(buildSavedViewContributions(source().value)).toEqual([]);
  });

  it("keeps every command out of the palette's resting list", () => {
    const { value } = source({
      views: VIEWS,
      canSave: true,
      active: { id: "v1", name: "Blocked", edited: true },
    });

    const contributions = buildSavedViewContributions(value);
    expect(contributions).toHaveLength(5);
    expect(contributions.every((entry) => entry.visibility === "query")).toBe(true);
  });
});
