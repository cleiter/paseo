import { describe, expect, it } from "vitest";

import {
  formatStallDuration,
  resolveIdleMs,
  resolveWorkingIndicatorActivity,
  WORKING_INDICATOR_STALL_THRESHOLD_MS,
  type WorkingIndicatorActivity,
} from "./working-indicator-state";

function resolve(
  overrides: Partial<Parameters<typeof resolveWorkingIndicatorActivity>[0]> = {},
): WorkingIndicatorActivity {
  return resolveWorkingIndicatorActivity({
    idleMs: 0,
    activeTurnOutputTokens: undefined,
    hasPendingPermission: false,
    isConnected: true,
    isHydrated: true,
    ...overrides,
  });
}

describe("resolveWorkingIndicatorActivity", () => {
  it("defaults to the threshold constant", () => {
    expect(WORKING_INDICATOR_STALL_THRESHOLD_MS).toBe(120_000);
  });

  describe("tokens", () => {
    it("shows nothing when the provider reports no count", () => {
      expect(resolve()).toEqual({});
    });

    it("shows nothing for a zero count", () => {
      // A turn that has produced nothing yet should not render "0 tokens".
      expect(resolve({ activeTurnOutputTokens: 0 })).toEqual({});
    });

    it("shows a positive count", () => {
      expect(resolve({ activeTurnOutputTokens: 1_234 })).toEqual({ outputTokens: 1_234 });
    });
  });

  describe("stall", () => {
    it("does not stall below the threshold", () => {
      expect(resolve({ idleMs: WORKING_INDICATOR_STALL_THRESHOLD_MS - 1 })).toEqual({});
    });

    it("stalls exactly at the threshold", () => {
      expect(resolve({ idleMs: WORKING_INDICATOR_STALL_THRESHOLD_MS })).toEqual({
        stalledIdleMs: WORKING_INDICATOR_STALL_THRESHOLD_MS,
      });
    });

    it("stalls above the threshold", () => {
      expect(resolve({ idleMs: 300_000 })).toEqual({ stalledIdleMs: 300_000 });
    });

    it("honours an injected threshold", () => {
      expect(resolve({ idleMs: 3_000, stallThresholdMs: 2_000 })).toEqual({
        stalledIdleMs: 3_000,
      });
    });

    it("keeps the token count alongside the stall notice", () => {
      // The two slots are independent: how much output is at stake is exactly what the reader
      // needs in order to decide whether to interrupt a stalled turn.
      expect(resolve({ idleMs: 300_000, activeTurnOutputTokens: 1_234 })).toEqual({
        outputTokens: 1_234,
        stalledIdleMs: 300_000,
      });
    });

    it("never claims a stall when the idle duration is unknown", () => {
      expect(resolve({ idleMs: undefined, activeTurnOutputTokens: 500 })).toEqual({
        outputTokens: 500,
      });
    });

    it("never claims a stall while a permission is pending", () => {
      // Covers tool prompts, question cards and plan approvals — all leave the agent running.
      expect(resolve({ idleMs: 300_000, hasPendingPermission: true })).toEqual({});
    });

    it("never claims a stall while disconnected", () => {
      expect(resolve({ idleMs: 300_000, isConnected: false })).toEqual({});
    });

    it("never claims a stall before the directory has hydrated", () => {
      // The replica cache restores `running` plus a stale activity value on a cold start.
      expect(resolve({ idleMs: 300_000, isHydrated: false })).toEqual({});
    });

    it("still shows the token count while suppressed", () => {
      expect(
        resolve({ idleMs: 300_000, hasPendingPermission: true, activeTurnOutputTokens: 42 }),
      ).toEqual({ outputTokens: 42 });
    });
  });
});

describe("formatStallDuration", () => {
  it("floors to the minute past a minute", () => {
    expect(formatStallDuration(4 * 60_000 + 37_000)).toBe("4m");
  });

  it("reads as hours and minutes past an hour, never as 74 minutes", () => {
    expect(formatStallDuration(74 * 60_000 + 20_000)).toBe("1h 14m");
  });

  it("passes sub-minute durations through unfloored", () => {
    // Unreachable at the shipped 2-minute threshold, but the e2e override lowers it and
    // "no output for 0s" would be nonsense.
    expect(formatStallDuration(3_000)).toBe("3s");
  });
});

describe("resolveIdleMs", () => {
  const receivedAt = new Date(10_000);

  it("returns nothing when neither source has a value", () => {
    expect(
      resolveIdleMs({
        activeTurnIdleMs: undefined,
        activeTurnIdleReceivedAt: undefined,
        lastStreamActivityAtMs: undefined,
        nowMs: 20_000,
      }),
    ).toBeUndefined();
  });

  it("adds the client's own elapsed-since-receipt to the daemon duration", () => {
    // 5s measured on the daemon's clock, plus 10s measured on the client's. The two clocks
    // are never compared, only their independent deltas summed.
    expect(
      resolveIdleMs({
        activeTurnIdleMs: 5_000,
        activeTurnIdleReceivedAt: receivedAt,
        lastStreamActivityAtMs: undefined,
        nowMs: 20_000,
      }),
    ).toBe(15_000);
  });

  it("ignores the daemon duration when its receipt instant is missing", () => {
    expect(
      resolveIdleMs({
        activeTurnIdleMs: 5_000,
        activeTurnIdleReceivedAt: undefined,
        lastStreamActivityAtMs: undefined,
        nowMs: 20_000,
      }),
    ).toBeUndefined();
  });

  it("derives an idle duration from client-observed stream activity alone", () => {
    expect(
      resolveIdleMs({
        activeTurnIdleMs: undefined,
        activeTurnIdleReceivedAt: undefined,
        lastStreamActivityAtMs: 12_000,
        nowMs: 20_000,
      }),
    ).toBe(8_000);
  });

  it("takes the fresher of the two, so a stale broadcast cannot invent a stall", () => {
    expect(
      resolveIdleMs({
        activeTurnIdleMs: 300_000,
        activeTurnIdleReceivedAt: receivedAt,
        lastStreamActivityAtMs: 19_000,
        nowMs: 20_000,
      }),
    ).toBe(1_000);
  });

  it("never returns a negative duration", () => {
    expect(
      resolveIdleMs({
        activeTurnIdleMs: 0,
        activeTurnIdleReceivedAt: new Date(30_000),
        lastStreamActivityAtMs: 30_000,
        nowMs: 20_000,
      }),
    ).toBe(0);
  });
});
