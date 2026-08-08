import { expect, type Page } from "@playwright/test";
import { readSessionMessage } from "./session-frames";

interface TimelineSubscriptionWaitOptions {
  timeout?: number;
}

export function observeTimelineSubscriptions(page: Page) {
  let acknowledgedAgentIds: string[] | null = null;

  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const message = readSessionMessage(payload);
      if (message?.type !== "agent.timeline.set_subscription.response") return;
      const response = message.payload as { agentIds?: unknown } | undefined;
      if (!Array.isArray(response?.agentIds)) return;
      acknowledgedAgentIds = response.agentIds.filter(
        (agentId): agentId is string => typeof agentId === "string",
      );
    });
  });

  return {
    async waitForSubscribedAgents(
      agentIds: string[],
      options: TimelineSubscriptionWaitOptions = {},
    ): Promise<void> {
      const expected = [...new Set(agentIds)].sort();
      await expect
        .poll(() => acknowledgedAgentIds?.slice().sort() ?? null, {
          timeout: options.timeout ?? 15_000,
        })
        .toEqual(expected);
    },
  };
}
