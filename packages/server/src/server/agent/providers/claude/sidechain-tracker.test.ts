import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { ClaudeSidechainTracker } from "./sidechain-tracker.js";

type ProviderSubagentUpsert = Extract<
  Extract<
    ReturnType<ClaudeSidechainTracker["handleMessage"]>[number],
    { type: "provider_subagent" }
  >["event"],
  { type: "upsert" }
>;

/**
 * Sidechain assistant message as the SDK actually delivers it: `message.model` is a
 * required field of the underlying BetaMessage, and `subagent_type`/`task_description`
 * sit on the SDK wrapper rather than inside `message`.
 */
function assistantMessage(
  fields: {
    model?: string;
    subagentType?: string;
    taskDescription?: string;
  } = {},
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: "task-1",
    ...(fields.subagentType === undefined ? {} : { subagent_type: fields.subagentType }),
    ...(fields.taskDescription === undefined ? {} : { task_description: fields.taskDescription }),
    message: {
      content: [],
      ...(fields.model === undefined ? {} : { model: fields.model }),
    },
  } as unknown as SDKMessage;
}

function upsertOf(events: ReturnType<ClaudeSidechainTracker["handleMessage"]>) {
  const first = events[0];
  if (!first || first.type !== "provider_subagent" || first.event.type !== "upsert") {
    throw new Error("expected the first event to be a provider_subagent upsert");
  }
  return first.event satisfies ProviderSubagentUpsert;
}

describe("ClaudeSidechainTracker", () => {
  it("uses Claude's native agent name for the provider subagent title", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => ({
        name: "repo_researcher",
        subagent_type: "Explore",
        description: "Inspect the repository",
      }),
    });

    const events = tracker.handleMessage(
      {
        type: "assistant",
        parent_tool_use_id: "task-1",
        message: { content: [] },
      } as unknown as SDKMessage,
      "task-1",
    );

    expect(events[0]).toEqual({
      type: "provider_subagent",
      provider: "claude",
      event: {
        type: "upsert",
        id: "task-1",
        title: "repo_researcher",
        description: "Inspect the repository",
        status: "running",
        toolCallId: "task-1",
      },
    });
  });

  describe("model capture", () => {
    it("reports the model the sidechain is actually running", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      const upsert = upsertOf(
        tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8" }), "task-1"),
      );

      expect(upsert.model).toBe("claude-opus-4-8");
      expect(upsert.modelLabel).toBe("Opus 4.8");
    });

    it("resolves dated and 1M runtime model ids to their manifest label", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      const dated = upsertOf(
        tracker.handleMessage(assistantMessage({ model: "claude-sonnet-5-20260101" }), "task-1"),
      );
      expect(dated.model).toBe("claude-sonnet-5");
      expect(dated.modelLabel).toBe("Sonnet 5");

      const oneMillion = upsertOf(
        tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8[1m]" }), "task-2"),
      );
      expect(oneMillion.model).toBe("claude-opus-4-8[1m]");
      expect(oneMillion.modelLabel).toBe("Opus 4.8 1M");
    });

    // A model Paseo's manifest has never heard of must degrade to the raw id. Resolving it
    // to *some other* model's label would be a confidently wrong answer, which is worse
    // than showing the user an unfamiliar string.
    it("falls back to the raw id for a model the manifest does not know", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      const upsert = upsertOf(
        tracker.handleMessage(assistantMessage({ model: "claude-opus-99-9" }), "task-1"),
      );

      expect(upsert.model).toBe("claude-opus-99-9");
      expect(upsert.modelLabel).toBe("claude-opus-99-9");
    });

    it("keeps the most recently observed model when it changes mid-run", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8" }), "task-1");
      const upsert = upsertOf(
        tracker.handleMessage(assistantMessage({ model: "claude-haiku-4-5" }), "task-1"),
      );

      expect(upsert.model).toBe("claude-haiku-4-5");
      expect(upsert.modelLabel).toBe("Haiku 4.5");
    });

    it("emits no further events while the model stays the same", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      const first = tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8" }), "task-1");
      const second = tracker.handleMessage(
        assistantMessage({ model: "claude-opus-4-8" }),
        "task-1",
      );

      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
    });

    it("omits the model when the sidechain never reports one", () => {
      const tracker = new ClaudeSidechainTracker({
        getToolInput: () => ({ subagent_type: "Explore" }),
      });

      const upsert = upsertOf(tracker.handleMessage(assistantMessage(), "task-1"));

      expect(upsert.model).toBeUndefined();
      expect(upsert.modelLabel).toBeUndefined();
    });

    it("retains the model when the sidechain finishes", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });
      tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8" }), "task-1");

      const upsert = upsertOf(tracker.finish("task-1", "completed"));

      expect(upsert.status).toBe("completed");
      expect(upsert.model).toBe("claude-opus-4-8");
      expect(upsert.modelLabel).toBe("Opus 4.8");
    });

    it("retains the model when every sidechain is finished at once", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });
      tracker.handleMessage(assistantMessage({ model: "claude-opus-4-8" }), "task-1");

      const upsert = upsertOf(tracker.finishAll("canceled"));

      expect(upsert.status).toBe("canceled");
      expect(upsert.model).toBe("claude-opus-4-8");
    });
  });

  describe("title from the message", () => {
    // Backgrounded agents return their tool_result immediately, so the tool-input cache
    // entry can be evicted before the sidechain streams anything. The subagent type still
    // arrives on every assistant message, which is what keeps the row titled.
    it("titles the row from the message when no tool input is cached", () => {
      const tracker = new ClaudeSidechainTracker({ getToolInput: () => null });

      const upsert = upsertOf(
        tracker.handleMessage(
          assistantMessage({ subagentType: "Explore", taskDescription: "Survey the repo" }),
          "task-1",
        ),
      );

      expect(upsert.title).toBe("Explore");
      expect(upsert.description).toBe("Survey the repo");
    });

    it("prefers the tool input's agent name over the message's subagent type", () => {
      const tracker = new ClaudeSidechainTracker({
        getToolInput: () => ({ name: "repo_researcher" }),
      });

      const upsert = upsertOf(
        tracker.handleMessage(assistantMessage({ subagentType: "Explore" }), "task-1"),
      );

      expect(upsert.title).toBe("repo_researcher");
    });

    // The subagent type is a fact about how the sidechain was spawned, so whichever source
    // reports it first wins. Letting the two sources overwrite each other would emit an
    // upsert on every message for the lifetime of the subagent.
    it("does not let the message overwrite an already-known subagent type", () => {
      const tracker = new ClaudeSidechainTracker({
        getToolInput: () => ({ subagent_type: "Explore" }),
      });

      const first = tracker.handleMessage(assistantMessage({ subagentType: "Plan" }), "task-1");
      const second = tracker.handleMessage(assistantMessage({ subagentType: "Plan" }), "task-1");

      expect(upsertOf(first).title).toBe("Explore");
      expect(second).toEqual([]);
    });
  });

  it("ignores non-assistant messages without recording a model", () => {
    const tracker = new ClaudeSidechainTracker({
      getToolInput: () => ({ subagent_type: "Explore" }),
    });

    const upsert = upsertOf(
      tracker.handleMessage(
        { type: "result", parent_tool_use_id: "task-1" } as unknown as SDKMessage,
        "task-1",
      ),
    );

    expect(upsert.title).toBe("Explore");
    expect(upsert.model).toBeUndefined();
  });
});
