import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

/**
 * Build a single lowercased haystack string for an agent from its human-readable
 * fields. Every field is optional-safe (filtered with `Boolean`) so this degrades
 * cleanly on data sources that omit some of them — e.g. the command center's
 * `useAllAgentsList` does not carry `projectPlacement`. Kept generic (not
 * History-specific) so issue #1618 can adopt the same matcher in the Cmd+K
 * command center.
 *
 * `serverLabel` is deliberately excluded: it is frequently just the `serverId`
 * (history rows set `serverLabel: serverId`), so including it would match every
 * row on a server whenever the user types part of that id.
 */
export function buildAgentSearchText(agent: AggregatedAgent): string {
  return [
    agent.title,
    agent.cwd,
    agent.projectPlacement?.projectName,
    agent.projectPlacement?.workspaceName,
    agent.projectPlacement?.checkout.currentBranch,
    agent.provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Split a query into lowercased, whitespace-delimited tokens. */
export function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Filter agents by a free-text query. Tokens are ANDed: every whitespace-separated
 * token must appear (case-insensitive substring) somewhere in the agent's haystack.
 * An empty query returns the input array unchanged (same reference).
 */
export function filterAgentsByQuery<T extends AggregatedAgent>(agents: T[], query: string): T[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return agents;
  }
  return agents.filter((agent) => {
    const haystack = buildAgentSearchText(agent);
    return tokens.every((token) => haystack.includes(token));
  });
}
