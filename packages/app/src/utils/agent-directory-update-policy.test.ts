import { describe, expect, it } from "vitest";

import { acceptAgentDirectoryUpdate } from "./agent-directory-update-policy";

interface TestAgent {
  updatedAt: Date;
  lastUsage?: { inputTokens?: number; outputTokens?: number };
  activeTurn?: { turnId: string | null } | null;
  activeTurnOutputTokens?: number;
  activeTurnIdleMs?: number;
  activeTurnIdleReceivedAt?: Date;
  marker?: string;
}

const OLDER = new Date("2026-07-30T12:00:00.000Z");
const NEWER = new Date("2026-07-30T12:00:05.000Z");

describe("acceptAgentDirectoryUpdate", () => {
  it("takes the incoming record when there is nothing to compare against", () => {
    const incoming: TestAgent = { updatedAt: OLDER, marker: "incoming" };

    expect(acceptAgentDirectoryUpdate(undefined, incoming)).toBe(incoming);
  });

  it("takes the incoming record when it is at least as new", () => {
    const current: TestAgent = { updatedAt: OLDER, marker: "current" };
    const incoming: TestAgent = { updatedAt: NEWER, marker: "incoming" };

    expect(acceptAgentDirectoryUpdate(current, incoming)).toBe(incoming);
  });

  it("keeps the current record when a stale update carries no usage", () => {
    const current: TestAgent = { updatedAt: NEWER, marker: "current" };
    const incoming: TestAgent = { updatedAt: OLDER, marker: "stale" };

    expect(acceptAgentDirectoryUpdate(current, incoming)).toBe(current);
  });

  it("grafts usage forward from a stale update", () => {
    const current: TestAgent = { updatedAt: NEWER, marker: "current" };
    const incoming: TestAgent = { updatedAt: OLDER, lastUsage: { inputTokens: 10 } };

    const result = acceptAgentDirectoryUpdate(current, incoming);

    expect(result.marker).toBe("current");
    expect(result.lastUsage).toEqual({ inputTokens: 10 });
  });

  describe("live turn progress", () => {
    it("carries a stale count forward when both records describe the same turn", () => {
      const current: TestAgent = {
        updatedAt: NEWER,
        activeTurn: { turnId: "turn-7" },
        activeTurnOutputTokens: 100,
        activeTurnIdleMs: 1_000,
      };
      const incoming: TestAgent = {
        updatedAt: OLDER,
        activeTurn: { turnId: "turn-7" },
        activeTurnOutputTokens: 250,
        activeTurnIdleMs: 5_000,
      };

      const result = acceptAgentDirectoryUpdate(current, incoming);

      expect(result.activeTurnOutputTokens).toBe(250);
      expect(result.activeTurnIdleMs).toBe(5_000);
    });

    it("leaves the current count untouched when the turns differ", () => {
      // The whole point: a delayed update from turn 7 must never write its number onto the
      // record for turn 8, which is the staleness this feature exists to avoid showing.
      const current: TestAgent = {
        updatedAt: NEWER,
        activeTurn: { turnId: "turn-8" },
        activeTurnOutputTokens: 12,
        activeTurnIdleMs: 500,
      };
      const incoming: TestAgent = {
        updatedAt: OLDER,
        activeTurn: { turnId: "turn-7" },
        activeTurnOutputTokens: 9_999,
        activeTurnIdleMs: 90_000,
      };

      const result = acceptAgentDirectoryUpdate(current, incoming);

      expect(result.activeTurnOutputTokens).toBe(12);
      expect(result.activeTurnIdleMs).toBe(500);
    });

    it("leaves the current count untouched when the stale update has no turn id", () => {
      const current: TestAgent = {
        updatedAt: NEWER,
        activeTurn: { turnId: "turn-8" },
        activeTurnOutputTokens: 12,
      };
      const incoming: TestAgent = { updatedAt: OLDER, activeTurnOutputTokens: 9_999 };

      expect(acceptAgentDirectoryUpdate(current, incoming).activeTurnOutputTokens).toBe(12);
    });

    it("leaves the current count untouched when neither record has a turn id", () => {
      // Two undefined turn ids are not evidence of the same turn.
      const current: TestAgent = { updatedAt: NEWER, activeTurnOutputTokens: 12 };
      const incoming: TestAgent = { updatedAt: OLDER, activeTurnOutputTokens: 9_999 };

      expect(acceptAgentDirectoryUpdate(current, incoming).activeTurnOutputTokens).toBe(12);
    });

    it("carries the receipt timestamp alongside the idle duration", () => {
      const receivedAt = new Date("2026-07-30T12:00:03.000Z");
      const current: TestAgent = {
        updatedAt: NEWER,
        activeTurn: { turnId: "turn-7" },
        activeTurnIdleMs: 1_000,
        activeTurnIdleReceivedAt: new Date("2026-07-30T12:00:01.000Z"),
      };
      const incoming: TestAgent = {
        updatedAt: OLDER,
        activeTurn: { turnId: "turn-7" },
        activeTurnIdleMs: 4_000,
        activeTurnIdleReceivedAt: receivedAt,
      };

      const result = acceptAgentDirectoryUpdate(current, incoming);

      // The duration and the instant it was measured must move together, or the client would
      // add elapsed-since-receipt to a duration captured at a different moment.
      expect(result.activeTurnIdleMs).toBe(4_000);
      expect(result.activeTurnIdleReceivedAt).toBe(receivedAt);
    });

    it("does not allocate a new record when a stale same-turn update changes nothing", () => {
      const current: TestAgent = {
        updatedAt: NEWER,
        activeTurn: { turnId: "turn-7" },
        activeTurnOutputTokens: 100,
        activeTurnIdleMs: 1_000,
      };
      const incoming: TestAgent = {
        updatedAt: OLDER,
        activeTurn: { turnId: "turn-7" },
        activeTurnOutputTokens: 100,
        activeTurnIdleMs: 1_000,
      };

      expect(acceptAgentDirectoryUpdate(current, incoming)).toBe(current);
    });
  });
});
