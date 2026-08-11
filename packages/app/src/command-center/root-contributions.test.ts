import { describe, expect, it } from "vitest";
import { SIDEBAR_GROUP_MODES } from "@/components/sidebar/grouping-labels";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { CommandCenterIconProps } from "./contributions";
import { buildGroupingContributions, type GroupingCommandCenterSource } from "./root-contributions";

function ProjectIcon(_props: CommandCenterIconProps) {
  return null;
}

function StatusIcon(_props: CommandCenterIconProps) {
  return null;
}

function LabelIcon(_props: CommandCenterIconProps) {
  return null;
}

function source(groupMode: SidebarGroupMode): {
  value: GroupingCommandCenterSource;
  applied: SidebarGroupMode[];
} {
  const applied: SidebarGroupMode[] = [];
  return {
    value: {
      groupMode,
      sectionTitle: "Actions",
      labels: {
        project: "Group by project",
        status: "Group by status",
        label: "Group by label",
      },
      icons: { project: ProjectIcon, status: StatusIcon, label: LabelIcon },
      setGroupMode: (mode) => applied.push(mode),
    },
    applied,
  };
}

describe("grouping command center contributions", () => {
  it("offers status and label while grouped by project", () => {
    const fixture = source("project");
    const contributions = buildGroupingContributions(fixture.value);

    expect(contributions.map((entry) => entry.presentation)).toMatchObject([
      { title: "Group by status", icon: StatusIcon },
      { title: "Group by label", icon: LabelIcon },
    ]);

    for (const contribution of contributions) {
      contribution.run();
    }
    expect(fixture.applied).toEqual(["status", "label"]);
  });

  it("offers project and label while grouped by status", () => {
    const fixture = source("status");
    const contributions = buildGroupingContributions(fixture.value);

    expect(contributions.map((entry) => entry.presentation)).toMatchObject([
      { title: "Group by project", icon: ProjectIcon },
      { title: "Group by label", icon: LabelIcon },
    ]);

    for (const contribution of contributions) {
      contribution.run();
    }
    expect(fixture.applied).toEqual(["project", "label"]);
  });

  it("offers project and status while grouped by label", () => {
    const fixture = source("label");
    const contributions = buildGroupingContributions(fixture.value);

    expect(contributions.map((entry) => entry.presentation)).toMatchObject([
      { title: "Group by project", icon: ProjectIcon },
      { title: "Group by status", icon: StatusIcon },
    ]);

    for (const contribution of contributions) {
      contribution.run();
    }
    expect(fixture.applied).toEqual(["project", "status"]);
  });

  // The entry you are already in would be a no-op that still costs a row and a keystroke.
  it("never offers the mode you are in", () => {
    for (const mode of SIDEBAR_GROUP_MODES) {
      const contributions = buildGroupingContributions(source(mode).value);
      expect(contributions).toHaveLength(SIDEBAR_GROUP_MODES.length - 1);
      expect(contributions.map((entry) => entry.id)).not.toContain(`sidebar-grouping-${mode}`);
    }
  });

  it("names each entry after its target so the id never moves with the current mode", () => {
    expect(buildGroupingContributions(source("project").value).map((entry) => entry.id)).toEqual([
      "sidebar-grouping-status",
      "sidebar-grouping-label",
    ]);
    expect(buildGroupingContributions(source("label").value).map((entry) => entry.id)).toEqual([
      "sidebar-grouping-project",
      "sidebar-grouping-status",
    ]);
  });

  it("stays out of the default empty-query list", () => {
    for (const mode of SIDEBAR_GROUP_MODES) {
      for (const contribution of buildGroupingContributions(source(mode).value)) {
        expect(contribution.visibility).toBe("query");
        expect(contribution.group).toBe("actions");
      }
    }
  });

  // Equal ranks sort by id, which would put label first in every mode. The offset is what keeps
  // the palette in the same order as the display menu and the saved-view editor.
  it("ranks the entries in the order every other grouping surface uses", () => {
    // 6 is keyboard-shortcuts and 7 belongs to the workspace actions in #3013.
    expect(buildGroupingContributions(source("project").value).map((entry) => entry.rank)).toEqual([
      8, 9,
    ]);
  });
});
