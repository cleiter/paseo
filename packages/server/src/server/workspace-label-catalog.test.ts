import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FileBackedWorkspaceLabelCatalog,
  withDerivedLabelColors,
} from "./workspace-label-catalog.js";

const logger = pino({ level: "silent" });

function nameOf(entry: { name: string }): string {
  return entry.name;
}

describe("FileBackedWorkspaceLabelCatalog", () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(tmpdir(), "paseo-label-catalog-"));
    filePath = path.join(directory, "workspace-labels.json");
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("starts empty when nothing has been written", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.initialize();
    expect(await catalog.list()).toEqual([]);
  });

  it("persists a colour and reads it back through a fresh instance", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "blocked", color: "red" });

    const reopened = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    expect(await reopened.list()).toEqual([{ name: "blocked", color: "red" }]);
  });

  it("recolours by name without restyling the stored spelling", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "Blocked", color: "red" });
    await catalog.set({ name: "blocked", color: "teal" });

    expect(await catalog.list()).toEqual([{ name: "Blocked", color: "teal" }]);
  });

  it("normalizes the name it stores", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "  needs   review  ", color: "sky" });

    expect(await catalog.list()).toEqual([{ name: "needs review", color: "sky" }]);
  });

  it("rejects a colour outside the palette rather than storing it", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await expect(catalog.set({ name: "blocked", color: "#ff0000" })).rejects.toThrow(
      "Unknown label color",
    );
    expect(await catalog.list()).toEqual([]);
  });

  it("rejects a name that normalizes away", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await expect(catalog.set({ name: "   ", color: "sky" })).rejects.toThrow("Label name is empty");
  });

  it("removes by name, case-insensitively", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "Blocked", color: "red" });
    await catalog.set({ name: "oss", color: "sky" });

    expect(await catalog.remove("blocked")).toEqual([{ name: "oss", color: "sky" }]);
  });

  it("keeps a label a newer client coloured, falling its colour back to the derived one", async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify([{ name: "blocked", color: "chartreuse" }]),
      "utf8",
    );

    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    const [entry] = await catalog.list();
    expect(entry.name).toBe("blocked");
    // Which colour it lands on is derived; that it kept the label is the point.
    expect(entry.color).not.toBe("chartreuse");
  });

  it("moves a colour onto the new name", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "blocked", color: "red" });

    await catalog.rename({ from: "Blocked", to: "  waiting  " });

    expect(await catalog.list()).toEqual([{ name: "waiting", color: "red" }]);
  });

  // The label lives on the workspaces, not here. The caller renames those either way, and
  // inventing an entry would pin a colour nobody picked.
  it("does nothing when the old name has no colour of its own", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "oss", color: "sky" });

    await catalog.rename({ from: "blocked", to: "waiting" });

    expect(await catalog.list()).toEqual([{ name: "oss", color: "sky" }]);
  });

  // The reader keys by name, so two entries for one label would make the colour a coin toss.
  it("leaves one entry when the new name already had a colour", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    await catalog.set({ name: "blocked", color: "red" });
    await catalog.set({ name: "waiting", color: "sky" });

    await catalog.rename({ from: "blocked", to: "waiting" });

    expect(await catalog.list()).toEqual([{ name: "waiting", color: "red" }]);
  });

  it("notifies subscribers with the new catalog on every write", async () => {
    const catalog = new FileBackedWorkspaceLabelCatalog(filePath, logger);
    const seen: string[][] = [];
    catalog.subscribe((next) => {
      seen.push(next.map(nameOf));
    });

    await catalog.set({ name: "blocked", color: "red" });
    await catalog.remove("blocked");

    expect(seen).toEqual([["blocked"], []]);
  });
});

describe("withDerivedLabelColors", () => {
  it("gives a label nobody has coloured its derived colour", () => {
    const merged = withDerivedLabelColors([{ name: "blocked", color: "red" }], ["blocked", "oss"]);
    expect(merged.map((entry) => entry.name)).toEqual(["blocked", "oss"]);
    expect(merged[0].color).toBe("red");
    expect(merged[1].color).toBeDefined();
  });

  it("does not re-add a label the catalog already holds under another spelling", () => {
    expect(withDerivedLabelColors([{ name: "Blocked", color: "red" }], ["blocked"])).toEqual([
      { name: "Blocked", color: "red" },
    ]);
  });

  // Without the flag the response says the same thing about a colour someone chose and one this
  // function invented, and the client cannot offer to undo only the former.
  it("marks the colours it invented and leaves the chosen ones alone", () => {
    const merged = withDerivedLabelColors([{ name: "blocked", color: "red" }], ["blocked", "oss"]);
    expect(merged[0].derived).toBeUndefined();
    expect(merged[1].derived).toBe(true);
  });
});
