import { describe, expect, it } from "vitest";
import type { GitAction, GitActions } from "@/git/policy";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  buildWorkspaceCommandCenterContributions,
  type WorkspaceCommandCenterLabelSource,
  type WorkspaceCommandCenterSource,
} from "./workspace-contributions";

function gitAction(id: GitAction["id"], label: string): GitAction {
  return {
    id,
    label,
    pendingLabel: `${label} pending`,
    successLabel: `${label} complete`,
    disabled: false,
    status: "idle",
    startsGroup: false,
    handler: () => undefined,
  };
}

function labelSource(
  known: readonly string[],
  carried: readonly string[],
  toggled: string[],
): WorkspaceCommandCenterLabelSource {
  return {
    known,
    carried,
    keywords: "label tag unlabel",
    title: (label, isCarried) => (isCarried ? `Remove label ${label}` : `Label as ${label}`),
    toggle: (label) => toggled.push(label),
  };
}

function source(gitActions: GitActions): {
  value: WorkspaceCommandCenterSource;
  runGitActions: GitAction[];
  dispatched: KeyboardActionDefinition[];
} {
  const runGitActions: GitAction[] = [];
  const dispatched: KeyboardActionDefinition[] = [];
  return {
    value: {
      gitActions,
      workspaceLabels: null,
      labels: {
        section: "Workspace actions",
        newAgent: "New agent",
        newTerminal: "New terminal",
        newBrowser: "New browser",
        splitRight: "Split pane right",
        splitDown: "Split pane down",
      },
      icons: {},
      shortcuts: {},
      capabilities: { canSplitPanes: true, canOpenBrowserTabs: true },
      dispatch: (action) => dispatched.push(action),
      runGitAction: (action) => runGitActions.push(action),
    },
    runGitActions,
    dispatched,
  };
}

describe("workspace command center contributions", () => {
  it("makes only the policy-selected primary Git action default-visible and runs it", () => {
    const primary = gitAction("commit", "Commit");
    const fixture = source({
      primary,
      secondary: [gitAction("push", "Push")],
      menu: [],
    });

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);
    const gitContributions = contributions.filter((item) => item.id.startsWith("git:"));
    const defaultGitContributions = gitContributions.filter((item) => item.visibility === "always");

    expect(defaultGitContributions.map((item) => item.id)).toEqual(["git:commit"]);
    defaultGitContributions[0].run();
    expect(fixture.runGitActions).toEqual([primary]);
  });

  it("does not duplicate a primary action retained in the secondary policy list", () => {
    const primary = gitAction("pull", "Pull");
    const fixture = source({
      primary,
      secondary: [primary, gitAction("push", "Push")],
      menu: [],
    });

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.filter((item) => item.id === "git:pull")).toHaveLength(1);
  });

  it("orders New agent before Git and keeps terminal, browser, and splits search-only", () => {
    const fixture = source({
      primary: gitAction("commit", "Commit"),
      secondary: [],
      menu: [],
    });

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map(({ id, rank, visibility }) => ({ id, rank, visibility }))).toEqual([
      { id: "tab:new-agent", rank: 0, visibility: "always" },
      { id: "git:commit", rank: 1, visibility: "always" },
      { id: "tab:new-terminal", rank: 2, visibility: "query" },
      { id: "tab:new-browser", rank: 3, visibility: "query" },
      { id: "pane:split-right", rank: 4, visibility: "query" },
      { id: "pane:split-down", rank: 5, visibility: "query" },
    ]);
  });

  it("omits browser and split actions when their existing capabilities are unavailable", () => {
    const fixture = source({ primary: null, secondary: [], menu: [] });
    fixture.value.capabilities = { canSplitPanes: false, canOpenBrowserTabs: false };

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map((item) => item.id)).toEqual(["tab:new-agent", "tab:new-terminal"]);
  });

  it("dispatches every tab and pane command to the workspace scope", () => {
    const fixture = source({ primary: null, secondary: [], menu: [] });
    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    for (const contribution of contributions) contribution.run();

    expect(fixture.dispatched).toEqual([
      { id: "workspace.tab.new", scope: "workspace" },
      { id: "workspace.terminal.new", scope: "workspace" },
      { id: "workspace.browser.new", scope: "workspace" },
      { id: "workspace.pane.split.right", scope: "workspace" },
      { id: "workspace.pane.split.down", scope: "workspace" },
    ]);
  });

  it("keeps workspace creation commands available outside Git", () => {
    const fixture = source({ primary: null, secondary: [], menu: [] });

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.map((item) => item.id)).toEqual([
      "tab:new-agent",
      "tab:new-terminal",
      "tab:new-browser",
      "pane:split-right",
      "pane:split-down",
    ]);
    expect(contributions.some((item) => item.id.startsWith("git:"))).toBe(false);
  });

  it("words each label command by whether the workspace carries the label", () => {
    const fixture = source({ primary: null, secondary: [], menu: [] });
    fixture.value.workspaceLabels = labelSource(["Blocked", "Review"], ["blocked"], []);

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(
      contributions
        .filter((item) => item.id.startsWith("labels:"))
        .map((item) => ({
          id: item.id,
          title: item.presentation.kind === "action" ? item.presentation.title : null,
        })),
    ).toEqual([
      { id: "labels:blocked", title: "Remove label Blocked" },
      { id: "labels:review", title: "Label as Review" },
    ]);
  });

  it("toggles the label it names and never opens the palette by default", () => {
    const toggled: string[] = [];
    const fixture = source({ primary: null, secondary: [], menu: [] });
    fixture.value.workspaceLabels = labelSource(["Blocked", "Review"], [], toggled);

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value).filter((item) =>
      item.id.startsWith("labels:"),
    );

    for (const contribution of contributions) contribution.run();

    expect(toggled).toEqual(["Blocked", "Review"]);
    expect(contributions.every((item) => item.visibility === "query")).toBe(true);
  });

  it("contributes no label commands when the host cannot store labels", () => {
    const fixture = source({ primary: null, secondary: [], menu: [] });

    const contributions = buildWorkspaceCommandCenterContributions(fixture.value);

    expect(contributions.some((item) => item.id.startsWith("labels:"))).toBe(false);
  });
});
