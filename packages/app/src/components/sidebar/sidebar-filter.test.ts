import { describe, expect, it } from "vitest";
import {
  applySidebarFilter,
  countActiveLabelFilters,
  effectiveLabelMatch,
  selectFilterableLabels,
  type LabelFilterMode,
  type LabelMatchMode,
  type SidebarFilterWorkspace,
} from "./sidebar-filter";

function workspace(
  workspaceKey: string,
  labels: readonly string[],
  projectViewKey = "alpha",
): SidebarFilterWorkspace {
  return { workspaceKey, projectViewKey, labels };
}

function filter(input: {
  workspaces: readonly SidebarFilterWorkspace[];
  projectFilters?: readonly string[];
  labelFilters?: Record<string, LabelFilterMode>;
  labelMatch?: LabelMatchMode;
  activeWorkspaceKey?: string | null;
  openMenuWorkspaceKey?: string | null;
}) {
  return applySidebarFilter({
    workspaces: input.workspaces,
    projectFilters: input.projectFilters ?? [],
    labelFilters: input.labelFilters ?? {},
    labelMatch: input.labelMatch ?? "any",
    activeWorkspaceKey: input.activeWorkspaceKey ?? null,
    openMenuWorkspaceKey: input.openMenuWorkspaceKey ?? null,
  });
}

const visible = (result: ReturnType<typeof filter>) => Array.from(result.visibleKeys).sort();

describe("applySidebarFilter", () => {
  it("says it is not filtering when no label has been picked", () => {
    const result = filter({ workspaces: [workspace("a", []), workspace("b", ["oss"])] });
    expect(result.isFiltering).toBe(false);
    expect(result.hiddenCount).toBe(0);
  });

  it("keeps only workspaces carrying an included label", () => {
    const result = filter({
      workspaces: [workspace("a", ["oss"]), workspace("b", ["work"])],
      labelFilters: { oss: "include" },
    });
    expect(visible(result)).toEqual(["a"]);
    expect(result.hiddenCount).toBe(1);
  });

  it("keeps a workspace carrying any one of several included labels", () => {
    const result = filter({
      workspaces: [workspace("a", ["oss"]), workspace("b", ["work"]), workspace("c", ["idle"])],
      labelFilters: { oss: "include", work: "include" },
    });
    expect(visible(result)).toEqual(["a", "b"]);
  });

  it("hides an unlabelled workspace under an include filter", () => {
    // The reason both rails exist: a workspace created while a filter is on carries no labels.
    const result = filter({ workspaces: [workspace("a", [])], labelFilters: { oss: "include" } });
    expect(visible(result)).toEqual([]);
    expect(result.hiddenCount).toBe(1);
  });

  it("keeps an unlabelled workspace under an exclude filter", () => {
    const result = filter({ workspaces: [workspace("a", [])], labelFilters: { oss: "exclude" } });
    expect(visible(result)).toEqual(["a"]);
  });

  it("lets exclude beat include on a workspace carrying both", () => {
    const result = filter({
      workspaces: [workspace("a", ["oss", "archived"])],
      labelFilters: { oss: "include", archived: "exclude" },
    });
    expect(visible(result)).toEqual([]);
  });

  it("matches labels however they are spelled", () => {
    const result = filter({
      workspaces: [workspace("a", ["Blocked"])],
      labelFilters: { BLOCKED: "include" },
    });
    expect(visible(result)).toEqual(["a"]);
  });

  it("draws the active workspace even when it does not match, and says so", () => {
    const result = filter({
      workspaces: [workspace("a", []), workspace("b", [])],
      labelFilters: { oss: "include" },
      activeWorkspaceKey: "a",
    });
    expect(visible(result)).toEqual(["a"]);
    expect(result.activeWasExempted).toBe(true);
    // The exempted workspace is not also counted as hidden — it is on screen.
    expect(result.hiddenCount).toBe(1);
  });

  // Unlabelling from the row's own menu: the press that stops the workspace matching comes from
  // inside the row, so without this the row goes and takes the open menu with it.
  it("draws the row with a menu open even when it does not match", () => {
    const result = filter({
      workspaces: [workspace("a", []), workspace("b", [])],
      labelFilters: { oss: "include" },
      openMenuWorkspaceKey: "a",
    });
    expect(visible(result)).toEqual(["a"]);
    expect(result.hiddenCount).toBe(1);
  });

  // It is the active workspace exemption that claims `activeWasExempted`, and a menu open on some
  // other row must not look like one.
  it("does not claim the active exemption for the row with a menu open", () => {
    const result = filter({
      workspaces: [workspace("a", [])],
      labelFilters: { oss: "include" },
      openMenuWorkspaceKey: "a",
    });
    expect(result.activeWasExempted).toBe(false);
  });

  it("hides the row again once its menu closes", () => {
    const result = filter({
      workspaces: [workspace("a", []), workspace("b", [])],
      labelFilters: { oss: "include" },
      openMenuWorkspaceKey: null,
    });
    expect(visible(result)).toEqual([]);
    expect(result.hiddenCount).toBe(2);
  });

  it("does not claim an exemption when the active workspace matched on its own", () => {
    const result = filter({
      workspaces: [workspace("a", ["oss"])],
      labelFilters: { oss: "include" },
      activeWorkspaceKey: "a",
    });
    expect(result.activeWasExempted).toBe(false);
  });

  it("keeps only workspaces in an allowed project", () => {
    const result = filter({
      workspaces: [
        workspace("a", [], "alpha"),
        workspace("b", [], "beta"),
        workspace("c", [], "alpha"),
      ],
      projectFilters: ["alpha"],
    });
    expect(visible(result)).toEqual(["a", "c"]);
    expect(result.hiddenCount).toBe(1);
    expect(result.includedProjectKeys.has("alpha")).toBe(true);
  });

  it("makes a workspace clear both facets, not either one", () => {
    const result = filter({
      workspaces: [
        workspace("a", ["oss"], "alpha"),
        workspace("b", ["oss"], "beta"),
        workspace("c", ["work"], "alpha"),
      ],
      projectFilters: ["alpha"],
      labelFilters: { oss: "include" },
    });
    expect(visible(result)).toEqual(["a"]);
  });

  it("exempts the active workspace from the project filter too", () => {
    const result = filter({
      workspaces: [workspace("a", [], "beta")],
      projectFilters: ["alpha"],
      activeWorkspaceKey: "a",
    });
    expect(visible(result)).toEqual(["a"]);
    expect(result.activeWasExempted).toBe(true);
    expect(result.hiddenCount).toBe(0);
  });

  it("ignores a filter entry whose name is blank", () => {
    const result = filter({ workspaces: [workspace("a", [])], labelFilters: { "   ": "include" } });
    expect(result.isFiltering).toBe(false);
  });
});

describe("countActiveLabelFilters", () => {
  it("counts included and excluded labels alike, matching case-insensitively", () => {
    expect(
      countActiveLabelFilters(["OSS", "Review", "Idle"], {
        oss: "include",
        review: "exclude",
      }),
    ).toBe(2);
  });

  it("ignores a filter for a label that is no longer known", () => {
    expect(countActiveLabelFilters(["OSS"], { oss: "include", deleted: "exclude" })).toBe(1);
  });

  it("is zero when nothing is filtering", () => {
    expect(countActiveLabelFilters(["OSS"], {})).toBe(0);
  });
});

describe("selectFilterableLabels", () => {
  const knownLabels = ["oss", "company", "review"];

  function labels(input: {
    workspaces?: readonly SidebarFilterWorkspace[];
    projectFilters?: readonly string[];
    labelFilters?: Record<string, LabelFilterMode>;
    hostFiltered?: boolean;
  }): readonly string[] {
    return selectFilterableLabels({
      knownLabels,
      workspaces: input.workspaces ?? [],
      projectFilters: input.projectFilters ?? [],
      labelFilters: input.labelFilters ?? {},
      hostFiltered: input.hostFiltered ?? false,
    });
  }

  it("offers the whole catalog while no other facet is set", () => {
    expect(labels({ workspaces: [workspace("a", ["oss"])] })).toEqual(knownLabels);
  });

  it("offers only the labels the filtered project's workspaces carry", () => {
    expect(
      labels({
        workspaces: [workspace("a", ["oss"], "paseo"), workspace("b", ["company"], "work")],
        projectFilters: ["paseo"],
      }),
    ).toEqual(["oss"]);
  });

  it("narrows to what the remaining hosts carry when only a host facet is set", () => {
    // The host facet is applied upstream, so the workspaces handed in are already its result.
    expect(labels({ workspaces: [workspace("a", ["oss"])], hostFiltered: true })).toEqual(["oss"]);
  });

  it("keeps a label that is already filtering, however far out of scope it is", () => {
    expect(
      labels({
        workspaces: [workspace("a", ["oss"], "paseo")],
        projectFilters: ["paseo"],
        labelFilters: { company: "exclude" },
      }),
    ).toEqual(["oss", "company"]);
  });

  it("matches labels case-insensitively", () => {
    expect(
      labels({
        workspaces: [workspace("a", ["OSS"], "paseo")],
        projectFilters: ["paseo"],
      }),
    ).toEqual(["oss"]);
  });

  it("offers nothing when the scope carries no labels at all", () => {
    expect(
      labels({ workspaces: [workspace("a", [], "paseo")], projectFilters: ["paseo"] }),
    ).toEqual([]);
  });
});

describe("matching all included labels", () => {
  const workspaces = [
    workspace("both", ["backend", "in progress"]),
    workspace("backend", ["backend"]),
    workspace("progress", ["in progress"]),
    workspace("none", []),
  ];

  it("widens with any and narrows to the intersection with all", () => {
    const labelFilters: Record<string, LabelFilterMode> = {
      backend: "include",
      "in progress": "include",
    };

    expect(visible(filter({ workspaces, labelFilters }))).toEqual(["backend", "both", "progress"]);
    expect(visible(filter({ workspaces, labelFilters, labelMatch: "all" }))).toEqual(["both"]);
  });

  it("counts what all took away, so the rail can offer it back", () => {
    const result = filter({
      workspaces,
      labelFilters: { backend: "include", "in progress": "include" },
      labelMatch: "all",
    });

    expect(result.isFiltering).toBe(true);
    expect(result.hiddenCount).toBe(3);
  });

  // The unlabelled row is where include and exclude part company, and all must not change that.
  it("still hides a workspace carrying none of them", () => {
    expect(
      visible(
        filter({
          workspaces: [workspace("none", [])],
          labelFilters: { backend: "include" },
          labelMatch: "all",
        }),
      ),
    ).toEqual([]);
  });

  it("keeps exclude beating include", () => {
    expect(
      visible(
        filter({
          workspaces: [workspace("both", ["backend", "in progress", "archived"])],
          labelFilters: {
            backend: "include",
            "in progress": "include",
            archived: "exclude",
          },
          labelMatch: "all",
        }),
      ),
    ).toEqual([]);
  });

  // A workspace should not satisfy two required labels by carrying one of them twice.
  it("does not count a repeated label twice", () => {
    expect(
      visible(
        filter({
          workspaces: [workspace("dupe", ["backend", "Backend"])],
          labelFilters: { backend: "include", "in progress": "include" },
          labelMatch: "all",
        }),
      ),
    ).toEqual([]);
  });
});

describe("effectiveLabelMatch", () => {
  // Under two labels the modes agree, and everything that reads the mode has to agree with them.
  it("is any until two labels are included", () => {
    expect(effectiveLabelMatch({}, "all")).toBe("any");
    expect(effectiveLabelMatch({ backend: "include" }, "all")).toBe("any");
    expect(effectiveLabelMatch({ backend: "include", archived: "exclude" }, "all")).toBe("any");
    expect(effectiveLabelMatch({ backend: "include", review: "include" }, "all")).toBe("all");
  });

  it("is any whenever the mode is any", () => {
    expect(effectiveLabelMatch({ backend: "include", review: "include" }, "any")).toBe("any");
  });
});
