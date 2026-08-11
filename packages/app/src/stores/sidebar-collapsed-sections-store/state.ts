import { z } from "zod";

export interface CollapsedProjectsState {
  collapsedProjectKeys: Set<string>;
  collapsedStatusGroupKeys: Set<string>;
  /**
   * Kept apart from the status keys rather than folded in with them. The two modes name their
   * groups independently, so collapsing "Done" would otherwise also collapse a label called
   * "done" — one gesture with two effects, only one of them visible.
   */
  collapsedLabelGroupKeys: Set<string>;
  collapsedPinned: boolean;
  /**
   * The label *filter* track above the list, not the label *groups* in it. The two are separate
   * sections that happen to be named after the same thing: `collapsedLabelGroupKeys` above is one
   * key per group when the list is grouped by label, this is the whole chip track, hidden from the
   * Tag button in the Workspaces header. Collapsed here means gone — there is no heading left.
   */
  collapsedLabelFilters: boolean;
}

export interface PersistedCollapsedProjects {
  collapsedProjectKeys?: string[];
  collapsedStatusGroupKeys?: string[];
  collapsedLabelGroupKeys?: string[];
  collapsedPinned?: boolean;
  collapsedLabelFilters?: boolean;
}

export const PersistedCollapsedProjectsSchema: z.ZodType<PersistedCollapsedProjects> =
  z.strictObject({
    collapsedProjectKeys: z.array(z.string()).optional(),
    collapsedStatusGroupKeys: z.array(z.string()).optional(),
    collapsedLabelGroupKeys: z.array(z.string()).optional(),
    collapsedPinned: z.boolean().optional(),
    collapsedLabelFilters: z.boolean().optional(),
  });

export function togglePinnedCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedPinned: !state.collapsedPinned };
}

export function toggleLabelFiltersCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedLabelFilters: !state.collapsedLabelFilters };
}

export function toggleProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
): CollapsedProjectsState {
  return { ...state, collapsedProjectKeys: toggleKey(state.collapsedProjectKeys, projectKey) };
}

export function toggleStatusGroupCollapsed(
  state: CollapsedProjectsState,
  statusGroupKey: string,
): CollapsedProjectsState {
  return {
    ...state,
    collapsedStatusGroupKeys: toggleKey(state.collapsedStatusGroupKeys, statusGroupKey),
  };
}

export function toggleLabelGroupCollapsed(
  state: CollapsedProjectsState,
  labelGroupKey: string,
): CollapsedProjectsState {
  return {
    ...state,
    collapsedLabelGroupKeys: toggleKey(state.collapsedLabelGroupKeys, labelGroupKey),
  };
}

function toggleKey(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

export function setProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
  collapsed: boolean,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (collapsed) {
    next.add(projectKey);
  } else {
    next.delete(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

export function serializeCollapsedProjects(state: CollapsedProjectsState): {
  collapsedProjectKeys: string[];
  collapsedStatusGroupKeys: string[];
  collapsedLabelGroupKeys: string[];
  collapsedPinned: boolean;
  collapsedLabelFilters: boolean;
} {
  return {
    collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
    collapsedStatusGroupKeys: Array.from(state.collapsedStatusGroupKeys),
    collapsedLabelGroupKeys: Array.from(state.collapsedLabelGroupKeys),
    collapsedPinned: state.collapsedPinned,
    collapsedLabelFilters: state.collapsedLabelFilters,
  };
}

export function mergePersistedCollapsedProjects<S extends CollapsedProjectsState>(
  persistedValue: unknown,
  current: S,
): S {
  const result = PersistedCollapsedProjectsSchema.safeParse(persistedValue);
  if (!result.success) {
    return current;
  }
  const persisted = result.data;
  const restoredProjects = deserializeCollapsedKeys(
    persisted.collapsedProjectKeys ?? Array.from(current.collapsedProjectKeys),
  );
  const restoredStatusGroups = deserializeCollapsedKeys(
    persisted.collapsedStatusGroupKeys ?? Array.from(current.collapsedStatusGroupKeys),
  );
  const restoredLabelGroups = deserializeCollapsedKeys(
    persisted.collapsedLabelGroupKeys ?? Array.from(current.collapsedLabelGroupKeys),
  );
  const restoredPinned = persisted.collapsedPinned ?? current.collapsedPinned;
  const restoredLabelFilters = persisted.collapsedLabelFilters ?? current.collapsedLabelFilters;
  if (
    areSetsEqual(current.collapsedProjectKeys, restoredProjects) &&
    areSetsEqual(current.collapsedStatusGroupKeys, restoredStatusGroups) &&
    areSetsEqual(current.collapsedLabelGroupKeys, restoredLabelGroups) &&
    current.collapsedPinned === restoredPinned &&
    current.collapsedLabelFilters === restoredLabelFilters
  ) {
    return current;
  }
  return {
    ...current,
    collapsedProjectKeys: restoredProjects,
    collapsedStatusGroupKeys: restoredStatusGroups,
    collapsedLabelGroupKeys: restoredLabelGroups,
    collapsedPinned: restoredPinned,
    collapsedLabelFilters: restoredLabelFilters,
  };
}

function deserializeCollapsedKeys(value: string[]): Set<string> {
  return new Set(value);
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left) {
    if (!right.has(key)) {
      return false;
    }
  }
  return true;
}
