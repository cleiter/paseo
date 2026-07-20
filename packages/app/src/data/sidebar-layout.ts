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

// Hosts that are behind the winner. They are not broken — they were most likely just
// offline while the user edited elsewhere. Pushing the winning document at its own
// revision lands them exactly on it.
export function findStaleHosts(
  entries: readonly HostLayoutEntry[],
  winner: SidebarLayout,
): string[] {
  return entries
    .filter((entry) => (entry.layout?.revision ?? 0) < winner.revision)
    .map((entry) => entry.serverId);
}

export function isSidebarLayoutEmpty(layout: SidebarLayout): boolean {
  return layout.projectGroups.length === 0 && layout.workspaceGroups.length === 0;
}
