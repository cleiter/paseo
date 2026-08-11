import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import { applySidebarFilter, NO_SIDEBAR_FILTER } from "./sidebar-filter";
import { buildSidebarProjection } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey: "project",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    labels,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [
      {
        serverId: "srv",
        projectId: "project",
        iconWorkingDir: "/repo",
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: SidebarGroupMode;
  knownLabels?: readonly string[];
  pinnedCollapsed?: boolean;
  labels?: Record<string, string[]>;
  labelFilters?: Record<string, "include" | "exclude">;
  projectFilters?: readonly string[];
  extraProjects?: SidebarProjectEntry[];
}) {
  const pinned = makeWorkspace("pinned", "running", options?.labels?.pinned);
  const unpinned = makeWorkspace("unpinned", "needs_input", options?.labels?.unpinned);
  const entries = [pinned.entry, unpinned.entry];
  return {
    projects: [
      makeProject([pinned.placement, unpinned.placement]),
      ...(options?.extraProjects ?? []),
    ],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    knownLabels: options?.knownLabels ?? [],
    unlabelledLabel: "Unlabeled",
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedStatusGroupKeys: new Set<string>(),
    collapsedLabelGroupKeys: new Set<string>(),
    filter: makeFilter(entries, options),
  };
}

function makeFilter(
  entries: SidebarWorkspaceEntry[],
  options?: {
    labelFilters?: Record<string, "include" | "exclude">;
    projectFilters?: readonly string[];
  },
) {
  const labelFilters = options?.labelFilters;
  const projectFilters = options?.projectFilters;
  if (!labelFilters && !projectFilters) return NO_SIDEBAR_FILTER;
  return applySidebarFilter({
    workspaces: entries.map((entry) => ({
      workspaceKey: entry.workspaceKey,
      projectViewKey: entry.projectViewKey,
      labels: entry.labels,
    })),
    projectFilters: projectFilters ?? [],
    labelMatch: "any",
    labelFilters: labelFilters ?? {},
    activeWorkspaceKey: null,
  });
}

describe("buildSidebarProjection", () => {
  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.groups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.groups[0]?.rows.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("takes a filtered-out workspace out of its project section and out of the number keys", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        labels: { pinned: ["oss"], unpinned: ["work"] },
        labelFilters: { oss: "include" },
      }),
    );

    // The project section goes with its last visible workspace rather than sitting there empty.
    expect(projection.pinnedGroups.unpinnedProjects).toEqual([]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
    ]);
  });

  it("takes a filtered-out workspace out of its status group too", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        groupMode: "status",
        labels: { pinned: ["oss"], unpinned: ["work"] },
        labelFilters: { oss: "include" },
      }),
    );

    expect(projection.groups).toEqual([]);
  });

  it("drops a project the filter excludes, empty or not", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        projectFilters: ["project"],
        extraProjects: [makeProject([], "other")],
      }),
    );

    // "other" has no workspaces to hide, so only the project filter itself can take it away.
    expect(projection.pinnedGroups.unpinnedProjects.map((entry) => entry.viewKey)).toEqual([
      "project",
    ]);
  });

  it("keeps an empty project the filter allows, so its new-workspace row stays reachable", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        projectFilters: ["project", "other"],
        extraProjects: [makeProject([], "other")],
      }),
    );

    expect(projection.pinnedGroups.unpinnedProjects.map((entry) => entry.viewKey)).toEqual([
      "project",
      "other",
    ]);
  });

  it("keeps pinned chats out of label groups, same as status groups", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        groupMode: "label",
        knownLabels: ["oss"],
        labels: { pinned: ["oss"], unpinned: ["oss"] },
      }),
    );

    expect(projection.groups.map((group) => group.key)).toEqual(["label:oss"]);
    expect(projection.groups[0]?.rows.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
  });

  it("numbers a workspace once however many label groups it appears in", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        groupMode: "label",
        knownLabels: ["blocked", "oss"],
        labels: { unpinned: ["blocked", "oss"] },
      }),
    );

    expect(projection.groups.map((group) => group.key)).toEqual(["label:blocked", "label:oss"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
    expect(projection.shortcutModel.shortcutIndexByWorkspaceKey.get("srv:unpinned")).toBe(2);
  });

  it("takes a filtered-out workspace out of its label group too", () => {
    const projection = buildSidebarProjection(
      projectionInput({
        groupMode: "label",
        knownLabels: ["oss", "work"],
        labels: { pinned: ["oss"], unpinned: ["work"] },
        labelFilters: { oss: "include" },
      }),
    );

    expect(projection.groups).toEqual([]);
  });

  it("does not number a collapsed label group's rows", () => {
    const projection = buildSidebarProjection({
      ...projectionInput({
        groupMode: "label",
        knownLabels: ["oss"],
        labels: { unpinned: ["oss"] },
      }),
      collapsedLabelGroupKeys: new Set(["label:oss"]),
    });

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});
