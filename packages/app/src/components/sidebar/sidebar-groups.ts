import {
  compareSidebarWorkspaceRows,
  type StatusBucket,
  type StatusGroup,
} from "@/hooks/sidebar-status-view-model";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * A headed, flat section of the sidebar — what status mode has always drawn, and what label mode
 * draws too. Two builders, one renderer: a workspace row has to look the same whichever question
 * the headers above it are answering.
 */
export interface SidebarGroup {
  /**
   * React key and collapse-state key, unique within a mode. Label keys carry a prefix so a label
   * someone named "unlabelled" cannot collide with the catch-all group and render twice.
   */
  key: string;
  /** The variable half of the group's test ids — the key without that prefix. */
  testKey: string;
  label: string;
  rows: SidebarWorkspaceEntry[];
  leading: SidebarGroupLeading;
}

/** What the header draws in its leading rail. The colour is resolved at render time. */
export type SidebarGroupLeading =
  | { kind: "status"; bucket: StatusBucket }
  | { kind: "label"; name: string }
  | { kind: "unlabelled" };

export const UNLABELLED_GROUP_KEY = "unlabelled";
const LABEL_GROUP_KEY_PREFIX = "label:";

export function toSidebarGroupsFromStatus(groups: readonly StatusGroup[]): SidebarGroup[] {
  return groups.map((group) => ({
    key: group.bucket,
    testKey: group.bucket,
    label: group.label,
    rows: group.rows,
    leading: { kind: "status", bucket: group.bucket },
  }));
}

/**
 * One group per label in use, plus a catch-all for the workspaces carrying none.
 *
 * A workspace appears under **every** label it carries, so the list holds (label, workspace) pairs
 * and its row count exceeds the workspace count. Picking one label per workspace instead would
 * make every header a lie about what is under it — the `oss` group would be missing workspaces
 * labelled `oss`, which is the one thing a reader is entitled to assume it isn't.
 *
 * The catch-all is not optional. The sidebar is how you find out an agent needs input, and a
 * workspace carries no labels at the moment it is created, so dropping unlabelled rows would hide
 * the workspace you just made — the same failure the filter's two rails exist to prevent.
 *
 * Empty groups are dropped, including labels nothing carries yet. Status mode omits empty buckets
 * for the same reason: a header with nothing under it is a row that only says "not this one".
 */
export function buildLabelSidebarGroups(input: {
  workspaces: readonly SidebarWorkspaceEntry[];
  /** Every label there is, in the order and spelling the label track uses. */
  knownLabels: readonly string[];
  projectNamesByViewKey: ReadonlyMap<string, string>;
  unlabelledLabel: string;
}): SidebarGroup[] {
  const spellings = new Map<string, string>();
  const order = new Map<string, number>();
  for (const name of input.knownLabels) {
    const key = name.trim().toLowerCase();
    if (key.length === 0 || spellings.has(key)) continue;
    order.set(key, order.size);
    spellings.set(key, name);
  }

  const rowsByKey = new Map<string, SidebarWorkspaceEntry[]>();
  const unlabelled: SidebarWorkspaceEntry[] = [];
  for (const workspace of input.workspaces) {
    const keys = new Set<string>();
    for (const label of workspace.labels) {
      const key = label.trim().toLowerCase();
      // Two spellings of one label are one label, so the workspace lands in that group once.
      if (key.length === 0 || keys.has(key)) continue;
      keys.add(key);
      if (!spellings.has(key)) spellings.set(key, label);
      const rows = rowsByKey.get(key);
      if (rows) rows.push(workspace);
      else rowsByKey.set(key, [workspace]);
    }
    if (keys.size === 0) unlabelled.push(workspace);
  }

  const sortRows = (rows: SidebarWorkspaceEntry[]): SidebarWorkspaceEntry[] =>
    rows.sort((left, right) =>
      compareSidebarWorkspaceRows(left, right, input.projectNamesByViewKey),
    );

  const groups: SidebarGroup[] = Array.from(rowsByKey.keys())
    .sort((left, right) => compareLabelKeys({ left, right, order, spellings }))
    .map((key) => {
      const name = spellings.get(key) ?? key;
      return {
        key: `${LABEL_GROUP_KEY_PREFIX}${key}`,
        testKey: key,
        label: name,
        rows: sortRows(rowsByKey.get(key) ?? []),
        leading: { kind: "label", name },
      };
    });

  if (unlabelled.length > 0) {
    groups.push({
      key: UNLABELLED_GROUP_KEY,
      testKey: UNLABELLED_GROUP_KEY,
      label: input.unlabelledLabel,
      rows: sortRows(unlabelled),
      leading: { kind: "unlabelled" },
    });
  }

  return groups;
}

/**
 * Known labels keep the order the track shows them in. Anything else — a label carried by a
 * workspace on a host whose catalog has not arrived — sorts after them by name rather than by
 * whichever workspace happened to be read first.
 */
function compareLabelKeys(input: {
  left: string;
  right: string;
  order: ReadonlyMap<string, number>;
  spellings: ReadonlyMap<string, string>;
}): number {
  const leftOrder = input.order.get(input.left);
  const rightOrder = input.order.get(input.right);
  if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
  if (leftOrder !== undefined) return -1;
  if (rightOrder !== undefined) return 1;
  return (input.spellings.get(input.left) ?? input.left).localeCompare(
    input.spellings.get(input.right) ?? input.right,
    undefined,
    { sensitivity: "base" },
  );
}
