import { expect, it, test, vi } from "vitest";
import pino, { type Logger } from "pino";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import {
  type AgentRunController,
  formatSystemNotificationPrompt,
  isSystemInjectedEnvelope,
  setupFinishNotification,
  startAgentRun,
} from "./agent-prompt.js";
import type { AgentManagerEvent, ManagedAgent } from "./agent-manager.js";
import type { AgentPermissionRequest } from "./agent-sdk-types.js";

interface CapturedLogger {
  logger: Logger;
  records: Array<Record<string, unknown>>;
  nextRecord: Promise<void>;
}

function createCapturedLogger(): CapturedLogger {
  const records: Array<Record<string, unknown>> = [];
  let resolveNextRecord!: () => void;
  const nextRecord = new Promise<void>((resolve) => {
    resolveNextRecord = resolve;
  });
  const logger = pino(
    { level: "error" },
    {
      write(line: string) {
        records.push(JSON.parse(line) as Record<string, unknown>);
        resolveNextRecord();
      },
    },
  );
  return { logger, records, nextRecord };
}

interface FinishNotificationScenarioOptions {
  childLastAssistantMessage?: string | null;
  childParentAgentId?: string | null;
  requireParentOwnership?: boolean;
  parentPromptError?: Error;
  logger?: Logger;
}

interface FinishNotificationScenario {
  startWatchingChild(): void;
  requestChildPermission(requestId?: string): void;
  resolveChildPermission(requestId?: string): void;
  resolveChildPermissionFromState(requestId?: string): void;
  resolveChildPermissionWhileIdle(requestId?: string): void;
  finishChild(): void;
  finishChildAndReadParentPrompt(): Promise<string>;
  closeChildAndReadParentPrompt(): Promise<string>;
  parentPrompts(): string[];
  steerAttemptCount(): number;
  wasParentPrompted(): boolean;
}

function createFinishNotificationScenario(
  options?: FinishNotificationScenarioOptions,
): FinishNotificationScenario {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;
  let resolveParentPrompt: ((prompt: string) => void) | null = null;
  let parentPrompted = false;
  let steerAttemptCount = 0;
  const parentPrompts: string[] = [];

  const childAgent: ManagedAgent = Object.create(null);
  Reflect.set(childAgent, "id", "child-agent");
  Reflect.set(childAgent, "lifecycle", "idle");
  Reflect.set(childAgent, "config", { title: "Child Agent" });
  Reflect.set(childAgent, "pendingPermissions", new Map());

  const callerAgent: ManagedAgent = Object.create(null);
  Reflect.set(callerAgent, "id", "caller-agent");
  Reflect.set(callerAgent, "lifecycle", "idle");
  Reflect.set(callerAgent, "config", { title: "Caller Agent" });

  const agentManager: AgentManager = Object.create(AgentManager.prototype);
  Reflect.set(agentManager, "getAgent", (agentId: string) => {
    if (agentId === "child-agent") {
      return childAgent;
    }
    if (agentId === "caller-agent") {
      return callerAgent;
    }
    return null;
  });
  Reflect.set(agentManager, "subscribe", (callback: (event: AgentManagerEvent) => void) => {
    subscriber = callback;
    return () => {
      subscriber = null;
    };
  });
  Reflect.set(agentManager, "getLastAssistantMessage", async () => {
    return options?.childLastAssistantMessage ?? null;
  });
  Reflect.set(agentManager, "tryRunOutOfBand", () => false);
  Reflect.set(agentManager, "hasInFlightRun", () => Boolean(options?.parentPromptError));
  Reflect.set(agentManager, "steerOrReplaceActiveTurn", async () => {
    steerAttemptCount += 1;
    return { status: "inactive" };
  });
  Reflect.set(agentManager, "streamAgent", (_agentId: string, prompt: string) => {
    parentPrompted = true;
    parentPrompts.push(prompt);
    resolveParentPrompt?.(prompt);
    return (async function* noop() {})();
  });
  Reflect.set(agentManager, "replaceAgentRun", async (_agentId: string, prompt: string) => {
    resolveParentPrompt?.(prompt);
    throw options?.parentPromptError;
  });

  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);
  Reflect.set(agentStorage, "get", async (agentId: string) => {
    if (agentId === "child-agent") {
      const parentAgentId =
        options?.childParentAgentId === undefined ? "caller-agent" : options.childParentAgentId;
      return {
        title: "Child Agent",
        labels: parentAgentId ? { "paseo.parent-agent-id": parentAgentId } : {},
      };
    }
    return null;
  });

  return {
    startWatchingChild() {
      setupFinishNotification({
        agentManager,
        agentStorage,
        childAgentId: "child-agent",
        callerAgentId: "caller-agent",
        requireParentOwnership: options?.requireParentOwnership,
        logger: options?.logger ?? createTestLogger(),
      });
    },
    requestChildPermission(requestId = "permission-1") {
      childAgent.lifecycle = "running";
      childAgent.pendingPermissions.set(requestId, {
        id: requestId,
        provider: "claude",
        kind: "tool",
        name: "Run command",
        description: "Write the QA sentinel",
        input: {
          file_path: "/tmp/permission-qa.txt",
          content: "PASEO_PERMISSION_NOTIFY_QA_OK\n",
        },
      });
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });
      subscriber?.({
        type: "agent_stream",
        agentId: "child-agent",
        event: {
          type: "permission_requested",
          provider: "codex",
          request: childAgent.pendingPermissions.get(requestId)!,
        },
      });
    },
    resolveChildPermission(requestId = "permission-1") {
      childAgent.pendingPermissions.delete(requestId);
      subscriber?.({
        type: "agent_stream",
        agentId: "child-agent",
        event: {
          type: "permission_resolved",
          provider: "codex",
          requestId,
          resolution: { behavior: "allow" },
        },
      });
    },
    resolveChildPermissionFromState(requestId = "permission-1") {
      childAgent.pendingPermissions.delete(requestId);
      subscriber?.({ type: "agent_state", agent: childAgent });
    },
    resolveChildPermissionWhileIdle(requestId = "permission-1") {
      childAgent.pendingPermissions.delete(requestId);
      childAgent.lifecycle = "idle";
      subscriber?.({ type: "agent_state", agent: childAgent });
      subscriber?.({
        type: "agent_stream",
        agentId: "child-agent",
        event: {
          type: "permission_resolved",
          provider: "codex",
          requestId,
          resolution: { behavior: "allow" },
        },
      });
    },
    finishChild() {
      childAgent.lifecycle = "running";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });

      childAgent.lifecycle = "idle";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });
    },
    async finishChildAndReadParentPrompt() {
      const parentPrompt = new Promise<string>((resolve) => {
        resolveParentPrompt = resolve;
      });
      this.finishChild();

      return parentPrompt;
    },
    async closeChildAndReadParentPrompt() {
      const parentPrompt = new Promise<string>((resolve) => {
        resolveParentPrompt = resolve;
      });

      childAgent.lifecycle = "running";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });

      childAgent.lifecycle = "closed";
      subscriber?.({
        type: "agent_state",
        agent: childAgent,
      });

      return parentPrompt;
    },
    parentPrompts() {
      return parentPrompts;
    },
    steerAttemptCount() {
      return steerAttemptCount;
    },
    wasParentPrompted() {
      return parentPrompted;
    },
  };
}

test("isSystemInjectedEnvelope matches the envelope formatSystemNotificationPrompt produces", () => {
  expect(isSystemInjectedEnvelope(formatSystemNotificationPrompt("child finished"))).toBe(true);
  expect(isSystemInjectedEnvelope("hello world")).toBe(false);
});

test("finish notifications tell the parent the child's last assistant message", async () => {
  const scenario = createFinishNotificationScenario({
    childLastAssistantMessage: "Implemented the cleanup and all checks pass.",
  });

  scenario.startWatchingChild();
  const parentPrompt = await scenario.finishChildAndReadParentPrompt();

  expect(parentPrompt).toEqual(
    formatSystemNotificationPrompt(
      "Agent child-agent (Child Agent) finished.\n\n<agent-response>\nImplemented the cleanup and all checks pass.\n</agent-response>",
    ),
  );
  expect(scenario.steerAttemptCount()).toBe(1);
});

test("finish notifications truncate oversized child responses", async () => {
  const included = "x".repeat(4000);
  const omitted = "TAIL-MARKER".repeat(50);
  const scenario = createFinishNotificationScenario({
    childLastAssistantMessage: included + omitted,
  });

  scenario.startWatchingChild();
  const parentPrompt = await scenario.finishChildAndReadParentPrompt();

  expect(parentPrompt).toContain(included);
  expect(parentPrompt).toContain(
    `[truncated ${omitted.length} chars; use get_agent_activity for the full response]`,
  );
  expect(parentPrompt).not.toContain("TAIL-MARKER");
});

test("closing a watched child notifies the caller", async () => {
  const scenario = createFinishNotificationScenario();

  scenario.startWatchingChild();
  const parentPrompt = await scenario.closeChildAndReadParentPrompt();

  expect(parentPrompt).toEqual(
    formatSystemNotificationPrompt("Agent child-agent (Child Agent) was closed."),
  );
});

test("finish notifications survive permission responses", async () => {
  const scenario = createFinishNotificationScenario();

  scenario.startWatchingChild();
  scenario.requestChildPermission();

  await vi.waitFor(() => {
    expect(scenario.parentPrompts()).toHaveLength(1);
  });
  expect(scenario.parentPrompts()[0]).toContain("needs permission.");
  const permissionPayload = scenario
    .parentPrompts()[0]
    .match(/<permission-request>\n([\s\S]+?)\n<\/permission-request>/)?.[1];
  expect(permissionPayload).toBeDefined();
  expect(JSON.parse(permissionPayload!)).toEqual({
    agentId: "child-agent",
    requestId: "permission-1",
    request: {
      id: "permission-1",
      provider: "claude",
      kind: "tool",
      name: "Run command",
      description: "Write the QA sentinel",
      input: {
        file_path: "/tmp/permission-qa.txt",
        content: "PASEO_PERMISSION_NOTIFY_QA_OK\n",
      },
    },
  });

  scenario.resolveChildPermission();
  scenario.finishChild();

  await vi.waitFor(() => {
    expect(scenario.parentPrompts()).toHaveLength(2);
  });
  expect(scenario.parentPrompts()[1]).toContain("finished.");
});

test("an idle permission resolution waits for the resumed run to finish", async () => {
  const scenario = createFinishNotificationScenario();

  scenario.startWatchingChild();
  scenario.requestChildPermission();
  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(1));

  scenario.resolveChildPermissionWhileIdle();
  scenario.requestChildPermission("permission-2");
  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(2));
  expect(scenario.parentPrompts().every((prompt) => prompt.includes("needs permission."))).toBe(
    true,
  );

  scenario.resolveChildPermission("permission-2");
  scenario.finishChild();
  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(3));
  expect(scenario.parentPrompts()[2]).toContain("finished.");
});

test("finish notifications report every concurrently pending permission", async () => {
  const scenario = createFinishNotificationScenario();

  scenario.startWatchingChild();
  scenario.requestChildPermission("permission-1");
  scenario.requestChildPermission("permission-2");

  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(2));
  expect(
    scenario.parentPrompts().map((prompt) => {
      const payload = prompt.match(/<permission-request>\n([\s\S]+?)\n<\/permission-request>/)?.[1];
      return JSON.parse(payload!).requestId;
    }),
  ).toEqual(["permission-1", "permission-2"]);

  scenario.resolveChildPermission("permission-1");
  scenario.resolveChildPermission("permission-2");
  scenario.finishChild();

  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(3));
  expect(scenario.parentPrompts()[2]).toContain("finished.");
});

test("finish notifications survive repeated permission cycles", async () => {
  const scenario = createFinishNotificationScenario();

  scenario.startWatchingChild();
  scenario.requestChildPermission();
  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(1));
  scenario.resolveChildPermissionFromState();

  scenario.requestChildPermission();
  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(2));
  scenario.resolveChildPermission();
  scenario.finishChild();

  await vi.waitFor(() => expect(scenario.parentPrompts()).toHaveLength(3));
  expect(
    scenario.parentPrompts().map((prompt) => prompt.match(/(needs permission|finished)\./)?.[1]),
  ).toEqual(["needs permission", "needs permission", "finished"]);
});

test("detaching a child ends its parent-owned finish notification", async () => {
  const scenario = createFinishNotificationScenario({
    childParentAgentId: null,
    requireParentOwnership: true,
  });
  scenario.startWatchingChild();
  scenario.finishChild();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(scenario.wasParentPrompted()).toBe(false);
});

test("follow-up finish notifications do not require a parent relationship", async () => {
  const scenario = createFinishNotificationScenario({ childParentAgentId: "another-agent" });

  scenario.startWatchingChild();
  const parentPrompt = await scenario.finishChildAndReadParentPrompt();

  expect(parentPrompt).toContain("Agent child-agent (Child Agent) finished.");
});

test("finish notifications log a rejected parent prompt without an unhandled rejection", async () => {
  const captured = createCapturedLogger();
  const scenario = createFinishNotificationScenario({
    parentPromptError: new Error("parent provider rejected replacement"),
    logger: captured.logger,
  });

  scenario.startWatchingChild();
  await scenario.finishChildAndReadParentPrompt();
  await captured.nextRecord;

  expect(captured.records).toEqual([
    expect.objectContaining({
      msg: "Failed to notify caller agent",
      childAgentId: "child-agent",
      callerAgentId: "caller-agent",
      reason: "finished",
      err: expect.objectContaining({ message: "parent provider rejected replacement" }),
    }),
  ]);
});

it("does not notify archived callers", async () => {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;

  const childAgent: ManagedAgent = Object.create(null);
  Reflect.set(childAgent, "id", "child-agent");
  Reflect.set(childAgent, "lifecycle", "idle");
  Reflect.set(childAgent, "config", { title: "Child Agent" });
  Reflect.set(childAgent, "pendingPermissions", new Map());

  const callerAgent: ManagedAgent = Object.create(null);
  Reflect.set(callerAgent, "id", "caller-agent");
  Reflect.set(callerAgent, "lifecycle", "idle");
  Reflect.set(callerAgent, "config", { title: "Caller Agent" });

  const streamAgentSpy = vi.fn(() => (async function* noop() {})());
  const replaceAgentRunSpy = vi.fn(() => (async function* noop() {})());

  const agentManager: AgentManager = Object.create(AgentManager.prototype);
  Reflect.set(
    agentManager,
    "getAgent",
    vi.fn((agentId: string) => {
      if (agentId === "child-agent") {
        return childAgent;
      }
      if (agentId === "caller-agent") {
        return callerAgent;
      }
      return null;
    }),
  );
  Reflect.set(
    agentManager,
    "subscribe",
    vi.fn((callback: (event: AgentManagerEvent) => void) => {
      subscriber = callback;
      return () => {
        subscriber = null;
      };
    }),
  );
  Reflect.set(agentManager, "hasInFlightRun", vi.fn().mockReturnValue(false));
  Reflect.set(agentManager, "streamAgent", streamAgentSpy);
  Reflect.set(agentManager, "replaceAgentRun", replaceAgentRunSpy);

  const agentStorageGetSpy = vi.fn(async (agentId: string) =>
    agentId === "caller-agent" ? { archivedAt: "2024-01-01" } : null,
  );
  const agentStorage: AgentStorage = Object.create(AgentStorage.prototype);
  Reflect.set(agentStorage, "get", agentStorageGetSpy);

  setupFinishNotification({
    agentManager,
    agentStorage,
    childAgentId: "child-agent",
    callerAgentId: "caller-agent",
    logger: createTestLogger(),
  });

  expect(subscriber).not.toBeNull();

  childAgent.lifecycle = "running";
  subscriber?.({
    type: "agent_state",
    agent: childAgent,
  });

  childAgent.lifecycle = "idle";
  subscriber?.({
    type: "agent_state",
    agent: childAgent,
  });

  await vi.waitFor(() => {
    expect(agentStorageGetSpy).toHaveBeenCalledWith("caller-agent");
  });

  expect(streamAgentSpy).not.toHaveBeenCalled();
  expect(replaceAgentRunSpy).not.toHaveBeenCalled();
});

interface PermissionReleaseScenarioOptions {
  /** Request ids the fake manager refuses to resolve, keyed by attempt. */
  failingRequestIds?: string[];
  /** Request ids that stay pending even after a successful-looking response. */
  stuckRequestIds?: string[];
  steerStatus?: "steered" | "replaced" | "inactive";
  /**
   * Ids the fake provider opens one at a time as each earlier request is
   * answered — how Claude walks through a batch of tool calls.
   */
  followUpRequestIds?: string[];
  /**
   * Number of denials after which the fake provider reports the queued steer as
   * read. Defaults to reading it as soon as nothing is pending.
   */
  steerReadAfterDenials?: number;
}

interface PermissionReleaseScenario {
  agentManager: AgentRunController;
  pendingIds(): string[];
  denials(): Array<{
    requestId: string;
    message: string | undefined;
    interrupt: boolean | undefined;
  }>;
  events(): string[];
}

function createPermissionReleaseScenario(
  requestIds: string[],
  options?: PermissionReleaseScenarioOptions,
): PermissionReleaseScenario {
  const pending = new Map<string, AgentPermissionRequest>(
    requestIds.map((id) => [
      id,
      { id, provider: "claude", name: "ExitPlanMode", kind: "plan" } as AgentPermissionRequest,
    ]),
  );
  const denials: Array<{
    requestId: string;
    message: string | undefined;
    interrupt: boolean | undefined;
  }> = [];
  const events: string[] = [];
  const followUps = [...(options?.followUpRequestIds ?? [])];
  let denialCount = 0;

  function hasUnreadSteer(): boolean {
    if (options?.steerReadAfterDenials !== undefined) {
      return denialCount < options.steerReadAfterDenials;
    }
    // A parked provider cannot read its input until every request is answered.
    return pending.size > 0 || followUps.length > 0;
  }

  const agentManager: AgentRunController = {
    getAgent: () => null,
    tryRunOutOfBand: () => false,
    hasInFlightRun: () => true,
    replaceAgentRun: async () => (async function* noop() {})(),
    streamAgent: () => {
      events.push("stream");
      return (async function* noop() {})();
    },
    steerOrReplaceActiveTurn: async () => {
      events.push("steer");
      const status = options?.steerStatus ?? "steered";
      if (status === "replaced") {
        return { status, iterator: (async function* noop() {})() };
      }
      return { status } as Awaited<ReturnType<AgentManager["steerOrReplaceActiveTurn"]>>;
    },
    getPendingPermissions: () => Array.from(pending.values()),
    hasUnreadSteer: () => hasUnreadSteer(),
    respondToPermission: async (_agentId, requestId, response) => {
      events.push(`deny:${requestId}`);
      denialCount += 1;
      if (options?.failingRequestIds?.includes(requestId)) {
        // Mirrors the provider: a request the user answered in the same instant
        // is already gone, so the throw is stale-id noise, not a stuck turn.
        pending.delete(requestId);
        throw new Error(`No pending permission request with id '${requestId}'`);
      }
      denials.push({
        requestId,
        message: response.behavior === "deny" ? response.message : undefined,
        interrupt: response.behavior === "deny" ? response.interrupt : undefined,
      });
      if (!options?.stuckRequestIds?.includes(requestId)) {
        pending.delete(requestId);
      }
      // The provider opens the next request in the batch the moment the
      // previous one returns.
      const followUp = followUps.shift();
      if (followUp) {
        pending.set(followUp, {
          id: followUp,
          provider: "claude",
          name: "Write",
          kind: "tool",
        } as AgentPermissionRequest);
      }
    },
  } as unknown as AgentRunController;

  return {
    agentManager,
    pendingIds: () => Array.from(pending.keys()),
    denials: () => denials,
    events: () => events,
  };
}

test("a steered user prompt denies every pending permission after the steer is admitted", async () => {
  const scenario = createPermissionReleaseScenario(["req-1", "req-2"]);

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "review the plan",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("steered");
  expect(scenario.events()).toEqual(["steer", "deny:req-1", "deny:req-2"]);
  expect(scenario.denials().map((denial) => denial.requestId)).toEqual(["req-1", "req-2"]);
  for (const denial of scenario.denials()) {
    expect(denial.message).toContain("message instead of approving");
    // Interrupting is exactly what the release exists to avoid.
    expect(denial.interrupt).toBeUndefined();
  }
  expect(scenario.pendingIds()).toEqual([]);
});

test("requests the provider opens one at a time are all denied", async () => {
  // A turn that made several tool calls answers one request and immediately
  // opens the next, so a single snapshot leaves the turn parked.
  const scenario = createPermissionReleaseScenario(["req-1"], {
    followUpRequestIds: ["req-2", "req-3"],
  });

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "stop and answer me",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("steered");
  expect(scenario.denials().map((denial) => denial.requestId)).toEqual(["req-1", "req-2", "req-3"]);
  expect(scenario.pendingIds()).toEqual([]);
});

test("a request opened after the steer was read is left for the user", async () => {
  // Once the provider has read the prompt it is acting on the user's message,
  // so the next permission is a decision the user still owns.
  const scenario = createPermissionReleaseScenario(["req-1"], {
    followUpRequestIds: ["req-2"],
    steerReadAfterDenials: 1,
  });

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "stop and answer me",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("steered");
  expect(scenario.denials().map((denial) => denial.requestId)).toEqual(["req-1"]);
  expect(scenario.pendingIds()).toEqual(["req-2"]);
});

test("a request answered in the same instant does not stop the rest from being denied", async () => {
  const scenario = createPermissionReleaseScenario(["req-1", "req-2", "req-3"], {
    failingRequestIds: ["req-1"],
  });

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "review the plan",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("steered");
  expect(scenario.denials().map((denial) => denial.requestId)).toEqual(["req-2", "req-3"]);
  expect(scenario.pendingIds()).toEqual([]);
});

test("a permission that survives the release fails the send instead of reporting a steer", async () => {
  const scenario = createPermissionReleaseScenario(["req-1"], { stuckRequestIds: ["req-1"] });

  await expect(
    startAgentRun(scenario.agentManager, "agent-1", "review the plan", createTestLogger(), {
      activeTurnBehavior: "steer",
      resolvePendingPermissions: true,
    }),
  ).rejects.toThrow(/pending permission/i);
});

test("a replaced turn releases nothing: cancelation already denied the permissions", async () => {
  const scenario = createPermissionReleaseScenario(["req-1"], { steerStatus: "replaced" });

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "review the plan",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("turn_started");
  expect(scenario.denials()).toEqual([]);
});

test("an out-of-band prompt never answers a pending permission", async () => {
  const scenario = createPermissionReleaseScenario(["req-1"]);
  Reflect.set(scenario.agentManager, "tryRunOutOfBand", () => true);

  const result = await startAgentRun(
    scenario.agentManager,
    "agent-1",
    "/goal pause",
    createTestLogger(),
    { activeTurnBehavior: "steer", resolvePendingPermissions: true },
  );

  expect(result.disposition).toBe("out_of_band");
  expect(scenario.denials()).toEqual([]);
});

test("system-injected prompts leave pending permissions for the human", async () => {
  const scenario = createPermissionReleaseScenario(["req-1"]);

  await startAgentRun(
    scenario.agentManager,
    "agent-1",
    formatSystemNotificationPrompt("Agent child-agent finished."),
    createTestLogger(),
    { activeTurnBehavior: "steer" },
  );

  expect(scenario.denials()).toEqual([]);
  expect(scenario.pendingIds()).toEqual(["req-1"]);
});
