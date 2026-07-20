import { describe, expect, it } from "vitest";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { EMPTY_SIDEBAR_LAYOUT } from "@/data/sidebar-layout";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { groupSidebar } from "@/sidebar/sidebar-groups";

function workspace(name: string, projectViewKey: string): SidebarWorkspacePlacement {
  return {
    workspaceKey: `laptop:${name}`,
    serverId: "laptop",
    workspaceId: name,
    projectViewKey,
    projectName: projectViewKey,
    projectKind: "git",
    workspaceKind: "worktree",
    name,
  };
}

function project(viewKey: string, ...workspaces: SidebarWorkspacePlacement[]) {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "git",
    iconWorkingDir: `/repos/${viewKey}`,
    hosts: [
      {
        serverId: "laptop",
        projectId: viewKey,
        iconWorkingDir: `/repos/${viewKey}`,
        worktreeSupport: "supported",
      },
    ],
    workspaces,
  } satisfies SidebarProjectEntry;
}

function layout(overrides: Partial<SidebarLayout>): SidebarLayout {
  return { ...EMPTY_SIDEBAR_LAYOUT, revision: 1, ...overrides };
}

describe("groupSidebar", () => {
  it("leaves the sidebar untouched when nothing is grouped", () => {
    // The opt-in invariant, and the one thing that must never regress: someone who has
    // never made a group sees the sidebar they already have.
    const paseo = project("paseo", workspace("icons", "paseo"), workspace("groups", "paseo"));
    const other = project("other", workspace("spike", "other"));

    const result = groupSidebar({ projects: [paseo, other], layout: EMPTY_SIDEBAR_LAYOUT });

    expect(result.hasGroups).toBe(false);
    expect(result.projectGroups).toEqual([]);
    expect(result.ungroupedProjects.map((entry) => entry.viewKey)).toEqual(["paseo", "other"]);
    expect(result.ungroupedProjects[0]?.workspaceGroups).toEqual([]);
    expect(
      result.ungroupedProjects[0]?.ungroupedWorkspaces.map((entry) => entry.workspaceKey),
    ).toEqual(["laptop:icons", "laptop:groups"]);
  });

  it("renders a group with nothing in it", () => {
    // The reason the model changed. A group inferred from its members cannot outlive
    // them, so dragging the last row out used to destroy the group silently.
    const result = groupSidebar({
      projects: [project("paseo")],
      layout: layout({
        projectGroups: [{ id: "g1", name: "Experiments", projectKeys: [] }],
        ungroupedProjectKeys: ["paseo"],
      }),
    });

    expect(result.projectGroups).toHaveLength(1);
    expect(result.projectGroups[0]?.groupName).toBe("Experiments");
    expect(result.projectGroups[0]?.projects).toEqual([]);
    expect(result.ungroupedProjects.map((entry) => entry.viewKey)).toEqual(["paseo"]);
  });

  it("orders groups by the document, not by where their members sit", () => {
    // The other reason. A group's position used to BE its first member's position, so
    // groups had no order of their own and could not be dragged.
    const result = groupSidebar({
      projects: [project("paseo"), project("other")],
      layout: layout({
        projectGroups: [
          { id: "g2", name: "Personal", projectKeys: ["other"] },
          { id: "g1", name: "Work", projectKeys: ["paseo"] },
        ],
      }),
    });

    expect(result.projectGroups.map((group) => group.groupName)).toEqual(["Personal", "Work"]);
    expect(result.projectGroups[0]?.projects.map((entry) => entry.viewKey)).toEqual(["other"]);
  });

  it("buckets workspaces into their groups and leaves the rest ungrouped", () => {
    const paseo = project(
      "paseo",
      workspace("icons", "paseo"),
      workspace("groups", "paseo"),
      workspace("spike", "paseo"),
    );

    const result = groupSidebar({
      projects: [paseo],
      layout: layout({
        workspaceGroups: [
          { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
          { id: "wg2", name: "Spikes", projectKey: "paseo", workspaceKeys: ["laptop:spike"] },
        ],
      }),
    });

    const entry = result.ungroupedProjects[0];
    expect(entry?.workspaceGroups.map((group) => group.groupName)).toEqual(["In review", "Spikes"]);
    expect(entry?.workspaceGroups[0]?.workspaces.map((w) => w.workspaceKey)).toEqual([
      "laptop:icons",
    ]);
    expect(entry?.ungroupedWorkspaces.map((w) => w.workspaceKey)).toEqual(["laptop:groups"]);
  });

  it("keeps a workspace group scoped to its own project", () => {
    const result = groupSidebar({
      projects: [
        project("paseo", workspace("icons", "paseo")),
        project("other", workspace("spike", "other")),
      ],
      layout: layout({
        workspaceGroups: [
          { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
        ],
      }),
    });

    expect(result.ungroupedProjects[0]?.workspaceGroups).toHaveLength(1);
    // The sibling project must not sprout a group it was never given.
    expect(result.ungroupedProjects[1]?.workspaceGroups).toHaveLength(0);
    expect(
      result.ungroupedProjects[1]?.ungroupedWorkspaces.map((entry) => entry.workspaceKey),
    ).toEqual(["laptop:spike"]);
  });

  it("skips members it cannot resolve instead of rendering a ghost row", () => {
    // The document is replicated to every host, so it names projects and workspaces this
    // client may not be connected to. Those keys stay in storage and simply do not draw.
    const result = groupSidebar({
      projects: [project("paseo")],
      layout: layout({
        projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo", "on-another-machine"] }],
      }),
    });

    expect(result.projectGroups[0]?.projects.map((entry) => entry.viewKey)).toEqual(["paseo"]);
  });
});
