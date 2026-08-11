import { hasWorkspaceLabel } from "@getpaseo/protocol/workspace-labels";

/**
 * Every label there is, which takes two sources rather than one.
 *
 * The daemon's catalog holds the labels someone has coloured; the workspaces hold the labels
 * someone has used. Neither is a superset of the other — a label can be coloured before anything
 * carries it, and a workspace can carry a label from a host whose catalog this client has never
 * seen — so the menu offers the union.
 *
 * Catalog spellings are collected first and win, because that is the spelling the host stored.
 * Two spellings that differ only in case are one label, the same way the daemon dedupes them.
 *
 * `derived` catalog entries are skipped. Those are the daemon echoing back a label some workspace
 * carries, which the workspaces already say; counting the echo keeps a renamed or deleted label
 * alive after its last carrier let go of it, because catalog broadcasts carry only the coloured
 * entries and so nothing overwrites the echo until the next full read.
 */
export function collectKnownWorkspaceLabels(input: {
  catalog: Iterable<{ name: string; derived?: boolean }>;
  workspaces: Iterable<{ labels?: readonly string[] }>;
}): string[] {
  const known: string[] = [];
  for (const entry of input.catalog) {
    if (entry.derived === true) {
      continue;
    }
    if (!hasWorkspaceLabel(known, entry.name)) {
      known.push(entry.name);
    }
  }
  for (const workspace of input.workspaces) {
    for (const label of workspace.labels ?? []) {
      if (!hasWorkspaceLabel(known, label)) {
        known.push(label);
      }
    }
  }
  return known.sort(byWorkspaceLabelName);
}

function byWorkspaceLabelName(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

/**
 * The labels a menu goes on offering while it is open.
 *
 * A label is known because a catalog colours it or because some workspace carries it, so a label
 * nobody has coloured is known only through its carriers. Taking it off the last workspace that
 * carries it therefore un-knows it, and the row you just pressed leaves the menu — with the row
 * below sliding under the pointer, and no way to put the label back on.
 *
 * Once offered, a label stays offered until the menu is closed. `known` wins on spelling, since
 * that is the one the catalog or the carriers say now.
 */
export function mergeOfferedWorkspaceLabels(
  offered: readonly string[],
  known: readonly string[],
): string[] {
  const merged = [...known];
  for (const label of offered) {
    if (!hasWorkspaceLabel(merged, label)) {
      merged.push(label);
    }
  }
  return merged.sort(byWorkspaceLabelName);
}

/** Whether two label lists say the same thing, so a re-render can be skipped. */
export function sameWorkspaceLabels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((label, index) => label === right[index]);
}

/**
 * How many workspaces carry each label, keyed by lowercased name.
 *
 * What it is for is the sentence before a delete: removing a label strips it off every workspace
 * on every host and nothing in the app puts it back, so the count is the size of that blast
 * radius. A workspace carrying two spellings of one label counts once, the same way the sidebar
 * draws it once.
 */
export function countWorkspaceLabelUsage(
  workspaces: Iterable<{ labels?: readonly string[] }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const workspace of workspaces) {
    const seen = new Set<string>();
    for (const label of workspace.labels ?? []) {
      const key = label.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The label set a workspace ends up with after tapping one of its rows: present labels come off,
 * absent ones go on. Case-insensitive, so tapping `Blocked` clears a workspace carrying
 * `blocked` instead of stacking a second spelling on it.
 */
export function toggleWorkspaceLabel(labels: readonly string[], label: string): string[] {
  if (hasWorkspaceLabel(labels, label)) {
    const key = label.toLowerCase();
    return labels.filter((candidate) => candidate.toLowerCase() !== key);
  }
  return [...labels, label];
}
