import equal from "fast-deep-equal";
import type { AgentUsage } from "@getpaseo/protocol/agent-types";

interface AgentUpdateValue {
  updatedAt: Date | string;
  lastUsage?: AgentUsage;
  activeTurn?: { turnId: string | null } | null;
  activeTurnOutputTokens?: number;
  activeTurnIdleMs?: number;
  activeTurnIdleReceivedAt?: Date;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function acceptAgentDirectoryUpdate<T extends AgentUpdateValue>(
  current: T | undefined,
  incoming: T,
): T {
  if (!current || timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)) return incoming;

  // From here down the incoming update is STALE — it describes an older state than what we
  // already hold. Usage is grafted forward anyway because a late usage event still describes
  // real consumption that the newer record may not have carried.
  //
  // Live turn progress is different: grafting a stale count forward can put turn N's number on
  // turn N+1's running record, which is the exact staleness this feature exists to avoid. Only
  // carry it when both records agree on which turn produced it.
  const incomingTurnId = incoming.activeTurn?.turnId ?? undefined;
  const sameTurn = incomingTurnId !== undefined && incomingTurnId === current.activeTurn?.turnId;
  const progress: Partial<AgentUpdateValue> = sameTurn
    ? {
        activeTurnOutputTokens: incoming.activeTurnOutputTokens,
        activeTurnIdleMs: incoming.activeTurnIdleMs,
        activeTurnIdleReceivedAt: incoming.activeTurnIdleReceivedAt,
      }
    : {};
  const hasProgressChange =
    sameTurn &&
    (incoming.activeTurnOutputTokens !== current.activeTurnOutputTokens ||
      incoming.activeTurnIdleMs !== current.activeTurnIdleMs);

  if (incoming.lastUsage === undefined || equal(incoming.lastUsage, current.lastUsage)) {
    return hasProgressChange ? { ...current, ...progress } : current;
  }
  return { ...current, ...progress, lastUsage: incoming.lastUsage };
}
