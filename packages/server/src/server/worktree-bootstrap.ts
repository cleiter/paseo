import { v4 as uuidv4 } from "uuid";
import type { Logger } from "pino";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { TerminalSession } from "../terminal/terminal.js";
import {
  getScriptConfigs,
  getWorktreeTerminalSpecs,
  isServiceScript,
  paseoConfigParseError,
  processCarriageReturns,
  readPaseoConfig,
  resolveWorktreeRuntimeEnv,
  runWorktreeSetupCommands,
  WorktreeSetupError,
  type WorktreeConfig,
  type WorktreeSetupCommandResult,
  type WorktreeRuntimeEnv,
} from "../utils/worktree.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import { allocateWorkspaceServicePort } from "./workspace-service-port-allocator.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import type { AgentTimelineItem, ToolCallDetail } from "./agent/agent-sdk-types.js";
import {
  assertNoServiceEnvNameCollisions,
  buildWorkspaceServiceEnv,
  type WorkspaceServicePeer,
} from "./workspace-service-env.js";
import {
  ensureWorkspaceServicePortPlan,
  requirePlannedWorkspaceServicePort,
  refreshWorkspaceServicePort,
} from "./workspace-service-port-registry.js";
import type { PaseoServicePortAllocation } from "@getpaseo/protocol/paseo-config-schema";

export interface WorktreeBootstrapTerminalResult {
  name: string | null;
  command: string;
  status: "started" | "failed";
  terminalId: string | null;
  error: string | null;
}

export interface RunAsyncWorktreeBootstrapOptions {
  agentId: string;
  // Workspace the bootstrapped terminals belong to. Stamping it lets
  // workspaceId-scoped archive tear these terminals down.
  workspaceId: string;
  worktree: WorktreeConfig;
  workspaceCwd?: string;
  shouldBootstrap?: boolean;
  terminalManager: TerminalManager | null;
  appendTimelineItem: (item: AgentTimelineItem) => Promise<boolean>;
  emitLiveTimelineItem?: (item: AgentTimelineItem) => Promise<boolean>;
  logger?: Logger;
}

const MAX_WORKTREE_SETUP_COMMAND_OUTPUT_BYTES = 64 * 1024;
const WORKTREE_SETUP_TRUNCATION_MARKER = "\n...<output truncated in the middle>...\n";
const WORKTREE_BOOTSTRAP_TERMINAL_READY_TIMEOUT_MS = 1_500;
// How long to wait for an integrated shell to reach its line editor. Generous:
// it covers slow rc files, and the cost of being wrong is a corrupted command.
const TERMINAL_PROMPT_READY_TIMEOUT_MS = 15_000;

interface MiddleTruncationAccumulator {
  totalBytes: number;
  head: string;
  tail: string;
  truncated: boolean;
}

export type WorktreeSetupOutputAccumulator = MiddleTruncationAccumulator;
export interface WorktreeSetupProgressAccumulator {
  resultsByIndex: Map<number, WorktreeSetupCommandResult>;
  outputAccumulatorsByIndex: Map<number, WorktreeSetupOutputAccumulator>;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function sliceFirstBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text.length === 0) {
    return "";
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) {
    return text;
  }
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function sliceLastBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text.length === 0) {
    return "";
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) {
    return text;
  }
  return bytes.subarray(bytes.length - maxBytes).toString("utf8");
}

export function createWorktreeSetupOutputAccumulator(): WorktreeSetupOutputAccumulator {
  return {
    totalBytes: 0,
    head: "",
    tail: "",
    truncated: false,
  };
}

function getHeadTailBudgets(maxBytes: number): { headBytes: number; tailBytes: number } {
  const markerBytes = byteLength(WORKTREE_SETUP_TRUNCATION_MARKER);
  const availableBytes = Math.max(0, maxBytes - markerBytes);
  const headBytes = Math.floor(availableBytes / 2);
  const tailBytes = availableBytes - headBytes;
  return { headBytes, tailBytes };
}

export function appendWorktreeSetupOutputAccumulator(
  accumulator: WorktreeSetupOutputAccumulator,
  chunk: string,
): void {
  if (!chunk) {
    return;
  }
  accumulator.totalBytes += byteLength(chunk);

  if (!accumulator.truncated) {
    const combined = `${accumulator.head}${chunk}`;
    if (byteLength(combined) <= MAX_WORKTREE_SETUP_COMMAND_OUTPUT_BYTES) {
      accumulator.head = combined;
      return;
    }
    const { headBytes, tailBytes } = getHeadTailBudgets(MAX_WORKTREE_SETUP_COMMAND_OUTPUT_BYTES);
    accumulator.head = sliceFirstBytes(combined, headBytes);
    accumulator.tail = sliceLastBytes(combined, tailBytes);
    accumulator.truncated = true;
    return;
  }

  const { tailBytes } = getHeadTailBudgets(MAX_WORKTREE_SETUP_COMMAND_OUTPUT_BYTES);
  accumulator.tail = sliceLastBytes(`${accumulator.tail}${chunk}`, tailBytes);
}

function truncateTextInMiddle(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (maxBytes <= 0 || !text) {
    return { text: "", truncated: text.length > 0 };
  }
  if (byteLength(text) <= maxBytes) {
    return { text, truncated: false };
  }
  const { headBytes, tailBytes } = getHeadTailBudgets(maxBytes);
  return {
    text: `${sliceFirstBytes(text, headBytes)}${WORKTREE_SETUP_TRUNCATION_MARKER}${sliceLastBytes(text, tailBytes)}`,
    truncated: true,
  };
}

function renderMiddleTruncationAccumulator(accumulator: MiddleTruncationAccumulator): {
  text: string;
  truncated: boolean;
} {
  if (!accumulator.truncated) {
    return { text: accumulator.head, truncated: false };
  }
  return {
    text: `${accumulator.head}${WORKTREE_SETUP_TRUNCATION_MARKER}${accumulator.tail}`,
    truncated: true,
  };
}

function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function commandStatusFromResult(
  result: WorktreeSetupCommandResult,
): "running" | "completed" | "failed" {
  if (result.exitCode === null) {
    return "running";
  }
  return result.exitCode === 0 ? "completed" : "failed";
}

function buildWorktreeSetupLog(input: {
  results: WorktreeSetupCommandResult[];
  outputAccumulatorsByIndex?: Map<number, WorktreeSetupOutputAccumulator>;
}): { log: string; truncated: boolean } {
  const { results, outputAccumulatorsByIndex } = input;
  if (results.length === 0) {
    return {
      log: "",
      truncated: false,
    };
  }

  const lines: string[] = [];
  let anyTruncated = false;
  const total = results.length;
  for (const [index, result] of results.entries()) {
    lines.push(`==> [${index + 1}/${total}] Running: ${result.command}`);
    const output = buildWorktreeSetupCommandLog({
      index: index + 1,
      result,
      outputAccumulatorsByIndex,
    });
    if (output.log.length > 0) {
      lines.push(output.log.replace(/\n$/, ""));
    }
    if (output.truncated) {
      anyTruncated = true;
    }
    if (result.exitCode !== null) {
      lines.push(
        `<== [${index + 1}/${total}] Exit ${result.exitCode} in ${formatDurationMs(result.durationMs)}`,
      );
    }
  }
  return {
    log: lines.join("\n"),
    truncated: anyTruncated,
  };
}

function buildWorktreeSetupCommandLog(input: {
  index: number;
  result: WorktreeSetupCommandResult;
  outputAccumulatorsByIndex?: Map<number, WorktreeSetupOutputAccumulator>;
}): { log: string; truncated: boolean } {
  const { index, result, outputAccumulatorsByIndex } = input;
  const accumulator = outputAccumulatorsByIndex?.get(index);
  const rendered = accumulator
    ? renderMiddleTruncationAccumulator(accumulator)
    : truncateTextInMiddle(
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
        MAX_WORKTREE_SETUP_COMMAND_OUTPUT_BYTES,
      );

  return {
    log: processCarriageReturns(rendered.text),
    truncated: rendered.truncated,
  };
}

export function createWorktreeSetupProgressAccumulator(): WorktreeSetupProgressAccumulator {
  return {
    resultsByIndex: new Map(),
    outputAccumulatorsByIndex: new Map(),
  };
}

export function applyWorktreeSetupProgressEvent(
  accumulator: WorktreeSetupProgressAccumulator,
  event: Parameters<NonNullable<Parameters<typeof runWorktreeSetupCommands>[0]["onEvent"]>>[0],
): void {
  const existing = accumulator.resultsByIndex.get(event.index);
  const baseResult: WorktreeSetupCommandResult = existing ?? {
    command: event.command,
    cwd: event.cwd,
    stdout: "",
    stderr: "",
    exitCode: null,
    durationMs: 0,
  };

  if (event.type === "output") {
    const outputAccumulator =
      accumulator.outputAccumulatorsByIndex.get(event.index) ??
      createWorktreeSetupOutputAccumulator();
    appendWorktreeSetupOutputAccumulator(outputAccumulator, event.chunk);
    accumulator.outputAccumulatorsByIndex.set(event.index, outputAccumulator);
    accumulator.resultsByIndex.set(event.index, {
      ...baseResult,
      stdout: baseResult.stdout,
      stderr: baseResult.stderr,
    });
    return;
  }

  if (event.type === "command_completed") {
    accumulator.resultsByIndex.set(event.index, {
      ...baseResult,
      stdout: event.stdout,
      stderr: event.stderr,
      exitCode: event.exitCode,
      durationMs: event.durationMs,
    });
    return;
  }

  accumulator.resultsByIndex.set(event.index, baseResult);
}

export function getWorktreeSetupProgressResults(
  accumulator: WorktreeSetupProgressAccumulator,
): WorktreeSetupCommandResult[] {
  return Array.from(accumulator.resultsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, result]) => result);
}

export function buildWorktreeSetupDetail(input: {
  worktree: WorktreeConfig;
  results: WorktreeSetupCommandResult[];
  outputAccumulatorsByIndex?: Map<number, WorktreeSetupOutputAccumulator>;
}): Extract<ToolCallDetail, { type: "worktree_setup" }> {
  let anyCommandTruncated = false;
  const commands = input.results.map((result, index) => {
    const renderedLog = buildWorktreeSetupCommandLog({
      index: index + 1,
      result,
      outputAccumulatorsByIndex: input.outputAccumulatorsByIndex,
    });
    if (renderedLog.truncated) {
      anyCommandTruncated = true;
    }
    return {
      index: index + 1,
      command: result.command,
      cwd: result.cwd,
      log: renderedLog.log,
      status: commandStatusFromResult(result),
      exitCode: result.exitCode,
      ...(result.durationMs > 0 ? { durationMs: result.durationMs } : {}),
    };
  });
  const renderedLog = buildWorktreeSetupLog({
    results: input.results,
    outputAccumulatorsByIndex: input.outputAccumulatorsByIndex,
  });

  return {
    type: "worktree_setup",
    worktreePath: input.worktree.worktreePath,
    branchName: input.worktree.branchName,
    log: renderedLog.log,
    commands,
    ...(renderedLog.truncated || anyCommandTruncated ? { truncated: true } : {}),
  };
}

function buildSetupTimelineItem(input: {
  callId: string;
  status: "running" | "completed" | "failed";
  worktree: WorktreeConfig;
  results: WorktreeSetupCommandResult[];
  outputAccumulatorsByIndex?: Map<number, WorktreeSetupOutputAccumulator>;
  errorMessage: string | null;
}): AgentTimelineItem {
  const detail = buildWorktreeSetupDetail({
    worktree: input.worktree,
    results: input.results,
    outputAccumulatorsByIndex: input.outputAccumulatorsByIndex,
  });

  if (input.status === "running") {
    return {
      type: "tool_call",
      name: "paseo_worktree_setup",
      callId: input.callId,
      status: "running",
      detail,
      error: null,
    };
  }

  if (input.status === "completed") {
    return {
      type: "tool_call",
      name: "paseo_worktree_setup",
      callId: input.callId,
      status: "completed",
      detail,
      error: null,
    };
  }

  return {
    type: "tool_call",
    name: "paseo_worktree_setup",
    callId: input.callId,
    status: "failed",
    detail,
    error: { message: input.errorMessage ?? "Worktree setup failed" },
  };
}

function buildTerminalTimelineItem(input: {
  callId: string;
  status: "running" | "completed" | "failed";
  worktree: WorktreeConfig;
  results: WorktreeBootstrapTerminalResult[];
  errorMessage: string | null;
}): AgentTimelineItem {
  const detailInput = {
    worktreePath: input.worktree.worktreePath,
    branchName: input.worktree.branchName,
  };
  const detailOutput = {
    worktreePath: input.worktree.worktreePath,
    terminals: input.results,
  };

  if (input.status === "running") {
    return {
      type: "tool_call",
      name: "paseo_worktree_terminals",
      callId: input.callId,
      status: "running",
      detail: {
        type: "unknown",
        input: detailInput,
        output: null,
      },
      error: null,
    };
  }

  if (input.status === "completed") {
    return {
      type: "tool_call",
      name: "paseo_worktree_terminals",
      callId: input.callId,
      status: "completed",
      detail: {
        type: "unknown",
        input: detailInput,
        output: detailOutput,
      },
      error: null,
    };
  }

  return {
    type: "tool_call",
    name: "paseo_worktree_terminals",
    callId: input.callId,
    status: "failed",
    detail: {
      type: "unknown",
      input: detailInput,
      output: detailOutput,
    },
    error: { message: input.errorMessage ?? "Worktree terminal bootstrap failed" },
  };
}

type ReadinessTerminal = Pick<
  TerminalSession,
  | "id"
  | "getState"
  | "subscribe"
  | "shellIntegrationExpected"
  | "isAtPrompt"
  | "onPromptStateChange"
  | "onExit"
  | "getExitInfo"
>;

export type TerminalNotReadyReason = "timeout" | "exited";

/**
 * The shell never reached a state where typing into it is safe. Thrown instead
 * of injecting anyway: a command typed into a shell that is blocked on `read`
 * gets its first characters eaten, which silently corrupts it.
 */
export class TerminalNotReadyError extends Error {
  constructor(
    public readonly terminalId: string,
    public readonly reason: TerminalNotReadyReason,
    public readonly waitedMs: number,
  ) {
    super(
      reason === "exited"
        ? "The terminal's shell exited before it reached a prompt."
        : "The terminal's shell never reached a prompt. Something in your shell startup may be " +
            "waiting for input — answer it in the terminal, then run this again.",
    );
    this.name = "TerminalNotReadyError";
  }
}

/**
 * Resolves once the terminal is safe to type into.
 *
 * With a shell integration, that means the line editor has taken the line
 * (see docs/terminal-input-readiness.md). Without one there is no reliable
 * signal, so we keep the old heuristic: first output, or a short grace period.
 * That heuristic is why a blocking oh-my-zsh update prompt used to eat the
 * first character of an injected command.
 */
async function waitForTerminalInputReadiness(
  terminal: ReadinessTerminal,
  options: { timeoutMs: number },
): Promise<void> {
  if (!terminal.shellIntegrationExpected) {
    await waitForFirstTerminalOutput(terminal);
    return;
  }

  if (terminal.getExitInfo()) {
    throw new TerminalNotReadyError(terminal.id, "exited", 0);
  }
  if (terminal.isAtPrompt()) {
    return;
  }

  const startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribePromptState: (() => void) | null = null;
    let unsubscribeExit: (() => void) | null = null;

    // One-shot: prompt, exit and timeout can all land in the same tick.
    const settle = (error: TerminalNotReadyError | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      unsubscribePromptState?.();
      unsubscribePromptState = null;
      unsubscribeExit?.();
      unsubscribeExit = null;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    // Subscribe before re-reading the state: the marker can land between a
    // check and a late subscription, and that gap is the whole bug.
    unsubscribePromptState = terminal.onPromptStateChange((atPrompt) => {
      if (atPrompt) {
        settle(null);
      }
    });
    unsubscribeExit = terminal.onExit(() => {
      settle(new TerminalNotReadyError(terminal.id, "exited", Date.now() - startedAt));
    });

    if (terminal.isAtPrompt()) {
      settle(null);
      return;
    }
    if (terminal.getExitInfo()) {
      settle(new TerminalNotReadyError(terminal.id, "exited", Date.now() - startedAt));
      return;
    }

    timeout = setTimeout(() => {
      settle(new TerminalNotReadyError(terminal.id, "timeout", Date.now() - startedAt));
    }, options.timeoutMs);
  });
}

async function waitForFirstTerminalOutput(
  terminal: Pick<TerminalSession, "getState" | "subscribe">,
): Promise<void> {
  if (terminalHasOutput(terminal.getState())) {
    return;
  }

  await new Promise<void>((resolve) => {
    let pendingResolve: (() => void) | null = resolve;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const finish = () => {
      if (!pendingResolve) {
        return;
      }
      const fn = pendingResolve;
      pendingResolve = null;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      fn();
    };

    unsubscribe = terminal.subscribe((message) => {
      if (message.type !== "output") {
        return;
      }
      finish();
    });

    if (terminalHasOutput(terminal.getState())) {
      finish();
      return;
    }

    timeout = setTimeout(finish, WORKTREE_BOOTSTRAP_TERMINAL_READY_TIMEOUT_MS);
  });
}

function terminalHasOutput(state: ReturnType<TerminalSession["getState"]>): boolean {
  for (const row of [...state.scrollback, ...state.grid]) {
    for (const cell of row) {
      if (cell.char.trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}

async function runWorktreeTerminalBootstrap(
  options: RunAsyncWorktreeBootstrapOptions,
  runtimeEnv: WorktreeRuntimeEnv,
): Promise<void> {
  const workspaceCwd = options.workspaceCwd ?? options.worktree.worktreePath;
  const terminalSpecs = getWorktreeTerminalSpecs(workspaceCwd);
  if (terminalSpecs.length === 0) {
    return;
  }

  const callId = uuidv4();
  const started = await options.appendTimelineItem(
    buildTerminalTimelineItem({
      callId,
      status: "running",
      worktree: options.worktree,
      results: [],
      errorMessage: null,
    }),
  );
  if (!started) {
    return;
  }

  if (!options.terminalManager) {
    await options.appendTimelineItem(
      buildTerminalTimelineItem({
        callId,
        status: "failed",
        worktree: options.worktree,
        results: [],
        errorMessage: "Terminal manager not available",
      }),
    );
    return;
  }

  const terminalManager = options.terminalManager;
  const results = await Promise.all(
    terminalSpecs.map(async (spec): Promise<WorktreeBootstrapTerminalResult> => {
      // Tracked outside the try so a readiness failure can still point at the
      // terminal it left open — that terminal holds the reason it failed.
      let createdTerminal: TerminalSession | null = null;
      try {
        const terminal = await terminalManager.createTerminal({
          cwd: workspaceCwd,
          name: spec.name,
          env: runtimeEnv,
          workspaceId: options.workspaceId,
        });
        createdTerminal = terminal;
        await waitForTerminalInputReadiness(terminal, {
          timeoutMs: TERMINAL_PROMPT_READY_TIMEOUT_MS,
        });
        terminal.send({
          type: "input",
          data: `${spec.command}\r`,
        });
        return {
          name: terminal.name ?? spec.name ?? null,
          command: spec.command,
          status: "started",
          terminalId: terminal.id,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.warn(
          { agentId: options.agentId, command: spec.command, err: error },
          "Failed to bootstrap worktree terminal",
        );
        return {
          name: createdTerminal?.name ?? spec.name ?? null,
          command: spec.command,
          status: "failed",
          terminalId: createdTerminal?.id ?? null,
          error: message,
        };
      }
    }),
  );

  await options.appendTimelineItem(
    buildTerminalTimelineItem({
      callId,
      status: "completed",
      worktree: options.worktree,
      results,
      errorMessage: null,
    }),
  );
}

export async function runAsyncWorktreeBootstrap(
  options: RunAsyncWorktreeBootstrapOptions,
): Promise<void> {
  if (options.shouldBootstrap === false) {
    return;
  }

  const setupCallId = uuidv4();
  let setupResults: WorktreeSetupCommandResult[] = [];
  let runtimeEnv: WorktreeRuntimeEnv | null = null;
  const emitLiveTimelineItem = options.emitLiveTimelineItem;
  const progressAccumulator = createWorktreeSetupProgressAccumulator();
  const workspaceCwd = options.workspaceCwd ?? options.worktree.worktreePath;
  let liveEmitQueue = Promise.resolve();

  const queueLiveRunningEmit = () => {
    if (!emitLiveTimelineItem) {
      return;
    }
    const runningResults = getWorktreeSetupProgressResults(progressAccumulator);
    liveEmitQueue = liveEmitQueue.then(async () => {
      try {
        await emitLiveTimelineItem(
          buildSetupTimelineItem({
            callId: setupCallId,
            status: "running",
            worktree: options.worktree,
            results: runningResults,
            outputAccumulatorsByIndex: progressAccumulator.outputAccumulatorsByIndex,
            errorMessage: null,
          }),
        );
      } catch (error) {
        options.logger?.warn(
          { err: error, agentId: options.agentId },
          "Failed to emit live worktree setup timeline update",
        );
      }
      return;
    });
  };

  try {
    runtimeEnv = await resolveWorktreeRuntimeEnv({
      worktreePath: options.worktree.worktreePath,
      branchName: options.worktree.branchName,
    });
    options.terminalManager?.registerCwdEnv({
      cwd: workspaceCwd,
      env: runtimeEnv,
    });

    setupResults = await runWorktreeSetupCommands({
      worktreePath: workspaceCwd,
      branchName: options.worktree.branchName,
      cleanupOnFailure: false,
      runtimeEnv,
      onEvent: (event) => {
        applyWorktreeSetupProgressEvent(progressAccumulator, event);
        queueLiveRunningEmit();
      },
    });
    await liveEmitQueue;

    const completed = await options.appendTimelineItem(
      buildSetupTimelineItem({
        callId: setupCallId,
        status: "completed",
        worktree: options.worktree,
        results: setupResults,
        outputAccumulatorsByIndex: progressAccumulator.outputAccumulatorsByIndex,
        errorMessage: null,
      }),
    );
    if (!completed) {
      return;
    }
  } catch (error) {
    if (error instanceof WorktreeSetupError) {
      setupResults = error.results;
    }
    await liveEmitQueue;
    const message = error instanceof Error ? error.message : String(error);
    await options.appendTimelineItem(
      buildSetupTimelineItem({
        callId: setupCallId,
        status: "failed",
        worktree: options.worktree,
        results: setupResults,
        outputAccumulatorsByIndex: progressAccumulator.outputAccumulatorsByIndex,
        errorMessage: message,
      }),
    );
    return;
  }

  await runWorktreeTerminalBootstrap(options, runtimeEnv);
}

// ---------------------------------------------------------------------------
// Script lifecycle helpers
// ---------------------------------------------------------------------------

export interface WorktreeScriptResult {
  scriptName: string;
  hostname: string | null;
  port: number | null;
  terminalId: string;
}

export interface SpawnWorkspaceScriptOptions {
  repoRoot: string;
  workspaceId: string;
  projectSlug: string;
  branchName: string | null;
  scriptName: string;
  daemonPort?: number | null;
  daemonListenHost?: string | null;
  serviceProxyPublicBaseUrl?: string | null;
  serviceProxy: ServiceProxySubsystem;
  runtimeStore: WorkspaceScriptRuntimeStore;
  terminalManager: TerminalManager;
  globalServicePorts?: PaseoServicePortAllocation;
  logger?: Logger;
  onLifecycleChanged?: () => void;
  // Overridable so tests can exercise the timeout without waiting it out.
  promptReadyTimeoutMs?: number;
}

interface ServiceScriptSetupResult {
  hostname: string;
  port: number;
  env: Record<string, string>;
}

async function setupServiceScriptRoute(params: {
  repoRoot: string;
  scriptConfigs: ReturnType<typeof getScriptConfigs>;
  config: { port?: number };
  scriptName: string;
  projectSlug: string;
  branchName: string | null;
  workspaceId: string;
  daemonPort: number | null | undefined;
  daemonListenHost: string | null | undefined;
  serviceProxyPublicBaseUrl: string | null | undefined;
  existingRuntimeEntry: ReturnType<WorkspaceScriptRuntimeStore["get"]>;
  serviceProxy: ServiceProxySubsystem;
  servicePortAllocation: PaseoServicePortAllocation | undefined;
}): Promise<ServiceScriptSetupResult> {
  const {
    scriptConfigs,
    repoRoot,
    config,
    scriptName,
    projectSlug,
    branchName,
    workspaceId,
    daemonPort,
    daemonListenHost,
    serviceProxyPublicBaseUrl,
    existingRuntimeEntry,
    serviceProxy,
    servicePortAllocation,
  } = params;

  const serviceDeclarations: Array<{ scriptName: string; port?: number }> = [];
  for (const [configuredScriptName, scriptConfig] of scriptConfigs) {
    if (isServiceScript(scriptConfig)) {
      serviceDeclarations.push({
        scriptName: configuredScriptName,
        port: scriptConfig.port,
      });
    }
  }
  assertNoServiceEnvNameCollisions(
    serviceDeclarations.map((serviceDeclaration) => serviceDeclaration.scriptName),
  );

  const plannedPorts = await ensureWorkspaceServicePortPlan({
    workspaceId,
    services: serviceDeclarations,
    allocatePort: ({ scriptName: serviceScriptName, reservedPorts }) =>
      allocateWorkspaceServicePort({
        allocation: servicePortAllocation,
        cwd: repoRoot,
        scriptName: serviceScriptName,
        workspaceId,
        branchName,
        reservedPorts,
      }),
  });
  const port =
    existingRuntimeEntry?.lifecycle === "stopped"
      ? await refreshWorkspaceServicePort({
          workspaceId,
          service: { scriptName, port: config.port },
          allocatePort: ({ scriptName: serviceScriptName, reservedPorts }) =>
            allocateWorkspaceServicePort({
              allocation: servicePortAllocation,
              cwd: repoRoot,
              scriptName: serviceScriptName,
              workspaceId,
              branchName,
              reservedPorts,
            }),
        })
      : requirePlannedWorkspaceServicePort(plannedPorts, scriptName);

  const peers: WorkspaceServicePeer[] = [];
  for (const [peerScriptName, peerPort] of plannedPorts) {
    peers.push({
      scriptName: peerScriptName,
      port: peerScriptName === scriptName ? port : peerPort,
    });
  }

  const env = buildWorkspaceServiceEnv({
    scriptName,
    projectSlug,
    branchName,
    daemonPort,
    daemonListenHost,
    serviceProxyPublicBaseUrl,
    peers,
  });

  const registeredRoute = serviceProxy.registerWorkspaceService({
    port,
    workspaceId,
    projectSlug,
    branchName,
    scriptName,
    publicBaseUrl: serviceProxyPublicBaseUrl ?? null,
  });
  return { hostname: registeredRoute.hostname, port, env };
}

async function acquireWorkspaceScriptTerminal(params: {
  serviceScript: boolean;
  existingRuntimeEntry: ReturnType<WorkspaceScriptRuntimeStore["get"]>;
  terminalManager: TerminalManager;
  repoRoot: string;
  workspaceId: string;
  scriptName: string;
  env: Record<string, string> | undefined;
}): Promise<TerminalSession> {
  const {
    serviceScript,
    existingRuntimeEntry,
    terminalManager,
    repoRoot,
    workspaceId,
    scriptName,
    env,
  } = params;
  let reusableTerminal: TerminalSession | null = null;
  if (!serviceScript && existingRuntimeEntry?.terminalId) {
    reusableTerminal = terminalManager.getTerminal(existingRuntimeEntry.terminalId) ?? null;
  }
  return (
    reusableTerminal ??
    (await terminalManager.createTerminal({
      cwd: repoRoot,
      workspaceId,
      name: scriptName,
      title: scriptName,
      env,
    }))
  );
}

/**
 * Undo a failed spawn's runtime bookkeeping.
 *
 * A shell that never reached a prompt leaves its terminal open holding the
 * reason why — typically a startup prompt waiting to be answered. For plain
 * scripts the runtime entry is kept pointing at that terminal so re-running
 * reuses it: answer the prompt, run again, and the command lands in the same
 * shell. Service scripts get a freshly planned port on the next run while their
 * terminal's env still carries the old one, so reuse would be wrong — drop the
 * entry and let the retry start clean.
 */
function releaseFailedScriptSpawn(params: {
  error: unknown;
  serviceScript: boolean;
  scriptType: "script" | "service";
  workspaceId: string;
  scriptName: string;
  terminalId: string | null;
  runtimeStore: WorkspaceScriptRuntimeStore;
  onLifecycleChanged?: () => void;
}): void {
  const { error, serviceScript, scriptType, workspaceId, scriptName, terminalId, runtimeStore } =
    params;
  const preserveTerminalForRetry =
    error instanceof TerminalNotReadyError && error.reason === "timeout" && !serviceScript;

  if (!preserveTerminalForRetry || !terminalId) {
    runtimeStore.remove({ workspaceId, scriptName });
    return;
  }

  runtimeStore.set({
    workspaceId,
    scriptName,
    type: scriptType,
    lifecycle: "stopped",
    terminalId,
    exitCode: null,
  });
  params.onLifecycleChanged?.();
}

// Undo whatever a failed spawn already registered: the proxy route, then the
// runtime entry (which releaseFailedScriptSpawn keeps when the terminal is
// still usable for a retry).
function rollbackFailedScriptSpawn(params: {
  error: unknown;
  routeRegistered: boolean;
  runtimeRegistered: boolean;
  serviceScript: boolean;
  scriptType: "script" | "service";
  workspaceId: string;
  scriptName: string;
  hostname: string | null;
  terminalId: string | null;
  serviceProxy: Pick<ServiceProxySubsystem, "removeServiceRoutesByHostnames">;
  runtimeStore: WorkspaceScriptRuntimeStore;
  onLifecycleChanged?: () => void;
}): void {
  if (params.routeRegistered && params.hostname) {
    params.serviceProxy.removeServiceRoutesByHostnames([params.hostname]);
  }
  if (!params.runtimeRegistered) {
    return;
  }
  releaseFailedScriptSpawn({
    error: params.error,
    serviceScript: params.serviceScript,
    scriptType: params.scriptType,
    workspaceId: params.workspaceId,
    scriptName: params.scriptName,
    terminalId: params.terminalId,
    runtimeStore: params.runtimeStore,
    onLifecycleChanged: params.onLifecycleChanged,
  });
}

export async function spawnWorkspaceScript(
  options: SpawnWorkspaceScriptOptions,
): Promise<WorktreeScriptResult> {
  const {
    repoRoot,
    workspaceId,
    projectSlug,
    branchName,
    scriptName,
    daemonPort,
    daemonListenHost,
    serviceProxyPublicBaseUrl,
    serviceProxy,
    runtimeStore,
    terminalManager,
    globalServicePorts,
    logger,
    onLifecycleChanged,
    promptReadyTimeoutMs,
  } = options;
  const configResult = readPaseoConfig(repoRoot);
  if (!configResult.ok) {
    throw paseoConfigParseError(configResult);
  }
  const scriptConfigs = getScriptConfigs(configResult.config);
  const config = scriptConfigs.get(scriptName);
  if (!config) {
    throw new Error(`Script '${scriptName}' is not configured in paseo.json`);
  }

  const serviceScript = isServiceScript(config);
  const scriptType = serviceScript ? "service" : "script";
  let hostname: string | null = null;
  let port: number | null = null;
  let runtimeRegistered = false;
  let routeRegistered = false;
  let disposeLifecycleListeners: (() => void) | null = null;
  let terminalIdForRetry: string | null = null;

  try {
    if (runtimeStore.isRunning({ workspaceId, scriptName })) {
      throw new Error(`Script '${scriptName}' is already running`);
    }

    const existingRuntimeEntry = runtimeStore.get({ workspaceId, scriptName });
    let env: Record<string, string> | undefined;
    if (serviceScript) {
      const serviceSetup = await setupServiceScriptRoute({
        repoRoot,
        scriptConfigs,
        config,
        scriptName,
        projectSlug,
        branchName,
        workspaceId,
        daemonPort,
        daemonListenHost,
        serviceProxyPublicBaseUrl,
        existingRuntimeEntry,
        serviceProxy,
        servicePortAllocation: configResult.config?.worktree?.servicePorts ?? globalServicePorts,
      });
      hostname = serviceSetup.hostname;
      port = serviceSetup.port;
      env = serviceSetup.env;
      routeRegistered = true;
    }

    const terminal = await acquireWorkspaceScriptTerminal({
      serviceScript,
      existingRuntimeEntry,
      terminalManager,
      repoRoot,
      workspaceId,
      scriptName,
      env,
    });

    terminalIdForRetry = terminal.id;
    runtimeStore.set({
      workspaceId,
      scriptName,
      type: scriptType,
      lifecycle: "running",
      terminalId: terminal.id,
      exitCode: null,
    });
    runtimeRegistered = true;

    const stopRuntimeIfCurrent = (input: { exitCode: number | null; removeRoute: boolean }) => {
      const current = runtimeStore.get({ workspaceId, scriptName });
      if (current?.terminalId !== terminal.id || current.lifecycle !== "running") {
        return;
      }

      disposeLifecycleListeners?.();
      disposeLifecycleListeners = null;

      if (input.removeRoute && hostname) {
        serviceProxy.removeWorkspaceService({ workspaceId, scriptName });
      }
      runtimeStore.set({
        workspaceId,
        scriptName,
        type: scriptType,
        lifecycle: "stopped",
        terminalId: terminal.id,
        exitCode: input.exitCode,
      });
      onLifecycleChanged?.();
      logger?.info(
        {
          scriptName,
          hostname,
          exitCode: input.exitCode,
          terminalId: terminal.id,
        },
        "Stopped worktree script",
      );
    };

    const unsubscribeExit = terminal.onExit((info) => {
      stopRuntimeIfCurrent({
        exitCode: info.exitCode,
        removeRoute: true,
      });
    });

    let unsubscribeCommandFinished: (() => void) | null = null;
    if (!serviceScript) {
      unsubscribeCommandFinished = terminal.onCommandFinished((info) => {
        stopRuntimeIfCurrent({ exitCode: info.exitCode, removeRoute: false });
      });
    }
    disposeLifecycleListeners = () => {
      unsubscribeExit();
      unsubscribeCommandFinished?.();
    };

    // Reused terminals wait too. "It printed a prompt once" says nothing about
    // now: the user may have a foreground command running in it, and typing
    // into that interleaves the script command with the command's own input.
    await waitForTerminalInputReadiness(terminal, {
      timeoutMs: promptReadyTimeoutMs ?? TERMINAL_PROMPT_READY_TIMEOUT_MS,
    });
    terminal.send({ type: "input", data: `${config.command}\r` });

    logger?.info(
      {
        scriptName,
        hostname,
        port,
        terminalId: terminal.id,
        type: scriptType,
      },
      serviceScript
        ? `Registered script proxy: ${hostname} -> 127.0.0.1:${port}`
        : "Started workspace script",
    );

    onLifecycleChanged?.();
    return {
      scriptName,
      hostname,
      port,
      terminalId: terminal.id,
    };
  } catch (error) {
    disposeLifecycleListeners?.();
    rollbackFailedScriptSpawn({
      error,
      routeRegistered,
      runtimeRegistered,
      serviceScript,
      scriptType,
      workspaceId,
      scriptName,
      hostname,
      terminalId: terminalIdForRetry,
      serviceProxy,
      runtimeStore,
      onLifecycleChanged,
    });
    logger?.error(
      {
        err: error,
        scriptName,
        repoRoot,
        branchName,
        hostname,
        port,
        command: config.command,
      },
      "Failed to spawn worktree script",
    );
    throw error;
  }
}

export function teardownWorktreeScripts(options: {
  hostnames: string[];
  serviceProxy: Pick<ServiceProxySubsystem, "removeServiceRoutesByHostnames">;
  logger: Logger;
}): void {
  const { hostnames, serviceProxy, logger } = options;
  serviceProxy.removeServiceRoutesByHostnames(hostnames);
  for (const hostname of hostnames) {
    logger.info({ hostname }, "Removed script proxy route");
  }
}
