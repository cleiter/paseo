import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { buildLabelSidebarGroups, UNLABELLED_GROUP_KEY } from "./sidebar-groups";

function ws(
  input: Partial<SidebarWorkspaceEntry> & { workspaceKey: string },
): SidebarWorkspaceEntry {
  return {
    serverId: input.serverId ?? "srv",
    workspaceId: input.workspaceId ?? input.workspaceKey.split(":")[1] ?? "ws",
    projectViewKey: input.projectViewKey ?? "proj",
    projectName: input.projectName ?? "Project",
    projectRootPath: input.projectRootPath,
    workspaceDirectory: input.workspaceDirectory ?? "",
    workspaceDirectoryLabel: input.workspaceDirectoryLabel ?? "",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? "main",
    title: input.title ?? null,
    labels: input.labels ?? [],
    currentBranch: input.currentBranch ?? null,
    statusBucket: input.statusBucket ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    workspaceKey: input.workspaceKey,
  };
}

const emptyProjectNames = new Map<string, string>();

function rowKeys(group: { rows: SidebarWorkspaceEntry[] }): string[] {
  return group.rows.map((row) => row.workspaceKey);
}

function build(input: { workspaces: SidebarWorkspaceEntry[]; knownLabels?: readonly string[] }) {
  return buildLabelSidebarGroups({
    workspaces: input.workspaces,
    knownLabels: input.knownLabels ?? [],
    projectNamesByViewKey: emptyProjectNames,
    unlabelledLabel: "Unlabeled",
  });
}

describe("buildLabelSidebarGroups", () => {
  it("puts a workspace under every label it carries", () => {
    const groups = build({
      workspaces: [ws({ workspaceKey: "srv:a", labels: ["blocked", "oss"] })],
      knownLabels: ["blocked", "oss"],
    });

    expect(groups.map((group) => group.label)).toEqual(["blocked", "oss"]);
    expect(groups.map(rowKeys)).toEqual([["srv:a"], ["srv:a"]]);
  });

  it("follows the known-label order and spelling rather than what a workspace typed", () => {
    const groups = build({
      workspaces: [
        ws({ workspaceKey: "srv:a", labels: ["OSS"] }),
        ws({ workspaceKey: "srv:b", labels: ["Blocked"] }),
      ],
      knownLabels: ["Blocked", "oss"],
    });

    expect(groups.map((group) => group.label)).toEqual(["Blocked", "oss"]);
  });

  it("sorts a label the known set has never heard of after the ones it has", () => {
    const groups = build({
      workspaces: [
        ws({ workspaceKey: "srv:a", labels: ["zeta"] }),
        ws({ workspaceKey: "srv:b", labels: ["apart"] }),
        ws({ workspaceKey: "srv:c", labels: ["known"] }),
      ],
      knownLabels: ["known"],
    });

    expect(groups.map((group) => group.label)).toEqual(["known", "apart", "zeta"]);
  });

  it("counts two spellings of one label as one group and one row", () => {
    const groups = build({
      workspaces: [ws({ workspaceKey: "srv:a", labels: ["Blocked", "blocked"] })],
      knownLabels: ["Blocked"],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.rows).toHaveLength(1);
  });

  it("collects workspaces carrying no label into a catch-all group, last", () => {
    const groups = build({
      workspaces: [
        ws({ workspaceKey: "srv:bare" }),
        ws({ workspaceKey: "srv:tagged", labels: ["oss"] }),
        ws({ workspaceKey: "srv:blank", labels: ["  "] }),
      ],
      knownLabels: ["oss"],
    });

    expect(groups.map((group) => group.key)).toEqual(["label:oss", UNLABELLED_GROUP_KEY]);
    expect(groups[1]?.label).toBe("Unlabeled");
    expect(groups[1]?.rows.map((row) => row.workspaceKey)).toEqual(["srv:bare", "srv:blank"]);
  });

  it("omits the catch-all when every workspace carries a label", () => {
    const groups = build({
      workspaces: [ws({ workspaceKey: "srv:a", labels: ["oss"] })],
      knownLabels: ["oss"],
    });

    expect(groups.map((group) => group.key)).toEqual(["label:oss"]);
  });

  it("omits labels nothing carries", () => {
    const groups = build({
      workspaces: [ws({ workspaceKey: "srv:a", labels: ["oss"] })],
      knownLabels: ["oss", "unused"],
    });

    expect(groups.map((group) => group.label)).toEqual(["oss"]);
  });

  it("keeps a label named like the catch-all in its own group", () => {
    const groups = build({
      workspaces: [
        ws({ workspaceKey: "srv:a", labels: ["unlabelled"] }),
        ws({ workspaceKey: "srv:b" }),
      ],
      knownLabels: ["unlabelled"],
    });

    expect(groups.map((group) => group.key)).toEqual(["label:unlabelled", UNLABELLED_GROUP_KEY]);
  });

  it("orders rows inside a group the way status mode orders them", () => {
    const groups = build({
      workspaces: [
        ws({
          workspaceKey: "srv:old",
          labels: ["oss"],
          statusEnteredAt: new Date("2026-01-01T00:00:00Z"),
        }),
        ws({ workspaceKey: "srv:none", labels: ["oss"], statusEnteredAt: null }),
        ws({
          workspaceKey: "srv:new",
          labels: ["oss"],
          statusEnteredAt: new Date("2026-06-01T00:00:00Z"),
        }),
      ],
      knownLabels: ["oss"],
    });

    expect(groups[0]?.rows.map((row) => row.workspaceKey)).toEqual([
      "srv:new",
      "srv:old",
      "srv:none",
    ]);
  });

  it("returns nothing for no workspaces", () => {
    expect(build({ workspaces: [], knownLabels: ["oss"] })).toEqual([]);
  });
});
