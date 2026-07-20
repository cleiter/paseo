export interface CollapsedProjectsState {
  collapsedProjectKeys: Set<string>;
  collapsedStatusGroupKeys: Set<string>;
  // Sidebar groups (project groups and workspace groups), keyed by groupId. A
  // collapsed-set, so a brand new group starts expanded without needing a write.
  collapsedGroupKeys: Set<string>;
  collapsedPinned: boolean;
}

export interface PersistedCollapsedProjects {
  collapsedProjectKeys?: unknown;
  collapsedStatusGroupKeys?: unknown;
  collapsedGroupKeys?: unknown;
  collapsedPinned?: unknown;
}

export function togglePinnedCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedPinned: !state.collapsedPinned };
}

export function toggleProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (next.has(projectKey)) {
    next.delete(projectKey);
  } else {
    next.add(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

export function toggleStatusGroupCollapsed(
  state: CollapsedProjectsState,
  statusGroupKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedStatusGroupKeys);
  if (next.has(statusGroupKey)) {
    next.delete(statusGroupKey);
  } else {
    next.add(statusGroupKey);
  }
  return { ...state, collapsedStatusGroupKeys: next };
}

export function toggleGroupCollapsed(
  state: CollapsedProjectsState,
  groupId: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedGroupKeys);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  return { ...state, collapsedGroupKeys: next };
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
  collapsedGroupKeys: string[];
  collapsedPinned: boolean;
} {
  return {
    collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
    collapsedStatusGroupKeys: Array.from(state.collapsedStatusGroupKeys),
    collapsedGroupKeys: Array.from(state.collapsedGroupKeys),
    collapsedPinned: state.collapsedPinned,
  };
}

export function mergePersistedCollapsedProjects<S extends CollapsedProjectsState>(
  persisted: PersistedCollapsedProjects | undefined,
  current: S,
): S {
  if (
    !persisted?.collapsedProjectKeys &&
    !persisted?.collapsedStatusGroupKeys &&
    !persisted?.collapsedGroupKeys &&
    persisted?.collapsedPinned === undefined
  ) {
    return current;
  }
  const restoredProjects = deserializeCollapsedKeys(persisted.collapsedProjectKeys);
  const restoredStatusGroups = deserializeCollapsedKeys(persisted.collapsedStatusGroupKeys);
  const restoredGroups = deserializeCollapsedKeys(persisted.collapsedGroupKeys);
  const restoredPinned =
    typeof persisted.collapsedPinned === "boolean"
      ? persisted.collapsedPinned
      : current.collapsedPinned;
  if (
    areSetsEqual(current.collapsedProjectKeys, restoredProjects) &&
    areSetsEqual(current.collapsedStatusGroupKeys, restoredStatusGroups) &&
    areSetsEqual(current.collapsedGroupKeys, restoredGroups) &&
    current.collapsedPinned === restoredPinned
  ) {
    return current;
  }
  return {
    ...current,
    collapsedProjectKeys: restoredProjects,
    collapsedStatusGroupKeys: restoredStatusGroups,
    collapsedGroupKeys: restoredGroups,
    collapsedPinned: restoredPinned,
  };
}

function deserializeCollapsedKeys(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((key): key is string => typeof key === "string"));
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
