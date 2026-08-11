import { describe, expect, test } from "vitest";

import {
  MAX_WORKSPACE_LABEL_LENGTH,
  MAX_WORKSPACE_LABELS,
  WORKSPACE_LABEL_COLORS,
  checkWorkspaceLabelRename,
  deriveWorkspaceLabelColor,
  hasWorkspaceLabel,
  isWorkspaceLabelColor,
  normalizeWorkspaceLabel,
  normalizeWorkspaceLabelCatalog,
  normalizeWorkspaceLabels,
  resolveWorkspaceLabelColor,
} from "./workspace-labels.js";

describe("normalizeWorkspaceLabel", () => {
  test("trims and collapses whitespace so two spellings are one label", () => {
    expect(normalizeWorkspaceLabel("  needs   review ")).toBe("needs review");
  });

  test("returns null for input that is empty once trimmed", () => {
    expect(normalizeWorkspaceLabel("")).toBeNull();
    expect(normalizeWorkspaceLabel("   ")).toBeNull();
    expect(normalizeWorkspaceLabel("\t\n")).toBeNull();
  });

  test("caps length", () => {
    const label = normalizeWorkspaceLabel("x".repeat(MAX_WORKSPACE_LABEL_LENGTH + 20));
    expect(label).toHaveLength(MAX_WORKSPACE_LABEL_LENGTH);
  });
});

describe("normalizeWorkspaceLabels", () => {
  test("preserves order, because order is what the chips render in", () => {
    expect(normalizeWorkspaceLabels(["blocked", "oss", "company A"])).toEqual([
      "blocked",
      "oss",
      "company A",
    ]);
  });

  test("dedupes case-insensitively and keeps the first spelling the user typed", () => {
    expect(normalizeWorkspaceLabels(["Blocked", "blocked", "BLOCKED"])).toEqual(["Blocked"]);
  });

  test("drops entries that normalize to nothing", () => {
    expect(normalizeWorkspaceLabels(["oss", "  ", "", "blocked"])).toEqual(["oss", "blocked"]);
  });

  test("caps the count", () => {
    const many = Array.from({ length: MAX_WORKSPACE_LABELS + 5 }, (_, index) => `label-${index}`);
    expect(normalizeWorkspaceLabels(many)).toHaveLength(MAX_WORKSPACE_LABELS);
  });

  test("an empty set stays empty", () => {
    expect(normalizeWorkspaceLabels([])).toEqual([]);
  });
});

describe("hasWorkspaceLabel", () => {
  test("matches regardless of the stored spelling", () => {
    expect(hasWorkspaceLabel(["Company A", "blocked"], "company a")).toBe(true);
    expect(hasWorkspaceLabel(["Company A"], "company b")).toBe(false);
  });

  test("an unlabelled workspace matches nothing", () => {
    expect(hasWorkspaceLabel([], "blocked")).toBe(false);
  });
});

describe("deriveWorkspaceLabelColor", () => {
  test("gives the same label the same colour on every host", () => {
    expect(deriveWorkspaceLabelColor("blocked")).toBe(deriveWorkspaceLabelColor("blocked"));
  });

  test("ignores case, because two spellings are one label", () => {
    expect(deriveWorkspaceLabelColor("Blocked")).toBe(deriveWorkspaceLabelColor("blocked"));
  });

  test("only ever answers with a palette colour", () => {
    for (const name of ["blocked", "oss", "review", "a", "needs review"]) {
      expect(WORKSPACE_LABEL_COLORS).toContain(deriveWorkspaceLabelColor(name));
    }
  });
});

describe("isWorkspaceLabelColor", () => {
  test("accepts a palette key and rejects a hex", () => {
    expect(isWorkspaceLabelColor("red")).toBe(true);
    expect(isWorkspaceLabelColor("#ff0000")).toBe(false);
  });
});

describe("normalizeWorkspaceLabelCatalog", () => {
  test("normalizes names and keeps the first of two spellings", () => {
    expect(
      normalizeWorkspaceLabelCatalog([
        { name: "  needs  review ", color: "sky" },
        { name: "NEEDS REVIEW", color: "red" },
      ]),
    ).toEqual([{ name: "needs review", color: "sky" }]);
  });

  test("keeps a label whose colour it does not recognize, falling back to the derived one", () => {
    expect(normalizeWorkspaceLabelCatalog([{ name: "blocked", color: "chartreuse" }])).toEqual([
      { name: "blocked", color: deriveWorkspaceLabelColor("blocked") },
    ]);
  });

  test("drops an entry whose name normalizes away", () => {
    expect(normalizeWorkspaceLabelCatalog([{ name: "   ", color: "sky" }])).toEqual([]);
  });
});

describe("resolveWorkspaceLabelColor", () => {
  test("prefers the catalog, matching case-insensitively", () => {
    expect(resolveWorkspaceLabelColor([{ name: "Blocked", color: "red" }], "blocked")).toBe("red");
  });

  test("falls back to the derived colour for a label the catalog has never heard of", () => {
    expect(resolveWorkspaceLabelColor([], "oss")).toBe(deriveWorkspaceLabelColor("oss"));
  });
});

describe("checkWorkspaceLabelRename", () => {
  test("allows a name nothing else is using", () => {
    expect(
      checkWorkspaceLabelRename({ from: "blocked", to: "waiting", existing: ["blocked"] }),
    ).toEqual({ ok: true, from: "blocked", to: "waiting" });
  });

  test("normalizes both names before deciding", () => {
    expect(
      checkWorkspaceLabelRename({ from: " blocked ", to: "  needs   review ", existing: [] }),
    ).toEqual({ ok: true, from: "blocked", to: "needs review" });
  });

  // Refused rather than merged: every workspace carrying either name would end up carrying one,
  // and that is not something a rename should do without being asked for by that name.
  test("refuses a name another label already has, whatever the spelling", () => {
    expect(
      checkWorkspaceLabelRename({ from: "blocked", to: "REVIEW", existing: ["blocked", "review"] }),
    ).toEqual({ ok: false, problem: "nameTaken" });
  });

  test("treats a change of spelling as a rename, not a collision with itself", () => {
    expect(
      checkWorkspaceLabelRename({ from: "blocked", to: "Blocked", existing: ["blocked"] }),
    ).toEqual({ ok: true, from: "blocked", to: "Blocked" });
  });

  test("refuses a name that normalizes away", () => {
    expect(checkWorkspaceLabelRename({ from: "blocked", to: "   ", existing: [] })).toEqual({
      ok: false,
      problem: "emptyName",
    });
  });
});
