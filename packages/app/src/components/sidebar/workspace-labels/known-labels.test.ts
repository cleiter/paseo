import { describe, expect, it } from "vitest";
import {
  collectKnownWorkspaceLabels,
  countWorkspaceLabelUsage,
  mergeOfferedWorkspaceLabels,
  sameWorkspaceLabels,
  toggleWorkspaceLabel,
} from "./known-labels";

function collect(input: {
  catalog?: { name: string; derived?: boolean }[];
  workspaces?: { labels?: readonly string[] }[];
}) {
  return collectKnownWorkspaceLabels({
    catalog: input.catalog ?? [],
    workspaces: input.workspaces ?? [],
  });
}

describe("collectKnownWorkspaceLabels", () => {
  it("gathers labels across workspaces and sorts them case-insensitively", () => {
    expect(
      collect({
        workspaces: [{ labels: ["review", "blocked"] }, { labels: ["Alpha"] }, { labels: [] }],
      }),
    ).toEqual(["Alpha", "blocked", "review"]);
  });

  it("treats two spellings of one name as one label and keeps the first", () => {
    expect(collect({ workspaces: [{ labels: ["Blocked"] }, { labels: ["blocked"] }] })).toEqual([
      "Blocked",
    ]);
  });

  it("offers a coloured label nothing carries yet", () => {
    expect(collect({ catalog: [{ name: "blocked" }] })).toEqual(["blocked"]);
  });

  it("prefers the spelling the host stored over the one a workspace carries", () => {
    expect(
      collect({ catalog: [{ name: "Blocked" }], workspaces: [{ labels: ["blocked"] }] }),
    ).toEqual(["Blocked"]);
  });

  it("keeps a label carried by a host whose catalog this client has not seen", () => {
    expect(collect({ catalog: [{ name: "oss" }], workspaces: [{ labels: ["blocked"] }] })).toEqual([
      "blocked",
      "oss",
    ]);
  });

  it("reads a workspace from a daemon too old to know about labels as unlabelled", () => {
    expect(collect({ workspaces: [{}, { labels: ["oss"] }] })).toEqual(["oss"]);
  });

  // The daemon fills the catalog out with an entry per label in use so a client always has a
  // colour to draw. Those are the workspaces' labels coming back a second time, and a rename moves
  // the workspaces without moving the echo — count it and the old name outlives its last carrier.
  it("ignores a catalog entry the daemon derived from a label in use", () => {
    expect(
      collect({
        catalog: [{ name: "waiting", derived: true }, { name: "oss" }],
        workspaces: [{ labels: ["blocked"] }],
      }),
    ).toEqual(["blocked", "oss"]);
  });

  it("has nothing to offer when nothing is labelled", () => {
    expect(collect({})).toEqual([]);
  });
});

describe("countWorkspaceLabelUsage", () => {
  it("counts the workspaces carrying each label, keyed by lowercased name", () => {
    const counts = countWorkspaceLabelUsage([
      { labels: ["blocked", "oss"] },
      { labels: ["Blocked"] },
      { labels: [] },
      {},
    ]);
    expect(counts.get("blocked")).toBe(2);
    expect(counts.get("oss")).toBe(1);
  });

  // The sidebar draws one chip for a workspace carrying both spellings, so the count that decides
  // how big a delete is has to agree with it.
  it("counts a workspace carrying two spellings of one label once", () => {
    expect(countWorkspaceLabelUsage([{ labels: ["blocked", "Blocked"] }]).get("blocked")).toBe(1);
  });

  it("has no entry for a label nothing carries", () => {
    expect(countWorkspaceLabelUsage([{ labels: ["oss"] }]).get("blocked")).toBeUndefined();
  });
});

describe("toggleWorkspaceLabel", () => {
  it("adds a label the workspace does not carry, at the end", () => {
    expect(toggleWorkspaceLabel(["oss"], "blocked")).toEqual(["oss", "blocked"]);
  });

  it("removes a label the workspace carries", () => {
    expect(toggleWorkspaceLabel(["oss", "blocked"], "oss")).toEqual(["blocked"]);
  });

  it("removes a label whose case differs rather than adding a second spelling", () => {
    expect(toggleWorkspaceLabel(["blocked"], "Blocked")).toEqual([]);
  });

  it("leaves the original array alone", () => {
    const labels = ["oss"];
    toggleWorkspaceLabel(labels, "blocked");
    expect(labels).toEqual(["oss"]);
  });
});

describe("mergeOfferedWorkspaceLabels", () => {
  it("keeps a label that stopped being known while the menu was open", () => {
    expect(mergeOfferedWorkspaceLabels(["blocked", "oss"], ["oss"])).toEqual(["blocked", "oss"]);
  });

  it("picks up a label invented after the menu opened", () => {
    expect(mergeOfferedWorkspaceLabels(["oss"], ["blocked", "oss"])).toEqual(["blocked", "oss"]);
  });

  it("sorts a returning label back into place rather than onto the end", () => {
    expect(mergeOfferedWorkspaceLabels(["blocked"], ["archived", "oss"])).toEqual([
      "archived",
      "blocked",
      "oss",
    ]);
  });

  it("takes the spelling from what is known now", () => {
    expect(mergeOfferedWorkspaceLabels(["blocked"], ["Blocked"])).toEqual(["Blocked"]);
  });

  it("leaves both inputs alone", () => {
    const offered = ["blocked"];
    const known = ["oss"];
    mergeOfferedWorkspaceLabels(offered, known);
    expect(offered).toEqual(["blocked"]);
    expect(known).toEqual(["oss"]);
  });
});

describe("sameWorkspaceLabels", () => {
  it("is true for the same names in the same order", () => {
    expect(sameWorkspaceLabels(["blocked", "oss"], ["blocked", "oss"])).toBe(true);
  });

  it("is false when one has a label the other does not", () => {
    expect(sameWorkspaceLabels(["blocked"], ["blocked", "oss"])).toBe(false);
  });

  // Spelling is what the menu draws, so a case change has to re-render.
  it("is false when only the case differs", () => {
    expect(sameWorkspaceLabels(["blocked"], ["Blocked"])).toBe(false);
  });
});
