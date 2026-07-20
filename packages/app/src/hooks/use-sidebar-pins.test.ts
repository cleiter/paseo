import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { splitPinnedSidebarGroups } from "@/hooks/use-sidebar-pins";

function placement(workspaceKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey,
    serverId: "s1",
    workspaceId: workspaceKey,
    projectViewKey: "p1",
    projectName: "Project 1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: workspaceKey,
  };
}

function project(projectKey: string, workspaces: SidebarWorkspacePlacement[]): SidebarProjectEntry {
  return {
    viewKey: projectKey,
    projectName: projectKey,
    projectKind: "git",
    iconWorkingDir: "",
    hosts: [],
    workspaces,
  };
}

describe("splitPinnedSidebarGroups", () => {
  it("drops the empty shell when every chat of a project is pinned", () => {
    const only = placement("w1");
    const projects = [project("p1", [only])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
    });
    expect(result.pinnedChats).toHaveLength(1);
    expect(result.unpinnedProjects).toHaveLength(0);
  });

  it("keeps a genuinely empty project so its new-workspace row stays reachable", () => {
    const projects = [project("p1", [])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    });
    expect(result.unpinnedProjects).toHaveLength(1);
  });

  it("keeps remaining chats when only some are pinned", () => {
    const projects = [project("p1", [placement("w1"), placement("w2")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["w1"],
        pinnedAtByKey: { w1: "2026-01-01T00:00:00Z" },
      },
    });
    expect(result.pinnedChats.map((w) => w.workspaceKey)).toEqual(["w1"]);
    expect(result.unpinnedProjects[0]?.workspaces.map((w) => w.workspaceKey)).toEqual(["w2"]);
  });

  it("orders pinned chats by most-recently-pinned first when nobody has arranged them", () => {
    const projects = [project("p1", [placement("older"), placement("newer")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("follows the arranged order instead of pinned-at once one exists", () => {
    const projects = [project("p1", [placement("older"), placement("newer")])];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["older", "newer"],
        pinnedAtByKey: {
          older: "2026-01-01T00:00:00Z",
          newer: "2026-02-01T00:00:00Z",
        },
      },
      // The user dragged the older pin back to the top. Recency must not undo that.
      pinnedOrder: ["older", "newer"],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("floats a pin the arranged order has never seen to the top, newest first", () => {
    // Pinned just now, or pinned on a device that never wrote an order. Sorting it to the
    // bottom of a list arranged months ago would hide the thing the user just asked for.
    const projects = [
      project("p1", [placement("arranged"), placement("fresh"), placement("fresher")]),
    ];
    const result = splitPinnedSidebarGroups({
      projects,
      keys: {
        pinnedWorkspaceKeys: ["arranged", "fresh", "fresher"],
        pinnedAtByKey: {
          arranged: "2026-01-01T00:00:00Z",
          fresh: "2026-02-01T00:00:00Z",
          fresher: "2026-03-01T00:00:00Z",
        },
      },
      pinnedOrder: ["arranged"],
    });

    expect(result.pinnedChats.map((workspace) => workspace.workspaceKey)).toEqual([
      "fresher",
      "fresh",
      "arranged",
    ]);
  });
});
