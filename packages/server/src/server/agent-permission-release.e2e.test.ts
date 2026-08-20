import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { MockLoadTestAgentClient } from "./agent/providers/mock-load-test-agent.js";
import type { SessionOutboundMessage } from "./messages.js";

const PLAN_PROMPT = "emit a synthetic plan approval";
const WAIT_MS = 15_000;

/**
 * A steer accepted while a permission is pending is queued behind a provider
 * that has stopped reading its input, so the daemon must deny the request to
 * let the prompt through. Asserted end-to-end against the mock provider so it
 * runs in CI without credentials; the real-SDK case lives in
 * daemon-e2e/send-during-tool-call-claude.real.e2e.test.ts.
 */
test("a message sent while a plan is pending resolves the plan instead of stalling", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "paseo-permission-release-"));
  const daemon = await createTestPaseoDaemon({
    // The mock provider is a dev-only definition (provider-registry.ts:709).
    isDev: true,
    agentClients: { mock: new MockLoadTestAgentClient() },
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });
  const messages: SessionOutboundMessage[] = [];
  let unsubscribe: (() => void) | null = null;

  try {
    await client.connect();
    unsubscribe = client.subscribeRawMessages((message) => messages.push(message));

    await expect
      .poll(
        async () => {
          const snapshot = await client.getProvidersSnapshot({ cwd });
          return snapshot.entries.some((entry) => entry.provider === "mock");
        },
        { timeout: WAIT_MS },
      )
      .toBe(true);

    const agent = await client.createAgent({
      provider: "mock",
      cwd,
      model: "ten-second-stream",
      initialPrompt: PLAN_PROMPT,
    });

    const parked = await client.waitForFinish(agent.id, WAIT_MS);
    expect(parked.status).toBe("permission");
    const permission = parked.final?.pendingPermissions?.[0];
    expect(permission?.kind).toBe("plan");

    messages.length = 0;
    await client.sendAgentMessage(agent.id, "review this plan first", {
      activeTurnBehavior: "steer",
    });

    await expect
      .poll(
        () =>
          messages.some(
            (message) =>
              message.type === "agent_permission_resolved" &&
              message.payload.requestId === permission?.id,
          ),
        { timeout: WAIT_MS },
      )
      .toBe(true);

    const resolved = messages.find(
      (message) =>
        message.type === "agent_permission_resolved" &&
        message.payload.requestId === permission?.id,
    );
    const resolution = (
      resolved as Extract<SessionOutboundMessage, { type: "agent_permission_resolved" }>
    ).payload.resolution;
    expect(resolution?.behavior).toBe("deny");
    expect(resolution?.behavior === "deny" ? resolution.message : "").toContain(
      "message instead of approving",
    );
    // Denying is not interrupting: the turn must not be canceled out from under
    // the message that was just steered into it.
    expect(resolution?.behavior === "deny" ? resolution.interrupt : undefined).toBeUndefined();
  } finally {
    unsubscribe?.();
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30_000);
