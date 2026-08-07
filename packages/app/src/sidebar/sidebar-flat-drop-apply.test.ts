import { describe, expect, it } from "vitest";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { EMPTY_SIDEBAR_LAYOUT } from "@/data/sidebar-layout";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { applyDropIntent, legacyDropFallback } from "@/sidebar/sidebar-flat-drop-apply";
import { interpretSidebarDrop } from "@/sidebar/sidebar-flat-drop-policy";
import {
  buildDragRows,
  buildSidebarFlatRows,
  type SidebarDragOrigin,
  type SidebarFlatRow,
} from "@/sidebar/sidebar-flat-rows";
import { groupSidebar } from "@/sidebar/sidebar-groups";

// The drop applies to the document as it is at DROP time, not the one the drag was frozen
// against. Each test names the drift it survives, or the write it refuses to make.

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
        projectId: `prj_${viewKey}`,
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

function rowsFor(
  projects: SidebarProjectEntry[],
  sidebarLayout: SidebarLayout,
  drag: SidebarDragOrigin,
): SidebarFlatRow[] {
  return buildDragRows(
    buildSidebarFlatRows({
      grouped: groupSidebar({ projects, layout: sidebarLayout }),
      pinnedChats: [],
      pinnedCollapsed: false,
      collapsedProjectKeys: new Set(),
      collapsedGroupKeys: new Set(),
      expandedSections: new Set(),
      hasProjects: projects.length > 0,
      showWorkspacesHeader: true,
      supportsMultiplicityByServerId: new Map(),
      drag,
    }),
    drag.key,
  );
}

function at(rows: readonly SidebarFlatRow[], key: string): number {
  const index = rows.findIndex((row) => row.key === key);
  if (index < 0) {
    throw new Error(`no row ${key} in ${rows.map((row) => row.key).join(", ")}`);
  }
  return index;
}

// `to` is an insertion index into the rows minus the dragged one, so a target below the
// dragged row has already shifted up by one.
function below(rows: readonly SidebarFlatRow[], from: number, key: string): number {
  const index = at(rows, key);
  return index < from ? index + 1 : index;
}

const PROJECTS = [project("paseo", workspace("a", "paseo"), workspace("b", "paseo"))];
const WORKSPACE_DRAG: SidebarDragOrigin = {
  kind: "workspace",
  key: "ws:laptop:b",
  projectKey: "paseo",
};

// paseo's workspace b sits in the remainder; a is in the "In review" group.
const GROUPED = layout({
  workspaceGroups: [
    { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:a"] },
  ],
  ungroupedWorkspaceKeysByProject: { paseo: ["laptop:b"] },
});

function dropWorkspaceIntoReviewGroup() {
  const rows = rowsFor(PROJECTS, GROUPED, WORKSPACE_DRAG);
  const from = at(rows, "ws:laptop:b");
  return interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:a"));
}

describe("applying a workspace drop", () => {
  it("stores the workspace in the group it was dropped into, in the slot it landed in", () => {
    const next = applyDropIntent(GROUPED, dropWorkspaceIntoReviewGroup());

    expect(next?.workspaceGroups[0].workspaceKeys).toEqual(["laptop:a", "laptop:b"]);
    expect(next?.ungroupedWorkspaceKeysByProject.paseo).toEqual([]);
  });

  it("refuses to write when the group it was dropped into is deleted mid-drag", () => {
    // Not a hypothetical: the group's own menu can delete it from another device while a
    // row is in the air. The write would match no group at all, and because the move lifts
    // the key out of its old list FIRST, the workspace would end up stored nowhere.
    const deleted = layout({
      workspaceGroups: [],
      ungroupedWorkspaceKeysByProject: GROUPED.ungroupedWorkspaceKeysByProject,
    });

    expect(applyDropIntent(deleted, dropWorkspaceIntoReviewGroup())).toBeNull();
    expect(deleted.ungroupedWorkspaceKeysByProject.paseo).toEqual(["laptop:b"]);
  });

  it("still joins the group when the row it was dropped onto is gone", () => {
    // The anchor names a position, not a permission. The drag was frozen against rows that
    // still showed it, so it is adopted back in along with the move — a key for a workspace
    // that no longer exists, which the render ignores — and the moved row keeps the slot
    // the user actually dropped it in.
    const withoutAnchor = layout({
      workspaceGroups: [{ id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: [] }],
      ungroupedWorkspaceKeysByProject: { paseo: ["laptop:b"] },
    });

    const next = applyDropIntent(withoutAnchor, dropWorkspaceIntoReviewGroup());

    expect(next?.workspaceGroups[0].workspaceKeys).toEqual(["laptop:a", "laptop:b"]);
    expect(next?.ungroupedWorkspaceKeysByProject.paseo).toEqual([]);
  });

  it("takes a workspace back out of its group when dropped in the remainder", () => {
    const drag: SidebarDragOrigin = { kind: "workspace", key: "ws:laptop:a", projectKey: "paseo" };
    const rows = rowsFor(PROJECTS, GROUPED, drag);
    const from = at(rows, "ws:laptop:a");
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:b"));

    const next = applyDropIntent(GROUPED, intent);

    expect(next?.workspaceGroups[0].workspaceKeys).toEqual([]);
    expect(next?.ungroupedWorkspaceKeysByProject.paseo).toEqual(["laptop:b", "laptop:a"]);
  });
});

describe("applying a project drop", () => {
  const projects = [project("paseo", workspace("a", "paseo")), project("spike")];
  const grouped = layout({
    projectGroups: [
      { id: "g1", name: "Work", projectKeys: [] },
      { id: "g2", name: "Personal", projectKeys: [] },
    ],
    ungroupedProjectKeys: ["paseo", "spike"],
  });
  const drag: SidebarDragOrigin = {
    kind: "project-header",
    key: "project:paseo",
    projectKey: null,
  };

  function dropProjectIntoWork() {
    const rows = rowsFor(projects, grouped, drag);
    const from = at(rows, "project:paseo");
    return interpretSidebarDrop(rows, from, below(rows, from, "pgroup:g1"));
  }

  it("stores the project in the group it was dropped into", () => {
    const next = applyDropIntent(grouped, dropProjectIntoWork());

    expect(next?.projectGroups[0].projectKeys).toEqual(["paseo"]);
    expect(next?.ungroupedProjectKeys).toEqual(["spike"]);
  });

  it("refuses to write when the project group is deleted mid-drag", () => {
    const deleted = layout({
      projectGroups: [{ id: "g2", name: "Personal", projectKeys: [] }],
      ungroupedProjectKeys: ["paseo", "spike"],
    });

    expect(applyDropIntent(deleted, dropProjectIntoWork())).toBeNull();
  });
});

describe("applying a group reorder", () => {
  const projects = [project("paseo", workspace("a", "paseo"))];
  const grouped = layout({
    workspaceGroups: [
      { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:a"] },
      { id: "wg2", name: "Spikes", projectKey: "paseo", workspaceKeys: [] },
      { id: "wg3", name: "Done", projectKey: "paseo", workspaceKeys: [] },
    ],
  });
  const drag: SidebarDragOrigin = {
    kind: "workspace-group-header",
    key: "wgroup:wg1",
    projectKey: "paseo",
  };

  function dropReviewBelowSpikes() {
    const rows = rowsFor(projects, grouped, drag);
    const from = at(rows, "wgroup:wg1");
    return interpretSidebarDrop(rows, from, below(rows, from, "wgroup:wg2"));
  }

  it("writes the order the drag ended in", () => {
    const next = applyDropIntent(grouped, dropReviewBelowSpikes());

    expect(next?.workspaceGroups.map((group) => group.id)).toEqual(["wg2", "wg1", "wg3"]);
  });

  it("leaves the survivors alone when the dragged group is deleted mid-drag", () => {
    const deleted = layout({
      workspaceGroups: grouped.workspaceGroups.filter((group) => group.id !== "wg1"),
    });

    const next = applyDropIntent(deleted, dropReviewBelowSpikes());

    expect(next?.workspaceGroups.map((group) => group.id)).toEqual(["wg2", "wg3"]);
  });
});

describe("applying a pinned reorder", () => {
  it("keeps the slot of a pin whose host is offline", () => {
    const pinned = layout({ pinnedWorkspaceKeys: ["laptop:a", "phone:z", "laptop:b"] });
    const next = applyDropIntent(pinned, {
      kind: "reorder-pinned",
      orderedVisibleKeys: ["laptop:b", "laptop:a"],
    });

    expect(next?.pinnedWorkspaceKeys).toEqual(["laptop:b", "phone:z", "laptop:a"]);
  });
});

describe("a drop that says nothing", () => {
  it("writes nothing", () => {
    expect(applyDropIntent(GROUPED, { kind: "none" })).toBeNull();
  });
});

describe("a host too old to store a layout", () => {
  it("reorders the workspaces of one project", () => {
    const flat = rowsFor(PROJECTS, EMPTY_SIDEBAR_LAYOUT, WORKSPACE_DRAG);
    const from = at(flat, "ws:laptop:b");
    const intent = interpretSidebarDrop(flat, from, at(flat, "ws:laptop:a"));

    expect(legacyDropFallback(intent)).toEqual({
      kind: "reorder-workspaces",
      projectKey: "paseo",
      orderedVisibleKeys: ["laptop:b", "laptop:a"],
    });
  });

  it("has no answer for a move into a group, which it could not have offered", () => {
    expect(legacyDropFallback(dropWorkspaceIntoReviewGroup())).toBeNull();
    expect(legacyDropFallback({ kind: "reorder-project-groups", orderedIds: ["g1"] })).toBeNull();
  });
});
