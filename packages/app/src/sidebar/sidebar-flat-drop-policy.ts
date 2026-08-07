import { isDraggableRow, type SidebarFlatRow } from "./sidebar-flat-rows";

// What a drop MEANS, as a pure function of the rows and two indices.
//
// Every drag bug this feature has shipped was a policy bug — previewing on a target that
// then moved, treating a drop on nothing as an abort, an insert that could only ever land
// above its target. None of them were visible to a test, because the policy lived inside
// dnd-kit event handlers, tangled up with sensors and rects and transforms.
//
// It lives here instead: one flat array, two indices, one intent. The platforms agree
// because there is nothing left for them to disagree about.
//
// `to` is an INSERTION INDEX into the rows with the dragged row removed, which is what
// both platforms mean by it: `arrayMove(rows, from, to)` puts the dragged row at `to`.
//
// The row ABOVE decides. After the move, whatever sits above the dragged row names the
// list it joined and the position it took — which is also how an empty group is
// addressable at all, since it has no rows to drop between.

export type SidebarDropIntent =
  | { kind: "none" }
  | { kind: "reorder-pinned"; orderedVisibleKeys: string[] }
  | {
      kind: "move-workspace";
      projectKey: string;
      workspaceKey: string;
      groupId: string | null;
      beforeKey: string | null;
      after: boolean;
      visibleKeys: string[];
    }
  | {
      kind: "move-project";
      projectKey: string;
      groupId: string | null;
      beforeKey: string | null;
      after: boolean;
      visibleKeys: string[];
    }
  | { kind: "reorder-workspace-groups"; projectKey: string; orderedIds: string[] }
  | { kind: "reorder-project-groups"; orderedIds: string[] };

const NONE: SidebarDropIntent = { kind: "none" };

export function interpretSidebarDrop(
  rows: readonly SidebarFlatRow[],
  from: number,
  to: number,
): SidebarDropIntent {
  const active = rows[from];
  if (!active || !isDraggableRow(active)) {
    return NONE;
  }
  // A row put back where it came from is the one drop that means nothing. Everything else
  // that survives `validSlots` is a real edit — which is what lets the native list treat
  // the gap it opens as the drop, with no rejected drops to strand a translate.
  if (to === from || to < 0 || to >= rows.length) {
    return NONE;
  }

  return interpretDrop(
    rows,
    rows.filter((_, index) => index !== from),
    active,
    to,
  );
}

// The single source of drop validity, shared by both platforms: web disables every other
// row as a droppable, and the native list snaps its spacer into this set so the gap can
// only ever open where the drop will actually land.
export function validSlots(rows: readonly SidebarFlatRow[], from: number): number[] {
  const active = rows[from];
  if (!active || !isDraggableRow(active)) {
    return [];
  }
  const remaining = rows.filter((_, index) => index !== from);
  const slots: number[] = [];
  for (let to = 0; to < rows.length; to += 1) {
    if (to === from || interpretDrop(rows, remaining, active, to).kind !== "none") {
      slots.push(to);
    }
  }
  return slots;
}

function interpretDrop(
  rows: readonly SidebarFlatRow[],
  remaining: readonly SidebarFlatRow[],
  active: SidebarFlatRow,
  to: number,
): SidebarDropIntent {
  switch (active.kind) {
    case "pinned-workspace":
      return interpretPinnedDrop(remaining, to, active.workspace.workspaceKey);
    case "workspace":
      return interpretWorkspaceDrop(remaining, to, active);
    case "workspace-group-header":
      return interpretWorkspaceGroupDrop(remaining, to, active);
    case "project-header":
      return interpretProjectDrop(rows, remaining, to, active);
    case "project-group-header":
      return interpretProjectGroupDrop(remaining, to, active);
    default:
      return NONE;
  }
}

// Called from a worklet on every frame of a native drag, so it stays a plain numeric
// search over a sorted array and allocates nothing.
export function snapToValidSlot(slots: readonly number[], index: number): number {
  "worklet";
  if (slots.length === 0) {
    return index;
  }
  let best = slots[0];
  let bestDistance = Math.abs(best - index);
  for (let i = 1; i < slots.length; i += 1) {
    const distance = Math.abs(slots[i] - index);
    if (distance < bestDistance) {
      best = slots[i];
      bestDistance = distance;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pinned
// ---------------------------------------------------------------------------

function interpretPinnedDrop(
  remaining: readonly SidebarFlatRow[],
  to: number,
  workspaceKey: string,
): SidebarDropIntent {
  const above = to > 0 ? remaining[to - 1] : null;
  if (!above) {
    return NONE;
  }
  const inPinned =
    above.kind === "pinned-header" ||
    above.kind === "pinned-workspace" ||
    (above.kind === "show-more" && above.containerKey === "pinned:header");
  if (!inPinned) {
    return NONE;
  }

  const keys: string[] = [];
  let position = 0;
  remaining.forEach((row, index) => {
    if (row.kind !== "pinned-workspace") {
      return;
    }
    if (index < to) {
      position = keys.length + 1;
    }
    keys.push(row.workspace.workspaceKey);
  });

  return {
    kind: "reorder-pinned",
    orderedVisibleKeys: [...keys.slice(0, position), workspaceKey, ...keys.slice(position)],
  };
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

interface WorkspaceSection {
  projectKey: string;
  groupId: string | null;
  sectionKey: string;
}

function interpretWorkspaceDrop(
  remaining: readonly SidebarFlatRow[],
  to: number,
  active: SidebarFlatRow & { kind: "workspace" },
): SidebarDropIntent {
  const section = resolveWorkspaceSection(remaining, to);
  // Clamped to its own project. A workspace group belongs to exactly one project, so a
  // row that crossed into another one would have to be re-homed as well as re-grouped.
  if (!section || section.projectKey !== active.projectKey) {
    return NONE;
  }

  const placement = placeInSection(remaining, to, section.sectionKey, (row) =>
    row.kind === "workspace" ? row.workspace.workspaceKey : null,
  );

  return {
    kind: "move-workspace",
    projectKey: section.projectKey,
    workspaceKey: active.workspace.workspaceKey,
    groupId: section.groupId,
    beforeKey: placement.beforeKey,
    after: placement.after,
    visibleKeys: [
      ...placement.keys.slice(0, placement.position),
      active.workspace.workspaceKey,
      ...placement.keys.slice(placement.position),
    ],
  };
}

function resolveWorkspaceSection(
  remaining: readonly SidebarFlatRow[],
  to: number,
): WorkspaceSection | null {
  for (let index = to - 1; index >= 0; index -= 1) {
    const row = remaining[index];
    switch (row.kind) {
      case "workspace":
        return {
          projectKey: row.projectKey,
          groupId: row.groupId,
          sectionKey: row.containerKey ?? "",
        };
      case "workspace-group-header":
        return { projectKey: row.projectKey, groupId: row.group.groupId, sectionKey: row.key };
      case "workspace-remainder-header":
        return { projectKey: row.projectKey, groupId: null, sectionKey: row.key };
      case "project-header":
        // Only a project with no groups at all hangs its workspaces straight off its
        // header. With groups, the space between the header and the first group belongs
        // to no list, so nothing can be dropped into it.
        if (row.project.workspaceGroups.length > 0) {
          return null;
        }
        return { projectKey: row.project.viewKey, groupId: null, sectionKey: row.key };
      case "show-more":
        // Part of the section above it; keep looking for what that section is.
        continue;
      default:
        return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Workspace groups
// ---------------------------------------------------------------------------

function interpretWorkspaceGroupDrop(
  remaining: readonly SidebarFlatRow[],
  to: number,
  active: SidebarFlatRow & { kind: "workspace-group-header" },
): SidebarDropIntent {
  const parentKey = active.containerKey;
  if (!parentKey) {
    return NONE;
  }
  const isSibling = (row: SidebarFlatRow) =>
    row.kind === "workspace-group-header" && row.containerKey === parentKey;

  if (!isBlockBoundary(remaining, to, parentKey, isSibling)) {
    return NONE;
  }

  const ids: string[] = [];
  let position = 0;
  remaining.forEach((row, index) => {
    if (!isSibling(row) || row.kind !== "workspace-group-header") {
      return;
    }
    if (index < to) {
      position = ids.length + 1;
    }
    ids.push(row.group.groupId);
  });

  return {
    kind: "reorder-workspace-groups",
    projectKey: active.projectKey,
    orderedIds: [...ids.slice(0, position), active.group.groupId, ...ids.slice(position)],
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function interpretProjectDrop(
  rows: readonly SidebarFlatRow[],
  remaining: readonly SidebarFlatRow[],
  to: number,
  active: SidebarFlatRow & { kind: "project-header" },
): SidebarDropIntent {
  // A project block owns everything under it, so a slot inside one is a slot inside
  // another project — never a place a project can go.
  const next = remaining[to];
  if (next && hasAncestorOfKind(remaining, next, "project-header")) {
    return NONE;
  }

  const target = resolveProjectContainer(rows, remaining, to);
  if (!target) {
    return NONE;
  }

  const placement = placeInSection(remaining, to, target.sectionKey, (row) =>
    row.kind === "project-header" ? row.project.viewKey : null,
  );

  return {
    kind: "move-project",
    projectKey: active.project.viewKey,
    groupId: target.groupId,
    beforeKey: placement.beforeKey,
    after: placement.after,
    visibleKeys: [
      ...placement.keys.slice(0, placement.position),
      active.project.viewKey,
      ...placement.keys.slice(placement.position),
    ],
  };
}

function resolveProjectContainer(
  rows: readonly SidebarFlatRow[],
  remaining: readonly SidebarFlatRow[],
  to: number,
): { groupId: string | null; sectionKey: string } | null {
  for (let index = to - 1; index >= 0; index -= 1) {
    const row = remaining[index];
    switch (row.kind) {
      case "project-header":
        return {
          groupId: projectGroupIdOfContainer(row.containerKey),
          sectionKey: row.containerKey ?? "",
        };
      case "project-group-header":
        return { groupId: row.group.groupId, sectionKey: row.key };
      case "ungrouped-projects-header":
        return { groupId: null, sectionKey: row.key };
      // Inside a project block, or a section's toggle: keep walking up to the row that
      // says which list we are in.
      case "workspace":
      case "workspace-group-header":
      case "workspace-remainder-header":
      case "new-workspace-ghost":
      case "show-more":
        continue;
      default:
        // Above every project-level container. Only the ungrouped shape — no groups and
        // no remainder header — has a list up here to join.
        return hasProjectLevelContainer(rows) ? null : { groupId: null, sectionKey: "" };
    }
  }
  return hasProjectLevelContainer(rows) ? null : { groupId: null, sectionKey: "" };
}

function projectGroupIdOfContainer(containerKey: string | null): string | null {
  if (containerKey && containerKey.startsWith("pgroup:")) {
    return containerKey.slice("pgroup:".length);
  }
  return null;
}

function hasProjectLevelContainer(rows: readonly SidebarFlatRow[]): boolean {
  return rows.some(
    (row) => row.kind === "project-group-header" || row.kind === "ungrouped-projects-header",
  );
}

// ---------------------------------------------------------------------------
// Project groups
// ---------------------------------------------------------------------------

function interpretProjectGroupDrop(
  remaining: readonly SidebarFlatRow[],
  to: number,
  active: SidebarFlatRow & { kind: "project-group-header" },
): SidebarDropIntent {
  const isSibling = (row: SidebarFlatRow) => row.kind === "project-group-header";
  if (!isBlockBoundary(remaining, to, null, isSibling)) {
    return NONE;
  }

  const ids: string[] = [];
  let position = 0;
  remaining.forEach((row, index) => {
    if (row.kind !== "project-group-header") {
      return;
    }
    if (index < to) {
      position = ids.length + 1;
    }
    ids.push(row.group.groupId);
  });
  if (ids.length === 0) {
    return NONE;
  }

  return {
    kind: "reorder-project-groups",
    orderedIds: [...ids.slice(0, position), active.group.groupId, ...ids.slice(position)],
  };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

interface Placement {
  keys: string[];
  position: number;
  beforeKey: string | null;
  after: boolean;
}

// Where the dragged row lands inside ONE list, expressed both ways: as the list's new
// visible order (what the document adopts) and as a row plus a side (what positions it
// against rows the document already holds).
function placeInSection(
  remaining: readonly SidebarFlatRow[],
  to: number,
  sectionKey: string,
  keyOf: (row: SidebarFlatRow) => string | null,
): Placement {
  const keys: string[] = [];
  let position = 0;
  remaining.forEach((row, index) => {
    if ((row.containerKey ?? "") !== sectionKey) {
      return;
    }
    const key = keyOf(row);
    if (key === null) {
      return;
    }
    if (index < to) {
      position = keys.length + 1;
    }
    keys.push(key);
  });

  if (position > 0) {
    return { keys, position, beforeKey: keys[position - 1] ?? null, after: true };
  }
  // First in the list. Anchoring to the row it displaces keeps the position addressable
  // even when the document has never seen this list; an empty list has nothing to anchor
  // to and appends, which for an empty list is the same slot.
  return { keys, position, beforeKey: keys.length > 0 ? keys[0] : null, after: false };
}

// A container travels as one row, so it may only land where a block starts or where its
// parent's run of blocks ends — never between another block's header and its rows.
function isBlockBoundary(
  remaining: readonly SidebarFlatRow[],
  to: number,
  parentKey: string | null,
  isSibling: (row: SidebarFlatRow) => boolean,
): boolean {
  const siblingIndices: number[] = [];
  remaining.forEach((row, index) => {
    if (isSibling(row)) {
      siblingIndices.push(index);
    }
  });
  if (siblingIndices.length === 0) {
    return false;
  }

  const first = siblingIndices[0];
  const last = siblingIndices[siblingIndices.length - 1];
  const runEnd = subtreeEnd(remaining, last);
  if (to < first || to > runEnd) {
    return false;
  }
  if (to === runEnd) {
    return true;
  }
  const next = remaining[to];
  if (!next || !isSibling(next)) {
    return false;
  }
  return parentKey === null || next.containerKey === parentKey;
}

function subtreeEnd(rows: readonly SidebarFlatRow[], index: number): number {
  const containers = containerMap(rows);
  const key = rows[index]?.key;
  if (!key) {
    return index + 1;
  }
  let end = index + 1;
  while (end < rows.length && hasAncestorKey(containers, rows[end], key)) {
    end += 1;
  }
  return end;
}

// validSlots asks the same array about every index in it, so the key lookup is built once
// per array rather than once per question. Without this the slot scan is cubic in the row
// count and shows up as a stall on the lift.
const rowsByKeyCache = new WeakMap<object, Map<string, SidebarFlatRow>>();

function containerMap(rows: readonly SidebarFlatRow[]): Map<string, SidebarFlatRow> {
  const cached = rowsByKeyCache.get(rows);
  if (cached) {
    return cached;
  }
  const byKey = new Map<string, SidebarFlatRow>();
  for (const row of rows) {
    byKey.set(row.key, row);
  }
  rowsByKeyCache.set(rows, byKey);
  return byKey;
}

function hasAncestorKey(
  byKey: ReadonlyMap<string, SidebarFlatRow>,
  row: SidebarFlatRow,
  ancestorKey: string,
): boolean {
  let current = row.containerKey;
  while (current) {
    if (current === ancestorKey) {
      return true;
    }
    current = byKey.get(current)?.containerKey ?? null;
  }
  return false;
}

function hasAncestorOfKind(
  rows: readonly SidebarFlatRow[],
  row: SidebarFlatRow,
  kind: SidebarFlatRow["kind"],
): boolean {
  const byKey = containerMap(rows);
  let current = row.containerKey;
  while (current) {
    const parent = byKey.get(current);
    if (!parent) {
      return false;
    }
    if (parent.kind === kind) {
      return true;
    }
    current = parent.containerKey;
  }
  return false;
}
