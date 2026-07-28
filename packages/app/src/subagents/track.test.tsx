/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  // react-native-reanimated reads matchMedia at import time to detect reduced motion, and
  // jsdom does not implement it.
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

vi.mock("expo-router", () => ({
  router: { dismissTo: vi.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

// The shared unistyles test stub carries a trimmed theme, and the real tooltip reads keys it
// does not define (borderWidth, shadow) at module scope. Tooltips are irrelevant to the model
// chip, so stub them rather than widening a fixture every other app test depends on.
vi.mock("@/components/ui/tooltip", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return { Tooltip: passthrough, TooltipTrigger: passthrough, TooltipContent: () => null };
});

// WorkspaceTabIcon transitively registers every panel, which drags xterm and the editor into
// the module graph. The row's icon is not what these assertions are about.
vi.mock("@/screens/workspace/workspace-tab-presentation", () => ({
  WorkspaceTabIcon: () => null,
}));

// App sources compile with the classic JSX transform (tsconfig `jsx: "react-native"`), so a
// component file that never imports React still emits `React.createElement`. Every render test
// in this repo stubs React globally for that reason.
vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { SubagentsTrack } from "@/subagents/track";
import type { ProviderSubagentRow } from "@/subagents/select";

void testI18n;

function providerRow(overrides: Partial<ProviderSubagentRow> = {}): ProviderSubagentRow {
  return {
    kind: "provider",
    id: "child-1",
    parentAgentId: "parent-1",
    provider: "claude",
    title: "Explore",
    status: "running",
    requiresAttention: false,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    modelLabel: null,
    ...overrides,
  };
}

const noop = () => undefined;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderExpandedTrack(rows: ProviderSubagentRow[]): void {
  act(() => {
    root.render(
      <SubagentsTrack
        rows={rows}
        onOpenSubagent={noop}
        onOpenProviderSubagent={noop}
        onArchiveSubagent={noop}
      />,
    );
  });
  const header = container.querySelector('[data-testid="subagents-track-header"]');
  if (!header) {
    throw new Error("expected the subagents track header to render");
  }
  act(() => {
    fireEvent.click(header);
  });
}

describe("SubagentsTrack model chip", () => {
  it("renders the model beside the subagent title", () => {
    renderExpandedTrack([providerRow({ modelLabel: "Opus 4.8" })]);

    expect(
      container.querySelector('[data-testid="subagents-track-model-child-1"]')?.textContent,
    ).toBe("Opus 4.8");
  });

  it("renders no chip when the host reports no model", () => {
    renderExpandedTrack([providerRow({ modelLabel: null })]);

    expect(container.querySelector('[data-testid="subagents-track-model-child-1"]')).toBeNull();
  });

  // The chip is the only place the model appears on screen, so a screen reader would miss it
  // entirely unless it is folded into the row's accessible name. Asserting the rendered string
  // (not just the resource key) is what catches a typo'd t() call, which would otherwise
  // silently render the raw key.
  it("includes the model in the row's accessible name", () => {
    renderExpandedTrack([providerRow({ modelLabel: "Opus 4.8" })]);

    const row = container.querySelector('[data-testid="subagents-track-row-child-1"]');
    expect(row?.getAttribute("aria-label")).toBe("Explore, Opus 4.8");
  });

  it("falls back to the plain title when there is no model", () => {
    renderExpandedTrack([providerRow({ modelLabel: null })]);

    const row = container.querySelector('[data-testid="subagents-track-row-child-1"]');
    expect(row?.getAttribute("aria-label")).toBe("Explore");
  });
});
