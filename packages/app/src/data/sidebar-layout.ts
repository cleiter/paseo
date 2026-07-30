import type { SidebarLayout } from "@getpaseo/protocol/messages";

// The sidebar layout is one user-level document REPLICATED to every host, not a
// per-host record sharded across them. That is what lets a group exist with nothing in
// it: an empty group has no members, so it has no member hosts, so there would be no
// answer to "which daemon owns this" under any sharded model.
//
// Every connected host holds the whole document, including keys belonging to hosts it
// has never heard of. It never interprets them, so that costs nothing, and it means
// your layout survives being viewed from a machine that can only see half of it.

export const EMPTY_SIDEBAR_LAYOUT: SidebarLayout = {
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  projectGroups: [],
  workspaceGroups: [],
  ungroupedProjectKeys: [],
  ungroupedWorkspaceKeysByProject: {},
  pinnedWorkspaceKeys: [],
};

export function sidebarLayoutQueryKey(serverId: string) {
  return ["sidebar-layout", serverId] as const;
}

export interface HostLayoutEntry {
  serverId: string;
  layout: SidebarLayout | null;
}

// Ordering is total and identical on every device, which is the point: two clients
// looking at the same set of hosts must agree on which copy wins, or they would heal
// each other in opposite directions forever.
function isNewer(candidate: HostLayoutEntry, incumbent: HostLayoutEntry): boolean {
  const left = candidate.layout;
  const right = incumbent.layout;
  if (!left) {
    return false;
  }
  if (!right) {
    return true;
  }
  if (left.revision !== right.revision) {
    return left.revision > right.revision;
  }
  // Same revision, different content: genuinely concurrent edits made while the hosts
  // could not see each other. Last write wins, and serverId is the final tiebreak only
  // so that every device makes the SAME arbitrary choice.
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt;
  }
  return candidate.serverId < incumbent.serverId;
}

export function pickWinningLayout(entries: readonly HostLayoutEntry[]): SidebarLayout {
  let winner: HostLayoutEntry | null = null;
  for (const entry of entries) {
    if (!entry.layout) {
      continue;
    }
    if (!winner || isNewer(entry, winner)) {
      winner = entry;
    }
  }
  return winner?.layout ?? EMPTY_SIDEBAR_LAYOUT;
}

// A stable identity for a document's CONTENT, used to tell "the same document" from "a
// different document that happens to share a revision".
//
// Spelled out field by field rather than JSON.stringify'd whole: the arrays are
// order-sensitive on purpose (array order IS the sidebar's order, so a reorder must read
// as a difference), while the by-project record is not (two hosts can serialize the same
// map with its keys in either order, and that is not a divergence). Stringifying the
// document would conflate the two and report a phantom difference forever.
function layoutFingerprint(layout: SidebarLayout): string {
  return JSON.stringify([
    layout.revision,
    layout.updatedAt,
    layout.projectGroups.map((group) => [group.id, group.name, group.projectKeys]),
    layout.workspaceGroups.map((group) => [
      group.id,
      group.name,
      group.projectKey,
      group.workspaceKeys,
    ]),
    layout.ungroupedProjectKeys,
    Object.keys(layout.ungroupedWorkspaceKeysByProject)
      .sort()
      .map((projectKey) => [projectKey, layout.ungroupedWorkspaceKeysByProject[projectKey]]),
    layout.pinnedWorkspaceKeys,
  ]);
}

export interface SidebarLayoutRepair {
  serverId: string;
  layout: SidebarLayout;
  // What the host is believed to hold. The daemon refuses a write based on a stale read,
  // so this is what proves the repair is not one.
  expectedRevision: number;
}

// The writes that bring every host onto the winning document.
//
// The ordinary case is a host that was simply offline while the user edited elsewhere: it
// is strictly behind, and pushing the winner at its own revision lands it exactly on it.
//
// The case that needs care is two hosts on the SAME revision with different content. The
// revision travels with the content and is assigned by the client, so two daemons that
// were edited while they could not see each other both arrive at N+1 holding different
// documents. `pickWinningLayout` chooses between them — every device the same way — but
// choosing is not healing, and the loser is not "behind" by revision, so it would sit
// there diverged forever. Worse, the winner cannot simply be pushed at its own revision:
// the daemon rejects any write that does not MOVE the document forward, so the repair
// would be refused as stale and the two would never converge.
//
// So a same-revision divergence republishes the winner one revision ahead, to everyone.
// That puts every host — the winner's own included — strictly behind a single new target,
// and one pass converges them. `updatedAt` is deliberately carried over rather than
// restamped: two devices repairing the same divergence must produce byte-identical
// documents, or the repair is itself a new divergence.
export function planLayoutRepairs(
  entries: readonly HostLayoutEntry[],
  winner: SidebarLayout,
): SidebarLayoutRepair[] {
  const winnerFingerprint = layoutFingerprint(winner);
  const hasDivergence = entries.some(
    (entry) =>
      entry.layout &&
      entry.layout.revision === winner.revision &&
      layoutFingerprint(entry.layout) !== winnerFingerprint,
  );
  const target = hasDivergence ? { ...winner, revision: winner.revision + 1 } : winner;

  return entries
    .filter((entry) => (entry.layout?.revision ?? 0) < target.revision)
    .map((entry) => ({
      serverId: entry.serverId,
      layout: target,
      expectedRevision: entry.layout?.revision ?? 0,
    }));
}

export function isSidebarLayoutEmpty(layout: SidebarLayout): boolean {
  return layout.projectGroups.length === 0 && layout.workspaceGroups.length === 0;
}
