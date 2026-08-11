import { describe, expect, it } from "vitest";
import {
  projectDisplayNameFromProjectId,
  projectIconInitialFromDisplayName,
  projectIconPlaceholderLabelFromDisplayName,
} from "./project-display-name";

describe("projectDisplayNameFromProjectId", () => {
  it("shows owner and repo for GitHub remote ids", () => {
    expect(projectDisplayNameFromProjectId("remote:github.com/getpaseo/paseo")).toBe(
      "getpaseo/paseo",
    );
  });

  it("shows the trailing directory name for local projects", () => {
    expect(projectDisplayNameFromProjectId("/Users/me/dev/paseo")).toBe("paseo");
  });
});

describe("projectIconPlaceholderLabelFromDisplayName", () => {
  it("uses repo name instead of owner for GitHub-style display names", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("getpaseo/paseo")).toBe("paseo");
  });

  it("returns the original display name when it has no path separator", () => {
    expect(projectIconPlaceholderLabelFromDisplayName("paseo")).toBe("paseo");
  });
});

describe("projectIconInitialFromDisplayName", () => {
  // Regression: the project filter in the sidebar display menu took the first character of the
  // raw display name, so every project under one owner drew the owner's initial and three
  // different projects read as "C".
  // Found by /qa on 2026-08-10.
  // Report: .gstack/qa-reports/qa-report-workspace-labels-2026-08-10.md
  it("takes the repo initial rather than the owner initial", () => {
    expect(projectIconInitialFromDisplayName("cleiter/ai-consultation")).toBe("A");
    expect(projectIconInitialFromDisplayName("cleiter/donna")).toBe("D");
    expect(projectIconInitialFromDisplayName("cleiter/plaud-sync")).toBe("P");
  });

  it("uppercases a lone name and keeps a leading punctuation character", () => {
    expect(projectIconInitialFromDisplayName("paseo")).toBe("P");
    expect(projectIconInitialFromDisplayName(".buzz")).toBe(".");
  });

  it("falls back to a question mark rather than an empty tile", () => {
    expect(projectIconInitialFromDisplayName("")).toBe("?");
    expect(projectIconInitialFromDisplayName("   ")).toBe("?");
  });
});
