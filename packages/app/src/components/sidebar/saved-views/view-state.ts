import {
  effectiveLabelMatch,
  type LabelFilterMode,
  type LabelMatchMode,
} from "@/components/sidebar/sidebar-filter";
import type { SavedSidebarView, SidebarGroupMode } from "@/stores/sidebar-view-store";

/** The part of the sidebar's state a view captures, and the only part it can be compared against. */
export interface SidebarViewArrangement {
  /** Null only on a view, where it means the view makes no claim about the grouping. */
  groupMode: SidebarGroupMode | null;
  hostFilters: readonly string[];
  projectFilters: readonly string[];
  labelFilters: Readonly<Record<string, LabelFilterMode>>;
  /** Whether the included labels are read as either-of or all-of. */
  labelMatch: LabelMatchMode;
}

/**
 * The words the summary is built from. Passed in rather than imported so this module stays pure
 * and testable — the same reason the filter itself lives in a module and not in a component.
 */
export interface SavedViewSummaryLabels {
  includes(names: string): string;
  /** The same list read as an intersection — see `LabelMatchMode`. */
  includesAll(names: string): string;
  excludes(names: string): string;
  projects(count: number): string;
  hosts(count: number): string;
  grouping(mode: SidebarGroupMode): string;
  /** A view that filters nothing and only sets a grouping still has to describe itself. */
  everything: string;
}

/**
 * What a view will do, in one line, so it can be read before it is applied.
 *
 * A list of names alone makes every view look alike — you find out what "Review" meant by applying
 * it and watching the sidebar change, which is the thing a saved view is supposed to save you
 * from. Labels come first because they are what these views are mostly made of, and the grouping
 * comes last because it rearranges the list rather than narrowing it.
 *
 * Projects and hosts are counted, not named. Their names are paths and machine names, long enough
 * that two of them would be the whole line, and unlike a label they are not what you named the
 * view after.
 */
export function summarizeSavedView(
  view: SidebarViewArrangement,
  labels: SavedViewSummaryLabels,
): string {
  const parts: string[] = [];
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [name, mode] of Object.entries(view.labelFilters)) {
    (mode === "include" ? included : excluded).push(name);
  }
  if (included.length > 0) {
    const names = included.join(", ");
    // The effective mode, not the stored one: a view holding "all" with a single label filters
    // exactly like "any", and a summary that said otherwise would describe a list nobody gets.
    const all = effectiveLabelMatch(view.labelFilters, view.labelMatch) === "all";
    parts.push(all ? labels.includesAll(names) : labels.includes(names));
  }
  if (excluded.length > 0) parts.push(labels.excludes(excluded.join(", ")));
  if (view.projectFilters.length > 0) parts.push(labels.projects(view.projectFilters.length));
  if (view.hostFilters.length > 0) parts.push(labels.hosts(view.hostFilters.length));
  if (parts.length === 0) parts.push(labels.everything);
  if (view.groupMode !== null) parts.push(labels.grouping(view.groupMode));
  return parts.join(" · ");
}

/**
 * Whether the sidebar still shows what the view says it shows.
 *
 * Derived rather than stored. A flag set when a filter moves has to be cleared everywhere the
 * arrangement can come back to matching — including the user undoing their own edit one chip at a
 * time — and every place that forgets is a view that claims to be edited forever.
 *
 * Filter order is not part of a view: the arrays are built by toggling rows, so the same two hosts
 * arrive in whichever order they were pressed.
 */
export function savedViewMatchesArrangement(
  view: SidebarViewArrangement,
  current: SidebarViewArrangement,
): boolean {
  return (
    // A view that leaves the grouping alone cannot be out of step with it.
    (view.groupMode === null || view.groupMode === current.groupMode) &&
    sameKeys(view.hostFilters, current.hostFilters) &&
    sameKeys(view.projectFilters, current.projectFilters) &&
    sameModes(view.labelFilters, current.labelFilters) &&
    // Compared as it applies rather than as it is stored, so flipping a switch that cannot change
    // the list — fewer than two labels lit — does not mark the view edited.
    effectiveLabelMatch(view.labelFilters, view.labelMatch) ===
      effectiveLabelMatch(current.labelFilters, current.labelMatch)
  );
}

/**
 * The views in the order they are listed: by name, ignoring case.
 *
 * The store keeps them in the order they were saved, which is the order you happened to think of
 * them in and tells a reader nothing. Sorting for display rather than in the store keeps the two
 * apart — nothing else about a view depends on where it sits in the list.
 */
export function sortSavedViewsByName(views: readonly SavedSidebarView[]): SavedSidebarView[] {
  return [...views].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

/** The view you are in, and whether you have since edited it. */
export function resolveActiveSavedView(input: {
  savedViews: readonly SavedSidebarView[];
  activeSavedViewId: string | null;
  current: SidebarViewArrangement;
}): { view: SavedSidebarView; edited: boolean } | null {
  const view = input.savedViews.find((entry) => entry.id === input.activeSavedViewId);
  if (!view) return null;
  return { view, edited: !savedViewMatchesArrangement(view, input.current) };
}

/** What the header's view switcher draws, decided from state rather than in the component. */
export interface SidebarViewSwitcherState {
  /** False hides the control outright — see the rule in `describeSidebarViewSwitcher`. */
  visible: boolean;
  /** The view you are in, or null for "no view". */
  activeView: SavedSidebarView | null;
  /** Whether the sidebar has moved off that view: the dot on the heading, and the Update row. */
  edited: boolean;
  /** Whether there is an arrangement worth naming, which is what Save is for. */
  canSave: boolean;
  /** Whether there is anything for the reset row to undo. */
  canReset: boolean;
  /** The views to list, in display order. */
  views: SavedSidebarView[];
}

/**
 * The switcher, from the state it reads.
 *
 * **It appears with the first view or the first filter, and not before.** A sidebar showing
 * everything, to someone who has never saved a view, has nothing for this control to say — it would
 * cost header space to report that you are not using the feature. Filtering is the other trigger
 * because it is the moment naming an arrangement means something, and the switcher owns saving:
 * hiding it until a view exists would leave no way to make the first one.
 *
 * An active id with no view behind it — a deleted view, or state restored from an older build — is
 * no view at all, not a broken one.
 *
 * Reset is offered while a view is applied or a filter is set, because those are the two ways the
 * sidebar is showing you less than everything. It is left out otherwise so the menu never offers to
 * undo nothing.
 */
export function describeSidebarViewSwitcher(input: {
  savedViews: readonly SavedSidebarView[];
  activeSavedViewId: string | null;
  current: SidebarViewArrangement;
  hasFilters: boolean;
}): SidebarViewSwitcherState {
  const active = resolveActiveSavedView({
    savedViews: input.savedViews,
    activeSavedViewId: input.activeSavedViewId,
    current: input.current,
  });
  return {
    visible: input.savedViews.length > 0 || input.hasFilters,
    activeView: active?.view ?? null,
    edited: active?.edited ?? false,
    canSave: input.hasFilters,
    canReset: active !== null || input.hasFilters,
    views: sortSavedViewsByName(input.savedViews),
  };
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every((key) => seen.has(key));
}

function sameModes(
  left: Readonly<Record<string, LabelFilterMode>>,
  right: Readonly<Record<string, LabelFilterMode>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
