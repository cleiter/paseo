import { describe, expect, it, vi } from "vitest";
import {
  canRenameWorkspaceLabelEverywhere,
  canWriteWorkspaceLabelCatalog,
  deleteWorkspaceLabelEverywhere,
  renameWorkspaceLabelEverywhere,
  resetWorkspaceLabelColorEverywhere,
  selectWorkspaceLabelCatalogTargets,
  setWorkspaceLabelColorEverywhere,
  summarizeWorkspaceLabelCatalogWrites,
  type WorkspaceLabelCatalogClient,
  type WorkspaceLabelCatalogHost,
} from "./catalog-writes";

const ONLINE = { serverId: "a", connected: true, supported: true, supportsRename: true };
const OFFLINE = { serverId: "b", connected: false, supported: true, supportsRename: true };
const OLD = { serverId: "c", connected: true, supported: false, supportsRename: false };
// Ships labels, predates the rename RPC.
const NO_RENAME = { serverId: "e", connected: true, supported: true, supportsRename: false };

function stubClient(): WorkspaceLabelCatalogClient & {
  setWorkspaceLabelColor: ReturnType<typeof vi.fn>;
  removeWorkspaceLabel: ReturnType<typeof vi.fn>;
  renameWorkspaceLabel: ReturnType<typeof vi.fn>;
} {
  return {
    setWorkspaceLabelColor: vi.fn().mockResolvedValue([]),
    removeWorkspaceLabel: vi.fn().mockResolvedValue([]),
    renameWorkspaceLabel: vi.fn().mockResolvedValue([]),
  };
}

describe("selectWorkspaceLabelCatalogTargets", () => {
  it("writes to every connected host that supports labels, not just the one in front of you", () => {
    const targets = selectWorkspaceLabelCatalogTargets([
      ONLINE,
      { serverId: "d", connected: true, supported: true, supportsRename: true },
    ]);
    expect(targets).toEqual(["a", "d"]);
  });

  it("skips an offline host and a host too old to know about labels", () => {
    expect(selectWorkspaceLabelCatalogTargets([ONLINE, OFFLINE, OLD])).toEqual(["a"]);
  });

  it("reports nothing to write to when no host can take the write", () => {
    expect(canWriteWorkspaceLabelCatalog([OFFLINE, OLD])).toBe(false);
    expect(canWriteWorkspaceLabelCatalog([ONLINE, OLD])).toBe(true);
  });
});

describe("summarizeWorkspaceLabelCatalogWrites", () => {
  it("calls a write with no targets noHost rather than a success", () => {
    expect(summarizeWorkspaceLabelCatalogWrites([])).toEqual({ status: "noHost" });
  });

  it("is ok when every host took the write", () => {
    expect(
      summarizeWorkspaceLabelCatalogWrites([
        { status: "fulfilled", value: [] },
        { status: "fulfilled", value: [] },
      ]),
    ).toEqual({ status: "ok" });
  });

  it("is failed when every host rejected", () => {
    expect(
      summarizeWorkspaceLabelCatalogWrites([{ status: "rejected", reason: new Error("nope") }]),
    ).toEqual({ status: "failed", error: "nope" });
  });

  // The one outcome you cannot see on screen: whether the colour you are looking at is the one
  // that landed depends on which host wins the merge, so a partial write has to say so.
  it("distinguishes a partial write from both", () => {
    expect(
      summarizeWorkspaceLabelCatalogWrites([
        { status: "fulfilled", value: [] },
        { status: "rejected", reason: new Error("nope") },
      ]),
    ).toEqual({ status: "partial", failed: 1, total: 2, error: "nope" });
  });
});

describe("catalog writes", () => {
  it("sends the colour to every eligible host", async () => {
    const first = stubClient();
    const second = stubClient();
    const clients: Record<string, WorkspaceLabelCatalogClient> = { a: first, d: second };
    const verdict = await setWorkspaceLabelColorEverywhere(
      {
        getHosts: () => [
          ONLINE,
          OFFLINE,
          OLD,
          { serverId: "d", connected: true, supported: true, supportsRename: true },
        ],
        getClient: (serverId) => clients[serverId] ?? null,
      },
      { name: "blocked", color: "red" },
    );

    expect(verdict).toEqual({ status: "ok" });
    expect(first.setWorkspaceLabelColor).toHaveBeenCalledWith("blocked", "red");
    expect(second.setWorkspaceLabelColor).toHaveBeenCalledWith("blocked", "red");
  });

  it("keeps the label on its workspaces when only the colour is reset", async () => {
    const client = stubClient();
    await resetWorkspaceLabelColorEverywhere(
      { getHosts: () => [ONLINE], getClient: () => client },
      { name: "blocked" },
    );
    expect(client.removeWorkspaceLabel).toHaveBeenCalledWith("blocked", { detach: false });
  });

  it("strips the label off its workspaces when the label itself is deleted", async () => {
    const client = stubClient();
    await deleteWorkspaceLabelEverywhere(
      { getHosts: () => [ONLINE], getClient: () => client },
      { name: "blocked" },
    );
    expect(client.removeWorkspaceLabel).toHaveBeenCalledWith("blocked", { detach: true });
  });

  it("reports noHost rather than a silent success when nothing is connected", async () => {
    const verdict = await setWorkspaceLabelColorEverywhere(
      { getHosts: () => [OFFLINE, OLD], getClient: () => null },
      { name: "blocked", color: "red" },
    );
    expect(verdict).toEqual({ status: "noHost" });
  });

  it("survives one host rejecting and says which way it went", async () => {
    const good = stubClient();
    const bad = stubClient();
    bad.setWorkspaceLabelColor.mockRejectedValue(new Error("host is read-only"));
    const clients: Record<string, WorkspaceLabelCatalogClient> = { a: good, d: bad };
    const verdict = await setWorkspaceLabelColorEverywhere(
      {
        getHosts: () => [
          ONLINE,
          { serverId: "d", connected: true, supported: true, supportsRename: true },
        ],
        getClient: (serverId) => clients[serverId] ?? null,
      },
      { name: "blocked", color: "red" },
    );
    expect(verdict).toEqual({
      status: "partial",
      failed: 1,
      total: 2,
      error: "host is read-only",
    });
  });
});

describe("canRenameWorkspaceLabelEverywhere", () => {
  it("allows a rename when every reachable host can take it", () => {
    expect(canRenameWorkspaceLabelEverywhere([ONLINE, OFFLINE, OLD])).toBe(true);
  });

  // A partial rename leaves the old name on one host and the new one on another, and because the
  // name is the identity that reads as two labels rather than one label mid-flight.
  it("refuses when a reachable host ships labels but not the rename", () => {
    expect(canRenameWorkspaceLabelEverywhere([ONLINE, NO_RENAME])).toBe(false);
  });

  it("refuses when there is no host to rename on at all", () => {
    expect(canRenameWorkspaceLabelEverywhere([OFFLINE, OLD])).toBe(false);
  });
});

describe("renameWorkspaceLabelEverywhere", () => {
  it("renames on every connected host", async () => {
    const first = stubClient();
    const second = stubClient();
    const clients: Record<string, WorkspaceLabelCatalogClient> = { a: first, d: second };

    const verdict = await renameWorkspaceLabelEverywhere(
      {
        getHosts: () => [
          ONLINE,
          { serverId: "d", connected: true, supported: true, supportsRename: true },
        ],
        getClient: (serverId) => clients[serverId] ?? null,
      },
      { from: "blocked", to: "waiting" },
    );

    expect(verdict).toEqual({ status: "ok" });
    expect(first.renameWorkspaceLabel).toHaveBeenCalledWith("blocked", "waiting");
    expect(second.renameWorkspaceLabel).toHaveBeenCalledWith("blocked", "waiting");
  });

  // The rename dialog is mounted at the app root, so the hosts it would have captured at render
  // are the ones from before the daemon finished connecting. Reading them when the write fires is
  // what stops a rename on a long-lived surface reporting "no host" against a connected daemon.
  it("reads the host list when the write fires, not when the deps were built", async () => {
    const client = stubClient();
    let hosts: WorkspaceLabelCatalogHost[] = [OFFLINE];
    const deps = { getHosts: () => hosts, getClient: () => client };
    hosts = [ONLINE];

    const verdict = await renameWorkspaceLabelEverywhere(deps, { from: "blocked", to: "waiting" });

    expect(verdict).toEqual({ status: "ok" });
    expect(client.renameWorkspaceLabel).toHaveBeenCalledWith("blocked", "waiting");
  });

  it("surfaces the daemon's reason when a host refuses the name", async () => {
    const client = stubClient();
    client.renameWorkspaceLabel.mockRejectedValue(new Error("A label named review already exists"));

    const verdict = await renameWorkspaceLabelEverywhere(
      { getHosts: () => [ONLINE], getClient: () => client },
      { from: "blocked", to: "review" },
    );

    expect(verdict).toEqual({
      status: "failed",
      error: "A label named review already exists",
    });
  });
});
