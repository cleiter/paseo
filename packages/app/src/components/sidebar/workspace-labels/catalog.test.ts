import { describe, expect, it } from "vitest";
import { deriveWorkspaceLabelColor } from "@getpaseo/protocol/workspace-labels";
import {
  collectChosenWorkspaceLabelColors,
  mergeWorkspaceLabelCatalogs,
  workspaceLabelColor,
} from "./catalog";

describe("mergeWorkspaceLabelCatalogs", () => {
  it("keys colours by name, ignoring the spelling each host stored", () => {
    const colors = mergeWorkspaceLabelCatalogs([[{ name: "Blocked", color: "red" }]]);
    expect(workspaceLabelColor(colors, "blocked")).toBe("red");
    expect(workspaceLabelColor(colors, "BLOCKED")).toBe("red");
  });

  it("gives one label one colour when two hosts disagree", () => {
    const colors = mergeWorkspaceLabelCatalogs([
      [{ name: "blocked", color: "red" }],
      [{ name: "blocked", color: "teal" }],
    ]);
    expect(workspaceLabelColor(colors, "blocked")).toBe("red");
  });

  it("takes a label from the second host when the first has never heard of it", () => {
    const colors = mergeWorkspaceLabelCatalogs([
      [{ name: "blocked", color: "red" }],
      [{ name: "oss", color: "teal" }],
    ]);
    expect(workspaceLabelColor(colors, "oss")).toBe("teal");
  });

  it("falls a colour this client cannot paint back to the derived one", () => {
    // A newer host with a wider palette. Dropping the entry is what makes the fallback happen.
    const colors = mergeWorkspaceLabelCatalogs([[{ name: "blocked", color: "chartreuse" }]]);
    expect(workspaceLabelColor(colors, "blocked")).toBe(deriveWorkspaceLabelColor("blocked"));
  });

  it("colours a label nobody has coloured by its name", () => {
    const colors = mergeWorkspaceLabelCatalogs([]);
    expect(workspaceLabelColor(colors, "blocked")).toBe(deriveWorkspaceLabelColor("blocked"));
  });

  it("derives the same colour for a label whichever way it is spelled", () => {
    const colors = mergeWorkspaceLabelCatalogs([]);
    expect(workspaceLabelColor(colors, "Blocked")).toBe(workspaceLabelColor(colors, "blocked"));
  });
});

describe("collectChosenWorkspaceLabelColors", () => {
  // The catalog response lists every label in use, so membership alone says nothing about
  // whether anyone picked the colour. Only the flag does.
  it("separates a colour someone picked from one the daemon filled in", () => {
    const chosen = collectChosenWorkspaceLabelColors([
      [
        { name: "blocked", color: "red" },
        { name: "oss", color: "teal", derived: true },
      ],
    ]);
    expect(chosen.has("blocked")).toBe(true);
    expect(chosen.has("oss")).toBe(false);
  });

  it("counts a colour chosen on one host as chosen", () => {
    const chosen = collectChosenWorkspaceLabelColors([
      [{ name: "blocked", color: "teal", derived: true }],
      [{ name: "Blocked", color: "red" }],
    ]);
    expect(chosen.has("blocked")).toBe(true);
  });
});
