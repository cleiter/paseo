import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Globe, Rows2, SquarePen, SquareTerminal, Tag } from "lucide-react-native";
import { getIsElectron } from "@/constants/platform";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import {
  useKnownWorkspaceLabels,
  useToggleWorkspaceLabel,
  useWorkspaceLabels,
  useWorkspaceLabelsSupported,
} from "@/components/sidebar/workspace-labels/model";
import { useToast } from "@/contexts/toast-context";
import { GIT_ACTION_ICONS } from "@/git/action-icons";
import { useGitActionRunner, useGitActions } from "@/git/use-actions";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import {
  resolveShortcutKeysForAction,
  type ShortcutOverrides,
} from "@/keyboard/keyboard-shortcuts";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getCommandCenterIcon } from "./icon";
import type { CommandCenterIcon } from "./contributions";
import { useCommandCenterActions } from "./provider";
import {
  buildWorkspaceCommandCenterContributions,
  type WorkspaceCommandCenterLabelSource,
  type WorkspaceCommandCenterShortcuts,
} from "./workspace-contributions";

const WORKSPACE_COMMAND_CENTER_ICONS = {
  newAgent: getCommandCenterIcon(SquarePen),
  newTerminal: getCommandCenterIcon(SquareTerminal),
  newBrowser: getCommandCenterIcon(Globe),
  splitRight: getCommandCenterIcon(Columns2),
  splitDown: getCommandCenterIcon(Rows2),
};

// One icon for both directions. The title already says which way this command goes, and the icon
// column reads as "what this is about", the same as every other command in the palette.
const LABEL_ICON = getCommandCenterIcon(Tag);

function staticIcon(element: ReactElement | undefined): CommandCenterIcon | undefined {
  if (!element) return undefined;
  function StaticIcon() {
    return element;
  }
  return StaticIcon;
}

function resolveWorkspaceShortcuts(overrides: ShortcutOverrides): WorkspaceCommandCenterShortcuts {
  const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectron() };
  return {
    newAgent: resolveShortcutKeysForAction("workspace-tab-new", overrides, platform) ?? undefined,
    newTerminal:
      resolveShortcutKeysForAction("workspace-terminal-new", overrides, platform) ?? undefined,
    splitRight:
      resolveShortcutKeysForAction("workspace-pane-split-right", overrides, platform) ?? undefined,
    splitDown:
      resolveShortcutKeysForAction("workspace-pane-split-down", overrides, platform) ?? undefined,
    archiveWorkspace:
      resolveShortcutKeysForAction("archive-workspace", overrides, platform) ?? undefined,
  };
}

/**
 * The Label menu's contents as commands, for the workspace you are looking at.
 *
 * Null when the host has not got labels, which is the one capability check — a palette that
 * offered the command and failed on press would be worse than not offering it.
 */
function useWorkspaceLabelCommands(
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceCommandCenterLabelSource | null {
  const { t } = useTranslation();
  const toast = useToast();
  const target = useMemo(
    () => (serverId && workspaceId ? { serverId, workspaceId } : null),
    [serverId, workspaceId],
  );
  const supported = useWorkspaceLabelsSupported(target);
  const known = useKnownWorkspaceLabels();
  const carried = useWorkspaceLabels(target);
  const handleError = useCallback(
    (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("sidebar.workspace.labels.failed"));
    },
    [t, toast],
  );
  const toggle = useToggleWorkspaceLabel({
    target,
    hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
    onError: handleError,
  });
  const title = useCallback(
    (label: string, isCarried: boolean) =>
      isCarried
        ? t("shell.commandCenter.labelRemove", { label })
        : t("shell.commandCenter.labelAdd", { label }),
    [t],
  );

  return useMemo(
    () =>
      target && supported
        ? {
            known,
            carried,
            keywords: t("shell.commandCenter.labelSearchKeywords"),
            title,
            icon: LABEL_ICON,
            toggle,
          }
        : null,
    [carried, known, supported, t, target, title, toggle],
  );
}

export function useWorkspaceCommandCenterActions(): void {
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const isCompact = useIsCompactFormFactor();
  const { overrides } = useKeyboardShortcutOverrides();
  const { gitActions } = useGitActions({
    serverId: serverId ?? "",
    cwd: cwd ?? "",
    icons: GIT_ACTION_ICONS,
  });
  const runGitAction = useGitActionRunner();
  const workspaceLabels = useWorkspaceLabelCommands(serverId, workspaceId);

  const actions = useMemo(
    () =>
      buildWorkspaceCommandCenterContributions({
        gitActions,
        workspaceLabels,
        labels: {
          section: t("workspace.header.actions.workspaceActions"),
          newAgent: t("workspace.tabs.actions.newAgent"),
          newTerminal: t("workspace.tabs.actions.newTerminal"),
          newBrowser: t("workspace.tabs.actions.newBrowser"),
          splitRight: t("workspace.tabs.actions.splitRight"),
          splitDown: t("workspace.tabs.actions.splitDown"),
        },
        icons: {
          ...WORKSPACE_COMMAND_CENTER_ICONS,
          git: (action) => staticIcon(action.icon),
        },
        shortcuts: resolveWorkspaceShortcuts(overrides),
        capabilities: {
          canSplitPanes: supportsDesktopPaneSplits() && !isCompact,
          canOpenBrowserTabs: getIsElectron(),
        },
        dispatch: (action) => {
          clearCommandCenterFocusRestoreElement();
          keyboardActionDispatcher.dispatch(action);
        },
        runGitAction,
      }),
    [gitActions, isCompact, overrides, runGitAction, t, workspaceLabels],
  );

  useCommandCenterActions({
    sourceId: "workspace",
    enabled: Boolean(serverId && cwd),
    actions,
  });
}

export function CommandCenterWorkspaceActions() {
  useWorkspaceCommandCenterActions();
  return null;
}
