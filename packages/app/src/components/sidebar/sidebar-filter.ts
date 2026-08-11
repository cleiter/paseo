/**
 * Which workspaces survive the sidebar's filter, and — just as important — what it took away.
 *
 * The result carries the hidden count as well as what survived, because **the sidebar is the
 * notification surface**. A filter that removes rows removes notifications with them, so an agent
 * that starts asking a question while you are filtered elsewhere asks it into the void. Both
 * safety rails in the UI read off this return value rather than recounting: the persistent
 * `N hidden · Clear` rail, and the active workspace being drawn whether or not it matches.
 *
 * Pure on purpose. This repo has no jsdom component tests, so the rules have to live somewhere
 * they can be tested, and threading a filtered list plus a count through four components is worse
 * than one function that returns both.
 */

export type LabelFilterMode = "include" | "exclude";

/**
 * What two lit chips mean together: either of them, or both of them.
 *
 * One mode over the whole facet rather than a fourth state per chip. "Backend" and "in progress"
 * are two questions — an area and a state — and a chip that could be included, required, or
 * excluded is a control you decode rather than read, with every chip's meaning conditional on
 * every other chip.
 *
 * Only included labels. Exclude is "never these" in both modes, and still beats include.
 */
export type LabelMatchMode = "any" | "all";

export interface SidebarFilterWorkspace {
  workspaceKey: string;
  projectViewKey: string;
  labels: readonly string[];
}

export interface SidebarFilterResult {
  /** False when nothing is filtered, so callers can skip the work entirely. */
  isFiltering: boolean;
  visibleKeys: ReadonlySet<string>;
  /**
   * Empty means every project passes. A project with no workspaces left is dropped by the
   * projection either way; this is what keeps an empty one — which the sidebar keeps so its
   * "new workspace" row stays reachable — out of a filtered list.
   */
  includedProjectKeys: ReadonlySet<string>;
  hiddenCount: number;
  /** The active workspace is drawn even when it does not match — this says it happened. */
  activeWasExempted: boolean;
}

/** What the sidebar looks like when nothing has been filtered. */
export const NO_SIDEBAR_FILTER: SidebarFilterResult = {
  isFiltering: false,
  visibleKeys: new Set(),
  includedProjectKeys: new Set(),
  hiddenCount: 0,
  activeWasExempted: false,
};

/**
 * Include and exclude are not inverses, which is why both exist. They part company on a row with
 * no labels at all: an include filter hides it, an exclude filter keeps it. Every workspace starts
 * out with no labels, so that difference is the common case rather than an edge one.
 *
 * Exclude wins over include. A workspace carrying both an included and an excluded label is
 * hidden — the excluded label is the one you said you did not want to look at, and "I do not want
 * to see this" has to be the stronger statement or it cannot be relied on.
 *
 * The project filter is a plain allowlist over `SidebarProjectEntry.viewKey`, applied here rather
 * than beside the project list so that both facets produce one hidden count and one set of visible
 * keys. Status mode has no project sections to filter, and it still has to honour the choice.
 */
export function applySidebarFilter(input: {
  workspaces: readonly SidebarFilterWorkspace[];
  projectFilters: readonly string[];
  labelFilters: Readonly<Record<string, LabelFilterMode>>;
  labelMatch: LabelMatchMode;
  activeWorkspaceKey: string | null;
  /**
   * The row with a menu open, which outlives the filter it stops passing. Labels are assigned
   * from that menu, so the press that changes what a workspace matches arrives from inside the
   * row being matched.
   */
  openMenuWorkspaceKey?: string | null;
}): SidebarFilterResult {
  const { included, excluded } = splitLabelFilters(input.labelFilters);
  const includedProjectKeys = new Set(input.projectFilters);
  if (included.size === 0 && excluded.size === 0 && includedProjectKeys.size === 0) {
    return NO_SIDEBAR_FILTER;
  }

  const visibleKeys = new Set<string>();
  let hiddenCount = 0;
  let activeWasExempted = false;

  for (const workspace of input.workspaces) {
    const passes =
      (includedProjectKeys.size === 0 || includedProjectKeys.has(workspace.projectViewKey)) &&
      matchesLabelFilter(workspace.labels, included, excluded, input.labelMatch);
    if (passes) {
      visibleKeys.add(workspace.workspaceKey);
      continue;
    }
    // Covers workspace creation for free: a new worktree carries no labels, matches nothing, and
    // Paseo navigates straight into it. Without this you land on a workspace that is not in its
    // own sidebar.
    if (workspace.workspaceKey === input.activeWorkspaceKey) {
      visibleKeys.add(workspace.workspaceKey);
      activeWasExempted = true;
      continue;
    }
    // Unlabelling from the row's own menu is the case: the workspace stops matching the moment
    // you press, the row goes, and the menu goes with the anchor it was measured against — so
    // the second label costs a right-click the first one did not. The exemption ends when the
    // menu closes, which is when the row is no longer being worked on.
    if (workspace.workspaceKey === input.openMenuWorkspaceKey) {
      visibleKeys.add(workspace.workspaceKey);
      continue;
    }
    hiddenCount += 1;
  }

  return {
    isFiltering: true,
    visibleKeys,
    includedProjectKeys,
    hiddenCount,
    activeWasExempted,
  };
}

/**
 * Whether one workspace passes, without the counting around it.
 *
 * A row that is on screen while the filter is on and does not pass is an exempted one — the
 * active workspace, or the row you have a menu open on — because the projection took every other
 * non-matching row out. That is how a row knows to say it is outside the filter without being
 * told which row is which.
 */
export function matchesSidebarFilter(
  workspace: { labels: readonly string[]; projectViewKey: string },
  filters: {
    projectFilters: readonly string[];
    labelFilters: Readonly<Record<string, LabelFilterMode>>;
    labelMatch: LabelMatchMode;
  },
): boolean {
  if (
    filters.projectFilters.length > 0 &&
    !filters.projectFilters.includes(workspace.projectViewKey)
  ) {
    return false;
  }
  const { included, excluded } = splitLabelFilters(filters.labelFilters);
  return matchesLabelFilter(workspace.labels, included, excluded, filters.labelMatch);
}

/**
 * Which labels the filter controls offer, once the other facets have narrowed the sidebar.
 *
 * A label catalog is shared across every host and project, so the labels one context needs are
 * noise in another: filtered to one project, the chips for the labels nothing in it carries are a
 * row of controls that can only empty the list. With a host or project facet active, the picker
 * shows the labels the surviving workspaces actually carry.
 *
 * Two things keep that from removing a control out from under you. Nothing narrows when neither
 * facet is set — the full catalog is the point of a catalog, and a label you just invented has to
 * be pickable on a workspace that does not carry it yet. And a label that is already filtering
 * stays, however far out of scope it now is: dropping it would hide an active filter and leave the
 * list narrowed by something with nothing on screen to switch it off.
 *
 * Host scoping happens upstream — `useSidebarWorkspacesList` never emits workspaces from a host
 * that is filtered out — so `workspaces` is already host-scoped and only the project facet is
 * applied here. `hostFiltered` is what says a host facet is on, since its work is already done.
 */
export function selectFilterableLabels(input: {
  knownLabels: readonly string[];
  workspaces: readonly SidebarFilterWorkspace[];
  projectFilters: readonly string[];
  labelFilters: Readonly<Record<string, LabelFilterMode>>;
  hostFiltered: boolean;
}): readonly string[] {
  if (!input.hostFiltered && input.projectFilters.length === 0) return input.knownLabels;

  const projectScope = new Set(input.projectFilters);
  const inScope = new Set<string>();
  for (const workspace of input.workspaces) {
    if (projectScope.size > 0 && !projectScope.has(workspace.projectViewKey)) continue;
    for (const label of workspace.labels) inScope.add(label.trim().toLowerCase());
  }
  return input.knownLabels.filter((label) => {
    const key = label.trim().toLowerCase();
    return inScope.has(key) || input.labelFilters[key] != null;
  });
}

/**
 * How many of the labels on screen are filtering — what the collapsed Labels heading says.
 *
 * Counted against the known labels rather than over the filter map, because a filter can outlive
 * the label it names: deleting a label elsewhere leaves the entry behind until the store prunes it,
 * and a heading that counted it would report a chip that is not there.
 */
export function countActiveLabelFilters(
  knownLabels: readonly string[],
  labelFilters: Readonly<Record<string, LabelFilterMode>>,
): number {
  let count = 0;
  for (const label of knownLabels) {
    if (labelFilters[label.trim().toLowerCase()] != null) count += 1;
  }
  return count;
}

/**
 * The mode as it actually applies, which is `any` until two labels are included.
 *
 * With one included label the two modes produce the same list, so a switch flipped there has
 * changed nothing — and everything that reads the mode has to agree about that or it reports a
 * difference the sidebar cannot show: the pill would offer a decision with no effect, the summary
 * would describe a view in words its own filter contradicts, and Update would light up over an
 * arrangement that never moved.
 */
export function effectiveLabelMatch(
  labelFilters: Readonly<Record<string, LabelFilterMode>>,
  labelMatch: LabelMatchMode,
): LabelMatchMode {
  if (labelMatch !== "all") return "any";
  return countIncludedLabelFilters(labelFilters) >= 2 ? "all" : "any";
}

/** How many labels are lit, which is the same question as whether the mode can matter. */
export function countIncludedLabelFilters(
  labelFilters: Readonly<Record<string, LabelFilterMode>>,
): number {
  let count = 0;
  for (const mode of Object.values(labelFilters)) {
    if (mode === "include") count += 1;
  }
  return count;
}

function splitLabelFilters(labelFilters: Readonly<Record<string, LabelFilterMode>>): {
  included: Set<string>;
  excluded: Set<string>;
} {
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const [name, mode] of Object.entries(labelFilters)) {
    const key = name.trim().toLowerCase();
    if (key.length === 0) continue;
    (mode === "exclude" ? excluded : included).add(key);
  }
  return { included, excluded };
}

function matchesLabelFilter(
  labels: readonly string[],
  included: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  match: LabelMatchMode,
): boolean {
  // Every label is read before this can pass, rather than returning on the first hit: the excluded
  // check has to see them all, or a workspace carrying both an included and an excluded label would
  // survive on the strength of the one you asked for. The matches are a set because a workspace
  // spelling the same label twice must not count as two of the labels `all` requires.
  const matched = new Set<string>();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (excluded.has(key)) return false;
    if (included.has(key)) matched.add(key);
  }
  if (included.size === 0) return true;
  return match === "all" ? matched.size === included.size : matched.size > 0;
}
