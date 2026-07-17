import { describe, expect, it } from "vitest";
import { buildDiffFlatItems, sumHeightsBefore, type DiffFlatItem } from "./diff-flat-items";
import type { ParsedDiffFile } from "@/git/use-diff-query";

function createFile(path: string, additions = 1, deletions = 0): ParsedDiffFile {
  return { path, isNew: false, isDeleted: false, additions, deletions, hunks: [] };
}

function summarize(items: DiffFlatItem[]): string[] {
  return items.map((item) => {
    if (item.type === "folder") {
      return `${"  ".repeat(item.depth)}[${item.displayName}]${item.collapsed ? " (collapsed)" : ""}`;
    }
    if (item.type === "dirLabel") {
      return `${item.dirPath}/`;
    }
    const base = item.file.path.split("/").pop();
    return `${"  ".repeat(item.depth)}${item.type === "body" ? "body:" : ""}${base}`;
  });
}

describe("buildDiffFlatItems", () => {
  const files = [createFile("src/app/a.ts"), createFile("src/app/nested/b.ts")];

  it("emits a body and a sticky index for each expanded file", () => {
    const { items, stickyHeaderIndices } = buildDiffFlatItems({
      files: [createFile("a.ts"), createFile("b.ts")],
      viewMode: "tree",
      collapsedFolders: new Set(),
      expandedPaths: new Set(["a.ts"]),
    });
    // Root-level files (no folder): header, body (for expanded a.ts), header
    expect(summarize(items)).toEqual(["a.ts", "body:a.ts", "b.ts"]);
    // sticky points at the header (index 0), not the body
    expect(stickyHeaderIndices).toEqual([0]);
    expect(items[0].type).toBe("header");
  });

  it("groups flat files under directory-path labels, never folder rows", () => {
    const { items, stickyHeaderIndices } = buildDiffFlatItems({
      files,
      viewMode: "flat",
      collapsedFolders: new Set(),
      expandedPaths: new Set(["src/app/a.ts"]),
    });

    // Each file sits under its own directory label; the label is not indented and
    // sticky indices still point only at expanded file headers.
    expect(summarize(items)).toEqual(["src/app/", "a.ts", "body:a.ts", "src/app/nested/", "b.ts"]);
    expect(stickyHeaderIndices).toEqual([1]);
    expect(items.every((item) => item.type !== "folder")).toBe(true);
  });

  it("shares one directory label for consecutive files in the same directory", () => {
    const { items } = buildDiffFlatItems({
      files: [createFile("src/a.ts"), createFile("src/b.ts")],
      viewMode: "flat",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    expect(summarize(items)).toEqual(["src/", "a.ts", "b.ts"]);
  });

  it("emits no directory label for root-level files in flat mode", () => {
    const { items } = buildDiffFlatItems({
      files: [createFile("a.ts"), createFile("b.ts")],
      viewMode: "flat",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    expect(summarize(items)).toEqual(["a.ts", "b.ts"]);
    expect(items.every((item) => item.type === "header")).toBe(true);
  });

  it("indents a flat file only when a directory label was emitted above it", () => {
    // A root file has no label, so indenting it would indent it under nothing.
    const { items } = buildDiffFlatItems({
      files: [createFile("README.md"), createFile("src/a.ts")],
      viewMode: "flat",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    expect(summarize(items)).toEqual(["README.md", "src/", "a.ts"]);
    const headers = items.filter((item) => item.type === "header");
    expect(headers.map((h) => (h.type === "header" ? h.underDirLabel : null))).toEqual([
      false,
      true,
    ]);
  });

  it("never marks tree-mode files as sitting under a flat directory label", () => {
    // Tree mode indents via `depth`; underDirLabel is a flat-list concern only.
    const { items } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    const headers = items.filter((item) => item.type === "header");
    expect(headers.every((h) => h.type === "header" && h.underDirLabel === false)).toBe(true);
  });

  it("groups files under compressed folder rows, all expanded by default", () => {
    const { items } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    // dirs sort before files within a level: [nested] precedes a.ts
    expect(summarize(items)).toEqual(["[src/app]", "  [nested]", "    b.ts", "  a.ts"]);
  });

  it("collapsing a folder hides its descendants but keeps the row", () => {
    const { items } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(["src/app/nested"]),
      expandedPaths: new Set(),
    });
    expect(summarize(items)).toEqual(["[src/app]", "  [nested] (collapsed)", "  a.ts"]);
  });

  it("collapsing an ancestor hides everything below it", () => {
    const { items } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(["src/app"]),
      expandedPaths: new Set(),
    });
    expect(summarize(items)).toEqual(["[src/app] (collapsed)"]);
  });

  it("derives sticky indices file-headers-only from the post-collapse list", () => {
    // dirs-first: [src/app], [nested], b.ts, a.ts. Expanding a.ts puts its
    // header at index 3, with the body right after.
    const { items, stickyHeaderIndices } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(),
      expandedPaths: new Set(["src/app/a.ts"]),
    });
    expect(summarize(items)).toEqual([
      "[src/app]",
      "  [nested]",
      "    b.ts",
      "  a.ts",
      "  body:a.ts",
    ]);
    expect(stickyHeaderIndices).toEqual([3]);
    for (const idx of stickyHeaderIndices) {
      expect(items[idx].type).toBe("header");
    }
  });

  it("maps tree file rows back to their original files array index", () => {
    const { items } = buildDiffFlatItems({
      files,
      viewMode: "tree",
      collapsedFolders: new Set(),
      expandedPaths: new Set(),
    });
    // Tree order is b.ts (fileIndex 1) then a.ts (fileIndex 0)
    const headers = items.filter((i) => i.type === "header");
    expect(headers.map((h) => (h.type === "header" ? h.fileIndex : -1))).toEqual([1, 0]);
  });
});

describe("sumHeightsBefore", () => {
  const items = buildDiffFlatItems({
    files: [createFile("src/a.ts"), createFile("src/b.ts")],
    viewMode: "tree",
    collapsedFolders: new Set(),
    expandedPaths: new Set(),
  }).items; // [folder, a.ts, b.ts]

  const heightFor = (item: DiffFlatItem) => (item.type === "folder" ? 10 : 20);

  it("sums the heights of items before the index, counting folder rows", () => {
    expect(sumHeightsBefore(items, 0, heightFor)).toBe(0);
    expect(sumHeightsBefore(items, 1, heightFor)).toBe(10); // folder above a.ts
    expect(sumHeightsBefore(items, 2, heightFor)).toBe(30); // folder + a.ts above b.ts
  });

  it("clamps an out-of-range index to the list length", () => {
    expect(sumHeightsBefore(items, 999, heightFor)).toBe(50);
  });
});
