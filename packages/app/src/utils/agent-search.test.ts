import { describe, expect, it } from "vitest";
import type {
  ProjectCheckoutLitePayload,
  ProjectPlacementPayload,
} from "@getpaseo/protocol/messages";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildAgentSearchText, filterAgentsByQuery, tokenizeQuery } from "./agent-search";

function gitCheckout(currentBranch: string | null): ProjectCheckoutLitePayload {
  return {
    cwd: "/repo",
    isGit: true,
    currentBranch,
    remoteUrl: null,
    worktreeRoot: "/repo",
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
  };
}

const notGitCheckout: ProjectCheckoutLitePayload = {
  cwd: "/repo",
  isGit: false,
  currentBranch: null,
  remoteUrl: null,
  worktreeRoot: null,
  isPaseoOwnedWorktree: false,
  mainRepoRoot: null,
};

function placement(overrides: Partial<ProjectPlacementPayload> = {}): ProjectPlacementPayload {
  return {
    projectKey: "key",
    projectName: "project",
    workspaceName: "workspace",
    checkout: gitCheckout("main"),
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AggregatedAgent> = {}): AggregatedAgent {
  return {
    id: "agent-1",
    serverId: "server-1",
    serverLabel: "server-1",
    title: null,
    status: "idle",
    lastActivityAt: new Date(0),
    cwd: "",
    provider: "claude",
    createdAt: new Date(0),
    labels: {},
    ...overrides,
  };
}

describe("buildAgentSearchText", () => {
  it("joins human-readable fields, lowercased", () => {
    const text = buildAgentSearchText(
      makeAgent({
        title: "Refactor Auth",
        cwd: "/Users/me/Code/App",
        provider: "Codex",
        projectPlacement: placement({
          projectName: "MyApp",
          workspaceName: "Feature",
          checkout: gitCheckout("fix/login"),
        }),
      }),
    );
    expect(text).toBe("refactor auth /users/me/code/app myapp feature fix/login codex");
  });

  it("omits missing projectPlacement without throwing (command-center shape)", () => {
    const text = buildAgentSearchText(
      makeAgent({ title: "Build", cwd: "/tmp/x", projectPlacement: undefined }),
    );
    expect(text).toBe("build /tmp/x claude");
  });

  it("handles null projectPlacement and a null branch", () => {
    expect(() => buildAgentSearchText(makeAgent({ projectPlacement: null }))).not.toThrow();
    const text = buildAgentSearchText(
      makeAgent({
        title: "T",
        cwd: "c",
        projectPlacement: placement({ checkout: notGitCheckout }),
      }),
    );
    // null branch is dropped by filter(Boolean); project/workspace still present
    expect(text).toContain("project");
    expect(text).not.toContain("null");
  });

  it("excludes serverLabel to avoid matching every row on a server", () => {
    const text = buildAgentSearchText(
      makeAgent({ title: "hello", cwd: "world", serverLabel: "abc123server" }),
    );
    expect(text).not.toContain("abc123server");
  });
});

describe("tokenizeQuery", () => {
  it("splits on whitespace, lowercases, drops empties", () => {
    expect(tokenizeQuery("  Foo   Bar ")).toEqual(["foo", "bar"]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("filterAgentsByQuery", () => {
  const agents = [
    makeAgent({
      id: "a",
      title: "Auth refactor",
      projectPlacement: placement({ projectName: "web", checkout: gitCheckout("fix/login") }),
    }),
    makeAgent({
      id: "b",
      title: "Docs pass",
      cwd: "/srv/docs",
      projectPlacement: placement({ projectName: "site" }),
    }),
  ];

  it("returns the same array reference for an empty query", () => {
    expect(filterAgentsByQuery(agents, "")).toBe(agents);
    expect(filterAgentsByQuery(agents, "   ")).toBe(agents);
  });

  it("matches a single token against any field, case-insensitively", () => {
    expect(filterAgentsByQuery(agents, "AUTH").map((a) => a.id)).toEqual(["a"]);
    expect(filterAgentsByQuery(agents, "docs").map((a) => a.id)).toEqual(["b"]);
  });

  it("ANDs tokens: one in title + one in branch matches the same agent", () => {
    expect(filterAgentsByQuery(agents, "auth login").map((a) => a.id)).toEqual(["a"]);
  });

  it("excludes when any token matches nothing", () => {
    expect(filterAgentsByQuery(agents, "auth nonsense")).toEqual([]);
  });

  it("matches on cwd and project name", () => {
    expect(filterAgentsByQuery(agents, "srv").map((a) => a.id)).toEqual(["b"]);
    expect(filterAgentsByQuery(agents, "web").map((a) => a.id)).toEqual(["a"]);
  });
});
