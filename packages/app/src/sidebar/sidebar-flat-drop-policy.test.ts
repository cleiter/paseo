import { describe, expect, it } from "vitest";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { EMPTY_SIDEBAR_LAYOUT } from "@/data/sidebar-layout";
import type {
  SidebarProjectEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/sidebar-workspaces-view-model";
import { groupSidebar } from "@/sidebar/sidebar-groups";
import {
  buildDragRows,
  buildSidebarFlatRows,
  type SidebarDragOrigin,
  type SidebarFlatRow,
} from "@/sidebar/sidebar-flat-rows";
import {
  interpretSidebarDrop,
  snapToValidSlot,
  validSlots,
} from "@/sidebar/sidebar-flat-drop-policy";

// One test per drag bug this feature has actually shipped, each named for the SYMPTOM it
// prevents rather than the function it calls. If one breaks, the failure says what the
// user would have seen.

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
  drag: SidebarDragOrigin | null,
  pinnedChats: SidebarWorkspacePlacement[] = [],
): SidebarFlatRow[] {
  const rows = buildSidebarFlatRows({
    grouped: groupSidebar({ projects, layout: sidebarLayout }),
    pinnedChats,
    pinnedCollapsed: false,
    collapsedProjectKeys: new Set(),
    collapsedGroupKeys: new Set(),
    expandedSections: new Set(),
    hasProjects: projects.length > 0,
    showWorkspacesHeader: true,
    supportsMultiplicityByServerId: new Map(),
    drag,
  });
  return drag ? buildDragRows(rows, drag.key) : rows;
}

function at(rows: readonly SidebarFlatRow[], key: string): number {
  const index = rows.findIndex((row) => row.key === key);
  if (index < 0) {
    throw new Error(`no row ${key} in ${rows.map((row) => row.key).join(", ")}`);
  }
  return index;
}

// `to` is an insertion index into the rows MINUS the dragged one, so a target below the
// dragged row has already shifted up by one. Saying "the slot under that row" out loud
// beats doing the arithmetic in every assertion.
function below(rows: readonly SidebarFlatRow[], from: number, key: string): number {
  const index = at(rows, key);
  return index < from ? index + 1 : index;
}

function above(rows: readonly SidebarFlatRow[], from: number, key: string): number {
  const index = at(rows, key);
  return index < from ? index : index - 1;
}

// paseo: a group with a row in it, an EMPTY group, and an ungrouped remainder.
// spike: a plain project next door, which nothing from paseo may reach.
const PROJECTS = [
  project("paseo", workspace("a", "paseo"), workspace("b", "paseo")),
  project("spike", workspace("c", "spike")),
];
const GROUPED = layout({
  workspaceGroups: [
    { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:a"] },
    { id: "wg2", name: "Spikes", projectKey: "paseo", workspaceKeys: [] },
  ],
});

describe("dragging a workspace", () => {
  const drag: SidebarDragOrigin = {
    kind: "workspace",
    key: "ws:laptop:a",
    projectKey: "paseo",
  };
  const rows = rowsFor(PROJECTS, GROUPED, drag);
  const from = at(rows, "ws:laptop:a");

  it("lands below the row it was dropped past", () => {
    // The direction bug: an insert that is always "before" makes a downward drag a no-op.
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:b"));

    expect(intent).toEqual({
      kind: "move-workspace",
      projectKey: "paseo",
      workspaceKey: "laptop:a",
      groupId: null,
      beforeKey: "laptop:b",
      after: true,
      visibleKeys: ["laptop:b", "laptop:a"],
    });
  });

  it("fills a group that is still empty, aimed at from above", () => {
    // The only way to put the first row in a group: it has no rows to drop between. And
    // from ABOVE, which is the slot dnd-kit's own sorting cannot reach on its own.
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "wgroup:wg2"));

    expect(intent).toEqual({
      kind: "move-workspace",
      projectKey: "paseo",
      workspaceKey: "laptop:a",
      groupId: "wg2",
      beforeKey: null,
      after: false,
      visibleKeys: ["laptop:a"],
    });
  });

  it("lands first in a group with rows already in it", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "wremainder:paseo"));

    expect(intent).toEqual({
      kind: "move-workspace",
      projectKey: "paseo",
      workspaceKey: "laptop:a",
      groupId: null,
      beforeKey: "laptop:b",
      after: false,
      visibleKeys: ["laptop:a", "laptop:b"],
    });
  });

  it("never reaches another project", () => {
    // A workspace group belongs to exactly one project, so a row crossing into another
    // would have to be re-homed as well as re-grouped. It is simply not a slot.
    expect(interpretSidebarDrop(rows, from, below(rows, from, "project:spike"))).toEqual({
      kind: "none",
    });
    expect(interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:c"))).toEqual({
      kind: "none",
    });
  });

  it("does nothing when put back where it came from", () => {
    expect(interpretSidebarDrop(rows, from, from)).toEqual({ kind: "none" });
  });

  it("offers one contiguous span of slots and nothing outside it", () => {
    // What the native list snaps its spacer into. A gap that opens where the drop would be
    // refused is a rejected drop, and a rejected drop strands the rows it displaced.
    const slots = validSlots(rows, from);

    expect(slots).toEqual([
      below(rows, from, "wgroup:wg1"),
      below(rows, from, "wgroup:wg2"),
      below(rows, from, "wremainder:paseo"),
      below(rows, from, "ws:laptop:b"),
    ]);
    expect(slots).toEqual(slots.map((_, index) => slots[0] + index));
  });
});

describe("dragging a workspace in a project with no groups", () => {
  const projects = [project("paseo", workspace("a", "paseo"), workspace("b", "paseo"))];
  const drag: SidebarDragOrigin = {
    kind: "workspace",
    key: "ws:laptop:a",
    projectKey: "paseo",
  };
  const rows = rowsFor(projects, EMPTY_SIDEBAR_LAYOUT, drag);
  const from = at(rows, "ws:laptop:a");

  it("reorders against its neighbours without inventing a group", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:b"));

    expect(intent).toEqual({
      kind: "move-workspace",
      projectKey: "paseo",
      workspaceKey: "laptop:a",
      groupId: null,
      beforeKey: "laptop:b",
      after: true,
      visibleKeys: ["laptop:b", "laptop:a"],
    });
  });
});

describe("dragging a workspace group", () => {
  const drag: SidebarDragOrigin = {
    kind: "workspace-group-header",
    key: "wgroup:wg1",
    projectKey: "paseo",
  };
  const rows = rowsFor(PROJECTS, GROUPED, drag);
  const from = at(rows, "wgroup:wg1");

  it("travels without its rows", () => {
    expect(rows.some((row) => row.key === "ws:laptop:a")).toBe(false);
  });

  it("reorders DOWNWARD, not just upward", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "wgroup:wg2"));

    expect(intent).toEqual({
      kind: "reorder-workspace-groups",
      projectKey: "paseo",
      orderedIds: ["wg2", "wg1"],
    });
  });

  it("cannot land between another group's header and its rows", () => {
    // A container travels as one row, so a slot inside another block would show a gap
    // where nothing can go and write an order the sidebar would not draw.
    const nested = rowsFor(
      PROJECTS,
      layout({
        workspaceGroups: [
          { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: [] },
          { id: "wg2", name: "Spikes", projectKey: "paseo", workspaceKeys: ["laptop:a"] },
        ],
      }),
      drag,
    );

    const nestedFrom = at(nested, "wgroup:wg1");
    expect(
      interpretSidebarDrop(nested, nestedFrom, below(nested, nestedFrom, "wgroup:wg2")),
    ).toEqual({ kind: "none" });
  });

  it("stays out of the remainder, which is not a group it can be ordered against", () => {
    expect(interpretSidebarDrop(rows, from, below(rows, from, "ws:laptop:b"))).toEqual({
      kind: "none",
    });
    expect(interpretSidebarDrop(rows, from, below(rows, from, "project:spike"))).toEqual({
      kind: "none",
    });
  });
});

describe("dragging a project", () => {
  const projects = [project("paseo", workspace("a", "paseo")), project("spike")];
  const grouped = layout({
    projectGroups: [
      { id: "g1", name: "Work", projectKeys: ["paseo"] },
      { id: "g2", name: "Personal", projectKeys: [] },
    ],
    ungroupedProjectKeys: ["spike"],
  });
  const drag: SidebarDragOrigin = {
    kind: "project-header",
    key: "project:paseo",
    projectKey: null,
  };
  const rows = rowsFor(projects, grouped, drag);
  const from = at(rows, "project:paseo");

  it("travels without its workspaces", () => {
    expect(rows.some((row) => row.key === "ws:laptop:a")).toBe(false);
  });

  it("moves into a project group that is still empty", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "pgroup:g2"));

    expect(intent).toEqual({
      kind: "move-project",
      projectKey: "paseo",
      groupId: "g2",
      beforeKey: null,
      after: false,
      visibleKeys: ["paseo"],
    });
  });

  it("moves back out to the ungrouped remainder, below the project it passed", () => {
    // A project is passed only once its whole block is passed, and spike's block ends with
    // the row offering a new workspace. The slot between spike and its own rows is not one.
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "ghost:spike"));

    expect(intent).toEqual({
      kind: "move-project",
      projectKey: "paseo",
      groupId: null,
      beforeKey: "spike",
      after: true,
      visibleKeys: ["spike", "paseo"],
    });
  });

  it("cannot land above every group, where no list exists to join", () => {
    expect(interpretSidebarDrop(rows, from, above(rows, from, "pgroup:g1"))).toEqual({
      kind: "none",
    });
  });

  it("cannot land inside another project's workspaces", () => {
    const twoProjects = rowsFor(
      [project("paseo", workspace("a", "paseo")), project("spike", workspace("c", "spike"))],
      EMPTY_SIDEBAR_LAYOUT,
      drag,
    );

    const twoFrom = at(twoProjects, "project:paseo");
    expect(
      interpretSidebarDrop(twoProjects, twoFrom, below(twoProjects, twoFrom, "project:spike")),
    ).toEqual({ kind: "none" });
  });

  it("reorders inside an ungrouped sidebar with no headers at all", () => {
    const flat = rowsFor(
      [project("paseo", workspace("a", "paseo")), project("spike", workspace("c", "spike"))],
      EMPTY_SIDEBAR_LAYOUT,
      drag,
    );

    const flatFrom = at(flat, "project:paseo");
    const intent = interpretSidebarDrop(flat, flatFrom, below(flat, flatFrom, "ws:laptop:c"));

    expect(intent).toEqual({
      kind: "move-project",
      projectKey: "paseo",
      groupId: null,
      beforeKey: "spike",
      after: true,
      visibleKeys: ["spike", "paseo"],
    });
  });
});

describe("dragging a project group", () => {
  const projects = [project("paseo", workspace("a", "paseo")), project("spike")];
  const grouped = layout({
    projectGroups: [
      { id: "g1", name: "Work", projectKeys: ["paseo"] },
      { id: "g2", name: "Personal", projectKeys: [] },
    ],
    ungroupedProjectKeys: ["spike"],
  });
  const drag: SidebarDragOrigin = {
    kind: "project-group-header",
    key: "pgroup:g1",
    projectKey: null,
  };
  const rows = rowsFor(projects, grouped, drag);
  const from = at(rows, "pgroup:g1");

  it("travels without the projects it holds", () => {
    expect(rows.some((row) => row.key === "project:paseo")).toBe(false);
  });

  it("reorders DOWNWARD, not just upward", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "pgroup:g2"));

    expect(intent).toEqual({ kind: "reorder-project-groups", orderedIds: ["g2", "g1"] });
  });

  it("never mixes the two kinds: it cannot land among the ungrouped projects", () => {
    expect(interpretSidebarDrop(rows, from, below(rows, from, "project:spike"))).toEqual({
      kind: "none",
    });
  });
});

describe("dragging a pinned chat", () => {
  const pinned = [workspace("chat1", "paseo"), workspace("chat2", "paseo")];
  const drag: SidebarDragOrigin = {
    kind: "pinned-workspace",
    key: "pinned:laptop:chat1",
    projectKey: null,
  };
  const rows = rowsFor([project("paseo")], EMPTY_SIDEBAR_LAYOUT, drag, pinned);
  const from = at(rows, "pinned:laptop:chat1");

  it("reorders within Pinned", () => {
    const intent = interpretSidebarDrop(rows, from, below(rows, from, "pinned:laptop:chat2"));

    expect(intent).toEqual({
      kind: "reorder-pinned",
      orderedVisibleKeys: ["laptop:chat2", "laptop:chat1"],
    });
  });

  it("cannot leave Pinned — pinning is the row menu's job, not the drag's", () => {
    expect(interpretSidebarDrop(rows, from, below(rows, from, "project:paseo"))).toEqual({
      kind: "none",
    });
  });
});

describe("validSlots and snapToValidSlot", () => {
  it("agrees with the policy on every index", () => {
    const drag: SidebarDragOrigin = {
      kind: "workspace",
      key: "ws:laptop:a",
      projectKey: "paseo",
    };
    const rows = rowsFor(PROJECTS, GROUPED, drag);
    const from = at(rows, "ws:laptop:a");
    const slots = new Set(validSlots(rows, from));

    for (let to = 0; to < rows.length; to += 1) {
      const isReal = interpretSidebarDrop(rows, from, to).kind !== "none";
      expect(slots.has(to), `slot ${to}`).toBe(isReal || to === from);
    }
  });

  it("pulls an index that is out of bounds back to the nearest real slot", () => {
    expect(snapToValidSlot([3, 4, 5, 6], 0)).toBe(3);
    expect(snapToValidSlot([3, 4, 5, 6], 9)).toBe(6);
    expect(snapToValidSlot([3, 4, 5, 6], 5)).toBe(5);
  });

  it("leaves the index alone when nothing is draggable", () => {
    expect(snapToValidSlot([], 4)).toBe(4);
  });
});
