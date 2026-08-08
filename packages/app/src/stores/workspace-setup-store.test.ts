import { beforeEach, describe, expect, it } from "vitest";
import {
  hasWorkspaceSetupFailure,
  shouldAutoCloseSetupTab,
  shouldAutoOpenSetupTab,
  shouldShowWorkspaceSetup,
  useWorkspaceSetupStore,
  WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS,
  type WorkspaceSetupSnapshot,
  type WorkspaceSetupStatusClient,
  type WorkspaceSetupStatusResult,
} from "./workspace-setup-store";

type CommandStatus = WorkspaceSetupSnapshot["detail"]["commands"][number]["status"];

const DEFAULT_SNAPSHOT: WorkspaceSetupStatusResult["snapshot"] = {
  status: "running",
  detail: {
    type: "worktree_setup",
    worktreePath: "/Users/test/project",
    branchName: "main",
    log: "",
    commands: [],
  },
  error: null,
};

function setupResult(
  workspaceId: string,
  snapshot: WorkspaceSetupStatusResult["snapshot"] = DEFAULT_SNAPSHOT,
): WorkspaceSetupStatusResult {
  return { requestId: "req-1", workspaceId, snapshot };
}

function makeClient(handler: (workspaceId: string) => Promise<WorkspaceSetupStatusResult>) {
  const calls: string[] = [];
  const client: WorkspaceSetupStatusClient = {
    fetchWorkspaceSetupStatus: (workspaceId) => {
      calls.push(workspaceId);
      return handler(workspaceId);
    },
  };
  return { client, calls };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function storedSnapshots() {
  return Object.values(useWorkspaceSetupStore.getState().snapshots);
}

function resolveDefault(workspaceId: string): Promise<WorkspaceSetupStatusResult> {
  return Promise.resolve(setupResult(workspaceId));
}

function rejectThenResolve() {
  let attempt = 0;
  return (workspaceId: string): Promise<WorkspaceSetupStatusResult> => {
    attempt += 1;
    if (attempt === 1) {
      return Promise.reject(new Error("boom"));
    }
    return resolveDefault(workspaceId);
  };
}

function nullThenResolve() {
  let attempt = 0;
  return (workspaceId: string): Promise<WorkspaceSetupStatusResult> => {
    attempt += 1;
    if (attempt === 1) {
      return Promise.resolve(setupResult(workspaceId, null));
    }
    return resolveDefault(workspaceId);
  };
}

function mismatchThenResolve() {
  let attempt = 0;
  return (workspaceId: string): Promise<WorkspaceSetupStatusResult> => {
    attempt += 1;
    if (attempt === 1) {
      return Promise.resolve(setupResult("999"));
    }
    return resolveDefault(workspaceId);
  };
}

function ensureSetupStatus(client: WorkspaceSetupStatusClient) {
  useWorkspaceSetupStore.getState().ensureSetupStatus({
    serverId: "server-1",
    workspaceId: "42",
    client,
  });
}

describe("workspace-setup-store", () => {
  beforeEach(() => {
    useWorkspaceSetupStore.setState({
      pendingWorkspaceSetup: null,
      snapshots: {},
      requestedKeys: new Set(),
    });
  });

  it("tracks deferred workspace setup by source directory and optional workspace id", () => {
    useWorkspaceSetupStore.getState().beginWorkspaceSetup({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      sourceWorkspaceId: "42",
      displayName: "project",
      creationMethod: "open_project",
    });

    expect(useWorkspaceSetupStore.getState().pendingWorkspaceSetup).toEqual({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      sourceWorkspaceId: "42",
      displayName: "project",
      creationMethod: "open_project",
    });
  });

  it("clears pending setup state", () => {
    useWorkspaceSetupStore.getState().beginWorkspaceSetup({
      serverId: "server-1",
      sourceDirectory: "/Users/test/project",
      creationMethod: "create_worktree",
    });

    useWorkspaceSetupStore.getState().clearWorkspaceSetup();

    expect(useWorkspaceSetupStore.getState().pendingWorkspaceSetup).toBeNull();
  });

  it("hides empty successful setup snapshots", () => {
    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "",
          commands: [],
        },
        error: null,
        updatedAt: Date.now(),
      }),
    ).toBe(false);
  });

  it("shows setup snapshots with commands or errors", () => {
    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "completed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "done\n",
          commands: [
            {
              index: 1,
              command: "npm install",
              cwd: "/Users/test/project",
              log: "done\n",
              status: "completed",
              exitCode: 0,
            },
          ],
        },
        error: null,
        updatedAt: Date.now(),
      }),
    ).toBe(true);

    expect(
      shouldShowWorkspaceSetup({
        workspaceId: "workspace-1",
        status: "failed",
        detail: {
          type: "worktree_setup",
          worktreePath: "/Users/test/project",
          branchName: "main",
          log: "",
          commands: [],
        },
        error: "Failed to parse paseo.json",
        updatedAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("ensureSetupStatus fetches setup status once and stores the snapshot", async () => {
    const { client, calls } = makeClient(resolveDefault);

    ensureSetupStatus(client);
    await flush();

    expect(calls).toEqual(["42"]);
    expect(storedSnapshots()).toEqual([
      expect.objectContaining({ workspaceId: "42", status: "running" }),
    ]);
  });

  it("ensureSetupStatus does not refetch while a request is in flight", async () => {
    const deferred = createDeferred<WorkspaceSetupStatusResult>();
    const { client, calls } = makeClient(() => deferred.promise);

    ensureSetupStatus(client);
    ensureSetupStatus(client);

    expect(calls).toEqual(["42"]);

    deferred.resolve(setupResult("42"));
    await flush();

    ensureSetupStatus(client);
    expect(calls).toEqual(["42"]);
  });

  it("ensureSetupStatus skips fetching when a snapshot already exists", () => {
    useWorkspaceSetupStore.getState().upsertProgress({
      serverId: "server-1",
      payload: { workspaceId: "42", ...DEFAULT_SNAPSHOT },
    });
    const { client, calls } = makeClient(resolveDefault);

    ensureSetupStatus(client);

    expect(calls).toEqual([]);
  });

  it("ensureSetupStatus ignores a response for a different workspace", async () => {
    const { client } = makeClient(() => Promise.resolve(setupResult("999")));

    ensureSetupStatus(client);
    await flush();

    expect(storedSnapshots()).toHaveLength(0);
  });

  it("ensureSetupStatus does not store a snapshot when the response snapshot is null", async () => {
    const { client } = makeClient((workspaceId) => Promise.resolve(setupResult(workspaceId, null)));

    ensureSetupStatus(client);
    await flush();

    expect(storedSnapshots()).toHaveLength(0);
  });

  it("ensureSetupStatus retries after a null-snapshot response", async () => {
    const { client, calls } = makeClient(nullThenResolve());

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42"]);
    expect(storedSnapshots()).toHaveLength(0);

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42", "42"]);
    expect(storedSnapshots()).toHaveLength(1);
  });

  it("ensureSetupStatus retries after a mismatched-workspace response", async () => {
    const { client, calls } = makeClient(mismatchThenResolve());

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42"]);
    expect(storedSnapshots()).toHaveLength(0);

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42", "42"]);
    expect(storedSnapshots()).toHaveLength(1);
  });

  it("ensureSetupStatus clears the in-flight marker on error so a later call retries", async () => {
    const { client, calls } = makeClient(rejectThenResolve());

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42"]);
    expect(storedSnapshots()).toHaveLength(0);

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42", "42"]);
    expect(storedSnapshots()).toHaveLength(1);
  });

  it("ensureSetupStatus retries after the workspace is removed", async () => {
    const { client, calls } = makeClient(resolveDefault);

    ensureSetupStatus(client);
    await flush();
    expect(calls).toEqual(["42"]);

    useWorkspaceSetupStore.getState().removeWorkspace({ serverId: "server-1", workspaceId: "42" });
    ensureSetupStatus(client);
    await flush();

    expect(calls).toEqual(["42", "42"]);
  });
});

const NOW = 1_700_000_000_000;

function makeSnapshot(input: {
  status: WorkspaceSetupSnapshot["status"];
  commandStatuses?: CommandStatus[];
  error?: string | null;
  updatedAt?: number;
}): WorkspaceSetupSnapshot {
  const commandStatuses = input.commandStatuses ?? ["completed"];
  const exitCodeFor = (status: CommandStatus): number | null => {
    if (status === "failed") return 1;
    if (status === "completed") return 0;
    return null;
  };
  return {
    workspaceId: "workspace-1",
    status: input.status,
    detail: {
      type: "worktree_setup",
      worktreePath: "/Users/test/project",
      branchName: "main",
      log: "",
      commands: commandStatuses.map((status, index) => ({
        index: index + 1,
        command: "npm install",
        cwd: "/Users/test/project",
        log: "",
        status,
        exitCode: exitCodeFor(status),
      })),
    },
    error: input.error ?? null,
    updatedAt: input.updatedAt ?? NOW,
  };
}

describe("hasWorkspaceSetupFailure", () => {
  it("is false without a snapshot", () => {
    expect(hasWorkspaceSetupFailure(null)).toBe(false);
  });

  it("is false while setup is running cleanly", () => {
    expect(hasWorkspaceSetupFailure(makeSnapshot({ status: "running" }))).toBe(false);
  });

  it("is false for a clean completed run", () => {
    expect(hasWorkspaceSetupFailure(makeSnapshot({ status: "completed" }))).toBe(false);
  });

  it("is true when the run failed", () => {
    expect(hasWorkspaceSetupFailure(makeSnapshot({ status: "failed", error: "boom" }))).toBe(true);
  });

  it("is true when a command failed before the run was marked failed", () => {
    expect(
      hasWorkspaceSetupFailure(
        makeSnapshot({ status: "running", commandStatuses: ["completed", "failed"] }),
      ),
    ).toBe(true);
  });

  it("is true when a completed run contains a failed command", () => {
    expect(
      hasWorkspaceSetupFailure(makeSnapshot({ status: "completed", commandStatuses: ["failed"] })),
    ).toBe(true);
  });
});

describe("shouldAutoOpenSetupTab", () => {
  const stale = NOW - WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS - 1;

  it("never opens without a snapshot", () => {
    for (const mode of ["always", "untilSuccess", "onFailure"] as const) {
      expect(shouldAutoOpenSetupTab({ snapshot: null, mode, now: NOW })).toBe(false);
    }
  });

  it("never opens for a snapshot with nothing to show", () => {
    const empty = makeSnapshot({ status: "completed", commandStatuses: [] });
    for (const mode of ["always", "untilSuccess", "onFailure"] as const) {
      expect(shouldAutoOpenSetupTab({ snapshot: empty, mode, now: NOW })).toBe(false);
    }
  });

  describe("always", () => {
    it("opens while setup is running, however old the snapshot looks", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "running", updatedAt: stale }),
          mode: "always",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("opens for a fresh completed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "completed" }),
          mode: "always",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("opens for a fresh failed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "failed", error: "boom" }),
          mode: "always",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("does not open for a stale completed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "completed", updatedAt: stale }),
          mode: "always",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("does not open for a stale failed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "failed", error: "boom", updatedAt: stale }),
          mode: "always",
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  describe("onFailure", () => {
    it("does not open while setup is running cleanly", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "running" }),
          mode: "onFailure",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("does not open for a clean completed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "completed" }),
          mode: "onFailure",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("opens as soon as a command fails, before the run is marked failed", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "running", commandStatuses: ["failed"] }),
          mode: "onFailure",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("opens for a failed run no matter how stale the snapshot looks", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "failed", error: "boom", updatedAt: stale }),
          mode: "onFailure",
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("untilSuccess", () => {
    it("opens while setup is running", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "running", updatedAt: stale }),
          mode: "untilSuccess",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("opens for a failed run however stale the snapshot looks", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "failed", error: "boom", updatedAt: stale }),
          mode: "untilSuccess",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("does not open for a clean completed run", () => {
      expect(
        shouldAutoOpenSetupTab({
          snapshot: makeSnapshot({ status: "completed" }),
          mode: "untilSuccess",
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  it("opens for a failed run in every mode", () => {
    const failed = makeSnapshot({ status: "failed", error: "boom", updatedAt: NOW });
    for (const mode of ["always", "untilSuccess", "onFailure"] as const) {
      expect(shouldAutoOpenSetupTab({ snapshot: failed, mode, now: NOW })).toBe(true);
    }
  });
});

describe("shouldAutoCloseSetupTab", () => {
  const completed = makeSnapshot({ status: "completed" });

  it("closes an unadopted tab once setup succeeds", () => {
    expect(
      shouldAutoCloseSetupTab({ snapshot: completed, mode: "untilSuccess", isAdopted: false }),
    ).toBe(true);
  });

  it("keeps an adopted tab open", () => {
    expect(
      shouldAutoCloseSetupTab({ snapshot: completed, mode: "untilSuccess", isAdopted: true }),
    ).toBe(false);
  });

  it("keeps the tab open while setup is still running", () => {
    expect(
      shouldAutoCloseSetupTab({
        snapshot: makeSnapshot({ status: "running" }),
        mode: "untilSuccess",
        isAdopted: false,
      }),
    ).toBe(false);
  });

  it("keeps the tab open for a failed run", () => {
    expect(
      shouldAutoCloseSetupTab({
        snapshot: makeSnapshot({ status: "failed", error: "boom" }),
        mode: "untilSuccess",
        isAdopted: false,
      }),
    ).toBe(false);
  });

  it("keeps the tab open when a completed run contains a failed command", () => {
    expect(
      shouldAutoCloseSetupTab({
        snapshot: makeSnapshot({ status: "completed", commandStatuses: ["failed"] }),
        mode: "untilSuccess",
        isAdopted: false,
      }),
    ).toBe(false);
  });

  it("closes nothing in the other modes", () => {
    for (const mode of ["always", "onFailure"] as const) {
      expect(shouldAutoCloseSetupTab({ snapshot: completed, mode, isAdopted: false })).toBe(false);
    }
  });

  it("closes nothing without a snapshot", () => {
    expect(
      shouldAutoCloseSetupTab({ snapshot: null, mode: "untilSuccess", isAdopted: false }),
    ).toBe(false);
  });
});
