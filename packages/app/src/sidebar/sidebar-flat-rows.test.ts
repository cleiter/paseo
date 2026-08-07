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
  dragOriginForRow,
  isDraggableRow,
  type SidebarFlatRow,
  type SidebarFlatRowsInput,
} from "@/sidebar/sidebar-flat-rows";

// The projection is the whole shape of the sidebar in one array, so these tests read as
// key sequences: what rows exist, in what order, at what depth. Each one is named for the
// thing a user would see go wrong.

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

function input(
  projects: SidebarProjectEntry[],
  sidebarLayout: SidebarLayout,
  overrides: Partial<SidebarFlatRowsInput> = {},
): SidebarFlatRowsInput {
  return {
    grouped: groupSidebar({ projects, layout: sidebarLayout }),
    pinnedChats: [],
    pinnedCollapsed: false,
    collapsedProjectKeys: new Set(),
    collapsedGroupKeys: new Set(),
    expandedSections: new Set(),
    hasProjects: projects.length > 0,
    showWorkspacesHeader: true,
    supportsMultiplicityByServerId: new Map(),
    drag: null,
    ...overrides,
  };
}

function keys(rows: readonly SidebarFlatRow[]): string[] {
  return rows.map((row) => row.key);
}

describe("buildSidebarFlatRows", () => {
  it("emits a grouped sidebar as one array, in the order it is drawn", () => {
    const paseo = project("paseo", workspace("icons", "paseo"), workspace("groups", "paseo"));
    const spike = project("spike", workspace("draft", "spike"));

    const rows = buildSidebarFlatRows(
      input(
        [paseo, spike],
        layout({
          projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo"] }],
          ungroupedProjectKeys: ["spike"],
          workspaceGroups: [
            {
              id: "wg1",
              name: "In review",
              projectKey: "paseo",
              workspaceKeys: ["laptop:icons"],
            },
          ],
        }),
      ),
    );

    expect(keys(rows)).toEqual([
      "workspaces:header",
      "pgroup:g1",
      "project:paseo",
      "wgroup:wg1",
      "ws:laptop:icons",
      "wremainder:paseo",
      "ws:laptop:groups",
      "projects-remainder:header",
      "project:spike",
      "ws:laptop:draft",
    ]);
  });

  it("gives an ungrouped sidebar no headers and no rail", () => {
    // The opt-in invariant: someone who has never made a group must see the sidebar they
    // already have, and a project-level label over the whole list is exactly the change
    // they would notice.
    const rows = buildSidebarFlatRows(
      input([project("paseo", workspace("icons", "paseo"))], EMPTY_SIDEBAR_LAYOUT),
    );

    expect(keys(rows)).toEqual(["workspaces:header", "project:paseo", "ws:laptop:icons"]);
    expect(rows.every((row) => row.railLevels === 0)).toBe(true);
  });

  it("rails a project inside a group one level deeper than its header", () => {
    const rows = buildSidebarFlatRows(
      input(
        [project("paseo", workspace("icons", "paseo"))],
        layout({ projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo"] }] }),
      ),
    );

    const byKey = new Map(rows.map((row) => [row.key, row.railLevels]));
    expect(byKey.get("pgroup:g1")).toBe(0);
    expect(byKey.get("project:paseo")).toBe(1);
    expect(byKey.get("ws:laptop:icons")).toBe(1);
  });

  it("renders a group that has nothing in it", () => {
    // A group is an entity in the document, not a bucket inferred from its members, so
    // the last row leaving must not take the group with it.
    const rows = buildSidebarFlatRows(
      input(
        [project("paseo")],
        layout({
          projectGroups: [
            { id: "g1", name: "Empty", projectKeys: [] },
            { id: "g2", name: "Work", projectKeys: ["paseo"] },
          ],
        }),
      ),
    );

    expect(keys(rows)).toEqual([
      "workspaces:header",
      "pgroup:g1",
      "pgroup:g2",
      "project:paseo",
      // A project with no workspaces still offers the one thing you can do with it.
      "ghost:paseo",
    ]);
  });

  it("collapses a section to its header alone", () => {
    const rows = buildSidebarFlatRows(
      input(
        [project("paseo", workspace("icons", "paseo"))],
        layout({ projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo"] }] }),
        { collapsedGroupKeys: new Set(["g1"]) },
      ),
    );

    expect(keys(rows)).toEqual(["workspaces:header", "pgroup:g1"]);
  });

  it("collapses a project to its header alone", () => {
    const rows = buildSidebarFlatRows(
      input([project("paseo", workspace("icons", "paseo"))], EMPTY_SIDEBAR_LAYOUT, {
        collapsedProjectKeys: new Set(["paseo"]),
      }),
    );

    expect(keys(rows)).toEqual(["workspaces:header", "project:paseo"]);
  });

  it("hides the workspace remainder until a workspace from that project is in flight", () => {
    // Once every workspace has been grouped there is nothing left to drop between, so
    // without this header a row could never be dragged back out. A standing header over
    // nothing is noise, so it appears only while the drag needs it.
    const projects = [project("paseo", workspace("icons", "paseo"))];
    const grouped = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
      ],
    });

    expect(keys(buildSidebarFlatRows(input(projects, grouped)))).toEqual([
      "workspaces:header",
      "project:paseo",
      "wgroup:wg1",
      "ws:laptop:icons",
    ]);

    const dragging = buildSidebarFlatRows(
      input(projects, grouped, {
        drag: { kind: "workspace", key: "ws:laptop:icons", projectKey: "paseo" },
      }),
    );
    expect(keys(dragging)).toEqual([
      "workspaces:header",
      "project:paseo",
      "wgroup:wg1",
      "ws:laptop:icons",
      "wremainder:paseo",
    ]);
  });

  it("does not summon another project's remainder for a drag it cannot reach", () => {
    // Range clamping keeps a workspace inside its own project, so a header in a project
    // the drag can never enter is a row that only makes the list taller.
    const projects = [
      project("paseo", workspace("icons", "paseo")),
      project("spike", workspace("draft", "spike")),
    ];
    const grouped = layout({
      workspaceGroups: [
        { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
        { id: "wg2", name: "Drafts", projectKey: "spike", workspaceKeys: ["laptop:draft"] },
      ],
    });

    const rows = buildSidebarFlatRows(
      input(projects, grouped, {
        drag: { kind: "workspace", key: "ws:laptop:icons", projectKey: "paseo" },
      }),
    );

    expect(keys(rows)).toContain("wremainder:paseo");
    expect(keys(rows)).not.toContain("wremainder:spike");
  });

  it("summons the ungrouped-projects header while a project is in flight", () => {
    const projects = [project("paseo")];
    const grouped = layout({
      projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo"] }],
    });

    expect(keys(buildSidebarFlatRows(input(projects, grouped)))).not.toContain(
      "projects-remainder:header",
    );

    const dragging = buildSidebarFlatRows(
      input(projects, grouped, {
        drag: { kind: "project-header", key: "project:paseo", projectKey: null },
      }),
    );
    expect(keys(dragging)).toContain("projects-remainder:header");
  });

  it("folds a long section behind show more and unfolds it on demand", () => {
    const workspaces = Array.from({ length: 23 }, (_, index) => workspace(`w${index}`, "paseo"));
    const projects = [project("paseo", ...workspaces)];

    const folded = buildSidebarFlatRows(input(projects, EMPTY_SIDEBAR_LAYOUT));
    expect(folded.filter((row) => row.kind === "workspace")).toHaveLength(20);
    expect(keys(folded)).toContain("more:project:paseo");

    const unfolded = buildSidebarFlatRows(
      input(projects, EMPTY_SIDEBAR_LAYOUT, {
        expandedSections: new Set(["project:paseo"]),
      }),
    );
    expect(unfolded.filter((row) => row.kind === "workspace")).toHaveLength(23);
    expect(keys(unfolded)).toContain("more:project:paseo");
  });

  it("puts the pinned chats above everything else and keeps them draggable", () => {
    const rows = buildSidebarFlatRows(
      input([project("paseo", workspace("icons", "paseo"))], EMPTY_SIDEBAR_LAYOUT, {
        pinnedChats: [workspace("chat", "paseo")],
      }),
    );

    expect(keys(rows).slice(0, 2)).toEqual(["pinned:header", "pinned:laptop:chat"]);
    expect(rows.filter(isDraggableRow).map((row) => row.key)).toContain("pinned:laptop:chat");
  });

  it("keeps every row key unique", () => {
    // Native compares the key SEQUENCE to decide whether a drag is still valid, so two
    // rows sharing a key is a drag that cancels itself.
    const rows = buildSidebarFlatRows(
      input(
        [
          project("paseo", workspace("icons", "paseo"), workspace("groups", "paseo")),
          project("spike", workspace("draft", "spike")),
        ],
        layout({
          projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo"] }],
          workspaceGroups: [
            { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
          ],
        }),
        { pinnedChats: [workspace("chat", "paseo")] },
      ),
    );

    expect(new Set(keys(rows)).size).toBe(rows.length);
  });

  it("shows the empty state instead of a list when there is no project at all", () => {
    const rows = buildSidebarFlatRows(input([], EMPTY_SIDEBAR_LAYOUT, { hasProjects: false }));
    expect(keys(rows)).toEqual(["workspaces:header", "empty"]);
  });
});

describe("buildDragRows", () => {
  const projects = [
    project("paseo", workspace("icons", "paseo"), workspace("groups", "paseo")),
    project("spike", workspace("draft", "spike")),
  ];
  const grouped = layout({
    projectGroups: [{ id: "g1", name: "Work", projectKeys: ["paseo", "spike"] }],
    workspaceGroups: [
      { id: "wg1", name: "In review", projectKey: "paseo", workspaceKeys: ["laptop:icons"] },
    ],
  });

  function rowsFor(drag: SidebarFlatRowsInput["drag"]): SidebarFlatRow[] {
    return buildSidebarFlatRows(input(projects, grouped, { drag }));
  }

  it("carries a lifted project group alone, without its members", () => {
    // The preview IS the drop. Dragging the whole block blankets the sidebar you are
    // aiming at and hides the drop targets the drag exists for.
    const rows = rowsFor({ kind: "project-group-header", key: "pgroup:g1", projectKey: null });
    expect(keys(buildDragRows(rows, "pgroup:g1"))).toEqual(["workspaces:header", "pgroup:g1"]);
  });

  it("carries a lifted project alone, without its workspace groups", () => {
    const rows = rowsFor({ kind: "project-header", key: "project:paseo", projectKey: null });
    expect(keys(buildDragRows(rows, "project:paseo"))).toEqual([
      "workspaces:header",
      "pgroup:g1",
      "project:paseo",
      "project:spike",
      "ws:laptop:draft",
      "projects-remainder:header",
    ]);
  });

  it("carries a lifted workspace group alone, without its rows", () => {
    const rows = rowsFor({
      kind: "workspace-group-header",
      key: "wgroup:wg1",
      projectKey: "paseo",
    });
    expect(keys(buildDragRows(rows, "wgroup:wg1"))).toEqual([
      "workspaces:header",
      "pgroup:g1",
      "project:paseo",
      "wgroup:wg1",
      "wremainder:paseo",
      "ws:laptop:groups",
      "project:spike",
      "ws:laptop:draft",
    ]);
  });

  it("leaves the rows alone when what was lifted is not a container", () => {
    const rows = rowsFor({ kind: "workspace", key: "ws:laptop:groups", projectKey: "paseo" });
    expect(keys(buildDragRows(rows, "ws:laptop:groups"))).toEqual(keys(rows));
  });

  it("never changes a row at or above the one being dragged", () => {
    // The invariant the whole design rests on. Native measures the lifted cell's offset
    // once; anything appearing above it moves the row out from under the finger, and
    // anything disappearing above it cancels the drag outright.
    const atRest = buildSidebarFlatRows(input(projects, grouped));

    for (const row of atRest.filter(isDraggableRow)) {
      const origin = dragOriginForRow(row);
      expect(origin).not.toBeNull();
      if (!origin) {
        continue;
      }
      const dragRows = buildDragRows(rowsFor(origin), origin.key);
      const activeIndex = dragRows.findIndex((candidate) => candidate.key === origin.key);
      const restIndex = atRest.findIndex((candidate) => candidate.key === origin.key);

      expect(activeIndex, `${origin.key} kept its index`).toBe(restIndex);
      expect(keys(dragRows.slice(0, activeIndex + 1))).toEqual(
        keys(atRest.slice(0, restIndex + 1)),
      );
    }
  });
});
