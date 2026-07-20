import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SidebarLayout } from "@getpaseo/protocol/messages";

import { createInMemorySidebarLayoutBackend, SidebarLayoutStore } from "./sidebar-layout-store.js";
import { FileSidebarLayoutBackend } from "./sidebar-layout-file-backend.js";

function fileStore(): SidebarLayoutStore {
  return new SidebarLayoutStore(new FileSidebarLayoutBackend(filePath, logger), logger);
}

const logger = pino({ level: "silent" });

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), "sidebar-layout-"));
  filePath = path.join(dir, "projects", "sidebar-layout.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function layoutWithGroup(name: string, revision = 1): SidebarLayout {
  return {
    revision,
    updatedAt: new Date(revision * 1000).toISOString(),
    projectGroups: [{ id: "g1", name, projectKeys: ["remote:github.com/acme/api"] }],
    workspaceGroups: [],
    ungroupedProjectKeys: [],
    ungroupedWorkspaceKeysByProject: {},
  };
}

async function readFileAsJson(target: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(target, "utf8"));
}

describe("SidebarLayoutStore", () => {
  it("starts from an empty layout when no file exists", async () => {
    const store = fileStore();
    await store.initialize();

    expect(store.get().revision).toBe(0);
    expect(store.get().projectGroups).toEqual([]);
  });

  it("stores the client's revision verbatim so replicas converge", async () => {
    // The revision travels WITH the content. If the daemon minted one of its own, two
    // hosts holding identical content could sit on different revisions forever.
    const store = fileStore();
    await store.initialize();

    const result = await store.set({
      layout: layoutWithGroup("Work", 7),
      expectedRevision: 0,
    });

    expect(result.status).toBe("accepted");
    expect(result.layout.revision).toBe(7);
    expect(await readFileAsJson(filePath)).toMatchObject({ revision: 7 });
  });

  it("heals a host that fell behind, in one write, without a catch-up loop", async () => {
    // The scenario the design exists for: this host was offline while the user edited
    // elsewhere. Pushing the winning document at ITS revision lands it exactly there,
    // rather than one step behind and still chasing.
    const behind = fileStore();
    await behind.initialize();
    await behind.set({ layout: layoutWithGroup("Work", 3), expectedRevision: 0 });

    const healed = await behind.set({
      layout: layoutWithGroup("Work", 9),
      expectedRevision: 3,
    });

    expect(healed.status).toBe("accepted");
    expect(behind.get().revision).toBe(9);
  });

  it("rejects a stale write and hands back the authoritative layout", async () => {
    const store = fileStore();
    await store.initialize();
    await store.set({ layout: layoutWithGroup("Work", 1), expectedRevision: 0 });

    // A second device still thinks the document is at revision 0.
    const stale = await store.set({
      layout: layoutWithGroup("Personal", 1),
      expectedRevision: 0,
    });

    expect(stale.status).toBe("stale");
    // The loser gets the winner's document, so it can re-apply its edit on top of it
    // instead of clobbering it.
    expect(stale.layout.revision).toBe(1);
    expect(stale.layout.projectGroups[0]?.name).toBe("Work");
    expect(store.get().projectGroups[0]?.name).toBe("Work");
  });

  it("refuses to move the document backwards", async () => {
    const store = fileStore();
    await store.initialize();
    await store.set({ layout: layoutWithGroup("Work", 5), expectedRevision: 0 });

    // Right expectedRevision, but a revision that would roll everyone back.
    const rollback = await store.set({
      layout: layoutWithGroup("Personal", 2),
      expectedRevision: 5,
    });

    expect(rollback.status).toBe("stale");
    expect(store.get().projectGroups[0]?.name).toBe("Work");
  });

  it("publishes accepted writes to listeners and stays silent on rejected ones", async () => {
    const store = fileStore();
    await store.initialize();
    const seen: number[] = [];
    store.onChange((layout) => seen.push(layout.revision));

    await store.set({ layout: layoutWithGroup("Work", 1), expectedRevision: 0 });
    await store.set({ layout: layoutWithGroup("Personal", 1), expectedRevision: 0 });

    expect(seen).toEqual([1]);
  });

  it("quarantines an unreadable layout instead of overwriting it", async () => {
    // The failure this guards against: FileBackedRegistry swallows a parse error, keeps
    // an empty cache, and lets the next write serialize that empty cache over the file.
    // For a document the user hand-arranged, that is silent data loss.
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ this is not json", "utf8");

    const store = fileStore();
    await store.initialize();
    expect(store.get().revision).toBe(0);

    // Writing again must not be what destroys the evidence.
    await store.set({ layout: layoutWithGroup("Work", 1), expectedRevision: 0 });

    const quarantined = (await fs.readdir(path.dirname(filePath))).filter((name) =>
      name.includes(".corrupt-"),
    );
    expect(quarantined).toHaveLength(1);
    const preserved = await fs.readFile(path.join(path.dirname(filePath), quarantined[0]!), "utf8");
    expect(preserved).toBe("{ this is not json");
  });

  it("works against any backend, not just a file", async () => {
    // The point of the seam: the store owns the document rules (revision, conflict,
    // publication) and a backend owns only bytes in and bytes out. Swapping JSON-on-disk
    // for SQLite is a new backend, not a rewrite of any of this.
    const rows = new Map<string, SidebarLayout>();
    const store = new SidebarLayoutStore(
      {
        load: () => Promise.resolve(rows.get("layout") ?? null),
        save: (layout) => {
          rows.set("layout", layout);
          return Promise.resolve();
        },
      },
      logger,
    );
    await store.initialize();

    await store.set({ layout: layoutWithGroup("Work", 1), expectedRevision: 0 });
    const stale = await store.set({ layout: layoutWithGroup("Personal", 1), expectedRevision: 0 });

    expect(stale.status).toBe("stale");
    expect(rows.get("layout")?.projectGroups[0]?.name).toBe("Work");

    // And it reloads from that backend on the next boot.
    const rebooted = new SidebarLayoutStore(
      {
        load: () => Promise.resolve(rows.get("layout") ?? null),
        save: () => Promise.resolve(),
      },
      logger,
    );
    await rebooted.initialize();
    expect(rebooted.get().revision).toBe(1);
  });

  it("never touches disk when it has no file", async () => {
    const store = new SidebarLayoutStore(createInMemorySidebarLayoutBackend(), logger);
    await store.initialize();

    const result = await store.set({ layout: layoutWithGroup("Work", 1), expectedRevision: 0 });

    expect(result.status).toBe("accepted");
    expect(store.get().revision).toBe(1);
    await expect(fs.access(filePath)).rejects.toThrow();
  });
});
