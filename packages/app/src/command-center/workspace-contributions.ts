import { hasWorkspaceLabel } from "@getpaseo/protocol/workspace-labels";
import type { GitAction, GitActions } from "@/git/policy";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { ShortcutKey } from "@/utils/format-shortcut";
import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface WorkspaceCommandCenterLabels {
  section: string;
  newAgent: string;
  newTerminal: string;
  newBrowser: string;
  splitRight: string;
  splitDown: string;
}

export interface WorkspaceCommandCenterIcons {
  newAgent?: CommandCenterIcon;
  newTerminal?: CommandCenterIcon;
  newBrowser?: CommandCenterIcon;
  splitRight?: CommandCenterIcon;
  splitDown?: CommandCenterIcon;
  git?(action: GitAction): CommandCenterIcon | undefined;
}

export interface WorkspaceCommandCenterShortcuts {
  newAgent?: ShortcutKey[][];
  newTerminal?: ShortcutKey[][];
  splitRight?: ShortcutKey[][];
  splitDown?: ShortcutKey[][];
  archiveWorkspace?: ShortcutKey[][];
}

/**
 * One command per label the user could put on this workspace, worded for what pressing it does:
 * a label the workspace already carries offers to take it off, and every other one offers to put
 * it on. Two commands per label — one to add, one to remove — would mean half the list never does
 * anything, and the palette would answer a search for a label with a command that is a no-op.
 *
 * Absent when the host predates labels. Gating once here is the whole gate; there is no fallback
 * path (docs/protocol-compatibility.md).
 */
export interface WorkspaceCommandCenterLabelSource {
  /** Every label the user could apply, in the order the Label menu lists them. */
  known: readonly string[];
  /** What the workspace carries now, which decides each command's verb. */
  carried: readonly string[];
  /** Terms that should find any of these commands, whatever the label is called. */
  keywords: string;
  title(label: string, carried: boolean): string;
  icon?: CommandCenterIcon;
  toggle(label: string): void;
}

export interface WorkspaceCommandCenterSource {
  gitActions: GitActions;
  labels: WorkspaceCommandCenterLabels;
  workspaceLabels: WorkspaceCommandCenterLabelSource | null;
  icons: WorkspaceCommandCenterIcons;
  shortcuts: WorkspaceCommandCenterShortcuts;
  capabilities: {
    canSplitPanes: boolean;
    canOpenBrowserTabs: boolean;
  };
  dispatch(action: KeyboardActionDefinition): void;
  runGitAction(action: GitAction): void;
}

function buildGitContribution(
  source: WorkspaceCommandCenterSource,
  action: GitAction,
  rank: number,
  visibility: "always" | "query",
): CommandCenterContribution {
  return {
    id: `git:${action.id}`,
    group: "workspace",
    groupRank: -1,
    rank,
    keywords: [action.id, "git"],
    visibility,
    run: () => source.runGitAction(action),
    presentation: {
      kind: "action",
      title: action.label,
      sectionTitle: source.labels.section,
      icon: source.icons.git?.(action),
      shortcutKeys:
        action.id === "archive-workspace" ? source.shortcuts.archiveWorkspace : undefined,
    },
  };
}

function buildWorkspaceAction(input: {
  source: WorkspaceCommandCenterSource;
  id: string;
  rank: number;
  title: string;
  keywords: readonly string[];
  icon?: CommandCenterIcon;
  shortcutKeys?: ShortcutKey[][];
  action: KeyboardActionDefinition;
  visibility: "always" | "query";
}): CommandCenterContribution {
  return {
    id: input.id,
    group: "workspace",
    groupRank: -1,
    rank: input.rank,
    keywords: input.keywords,
    visibility: input.visibility,
    run: () => input.source.dispatch(input.action),
    presentation: {
      kind: "action",
      title: input.title,
      sectionTitle: input.source.labels.section,
      icon: input.icon,
      shortcutKeys: input.shortcutKeys,
    },
  };
}

export function buildWorkspaceCommandCenterContributions(
  source: WorkspaceCommandCenterSource,
): CommandCenterContribution[] {
  const contributions: CommandCenterContribution[] = [
    buildWorkspaceAction({
      source,
      id: "tab:new-agent",
      rank: 0,
      title: source.labels.newAgent,
      keywords: ["tab", "new", "agent", "chat"],
      icon: source.icons.newAgent,
      shortcutKeys: source.shortcuts.newAgent,
      action: { id: "workspace.tab.new", scope: "workspace" },
      visibility: "always",
    }),
  ];
  const primary = source.gitActions.primary;
  if (primary) contributions.push(buildGitContribution(source, primary, 1, "always"));
  contributions.push(
    buildWorkspaceAction({
      source,
      id: "tab:new-terminal",
      rank: 2,
      title: source.labels.newTerminal,
      keywords: ["terminal", "shell", "console"],
      icon: source.icons.newTerminal,
      shortcutKeys: source.shortcuts.newTerminal,
      action: { id: "workspace.terminal.new", scope: "workspace" },
      visibility: "query",
    }),
  );
  if (source.capabilities.canOpenBrowserTabs) {
    contributions.push(
      buildWorkspaceAction({
        source,
        id: "tab:new-browser",
        rank: 3,
        title: source.labels.newBrowser,
        keywords: ["browser", "web", "preview"],
        icon: source.icons.newBrowser,
        action: { id: "workspace.browser.new", scope: "workspace" },
        visibility: "query",
      }),
    );
  }
  if (source.capabilities.canSplitPanes) {
    contributions.push(
      buildWorkspaceAction({
        source,
        id: "pane:split-right",
        rank: 4,
        title: source.labels.splitRight,
        keywords: ["split", "pane", "vertical"],
        icon: source.icons.splitRight,
        shortcutKeys: source.shortcuts.splitRight,
        action: { id: "workspace.pane.split.right", scope: "workspace" },
        visibility: "query",
      }),
      buildWorkspaceAction({
        source,
        id: "pane:split-down",
        rank: 5,
        title: source.labels.splitDown,
        keywords: ["split", "pane", "horizontal"],
        icon: source.icons.splitDown,
        shortcutKeys: source.shortcuts.splitDown,
        action: { id: "workspace.pane.split.down", scope: "workspace" },
        visibility: "query",
      }),
    );
  }
  for (const [index, action] of source.gitActions.secondary.entries()) {
    if (action.id === primary?.id) continue;
    contributions.push(buildGitContribution(source, action, 10 + index, "query"));
  }
  contributions.push(...buildLabelContributions(source));
  return contributions;
}

function buildLabelContributions(
  source: WorkspaceCommandCenterSource,
): CommandCenterContribution[] {
  const labels = source.workspaceLabels;
  if (!labels) return [];
  return labels.known.map((label, index) => {
    const carried = hasWorkspaceLabel(labels.carried, label);
    return {
      id: `labels:${label.toLowerCase()}`,
      group: "workspace",
      groupRank: -1,
      rank: 20 + index,
      keywords: [labels.keywords, label],
      // Never default-visible. There is one of these per label, so a handful of them would push
      // everything the palette opens with off the first screen.
      visibility: "query",
      run: () => labels.toggle(label),
      presentation: {
        kind: "action",
        title: labels.title(label, carried),
        sectionTitle: source.labels.section,
        icon: labels.icon,
      },
    };
  });
}
