import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactElement,
  type MutableRefObject,
  type Ref,
  type ComponentProps,
  type PropsWithChildren,
} from "react";
import { useTranslation } from "react-i18next";
import { router, usePathname, type Href } from "expo-router";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";
import { type GestureType } from "react-native-gesture-handler";
import * as Clipboard from "expo-clipboard";
import {
  ExternalLink,
  Folder,
  FolderMinus,
  FolderPlus,
  GitPullRequest,
  MoreVertical,
  Plus,
  Settings,
  Trash2,
} from "lucide-react-native";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list";
import type { DraggableListDragHandleProps, DraggableListDropMeta } from "./draggable-list.types";
import {
  GroupSectionHeader,
  type SidebarGroupKind,
} from "@/components/sidebar/group-section-header";
import { SidebarRowRail } from "@/components/sidebar/sidebar-row-rail";
import { useSidebarFlatRows } from "@/sidebar/use-sidebar-flat-rows";
import {
  dragOriginForRow,
  isDraggableRow,
  UNGROUPED_PROJECTS_COLLAPSE_KEY,
  workspaceRemainderCollapseKey,
  type SidebarDragOrigin,
  type SidebarFlatRow,
  type SidebarProjectGroupHeaderRow,
  type SidebarProjectHeaderRow,
  type SidebarShowMoreRow,
  type SidebarWorkspaceGroupHeaderRow,
} from "@/sidebar/sidebar-flat-rows";
import { interpretSidebarDrop, validSlots } from "@/sidebar/sidebar-flat-drop-policy";
import { legacyDropFallback } from "@/sidebar/sidebar-flat-drop-apply";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import {
  useSidebarWorkspacePinController,
  type ToggleSidebarWorkspacePin,
} from "@/hooks/use-sidebar-workspace-pin";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProjectIcons } from "@/projects/icons";
import {
  buildNewWorkspaceRoute,
  buildProjectSettingsRoute,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  shouldShowSidebarHostLabels,
  useSidebarProjectStatusBucket,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";
import { MenuSeparator, MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectLeadingVisual } from "@/components/sidebar/project-leading-visual";
import { useToast } from "@/contexts/toast-context";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import { toWorktreeArchiveRisk } from "@/git/worktree-archive-warning";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { SidebarStatusWorkspaceList } from "@/components/sidebar/sidebar-status-list";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import {
  SidebarWorkspaceContextMenu,
  SidebarWorkspaceMenu,
} from "@/components/sidebar/sidebar-workspace-menu";
import { useLongPressDragInteraction } from "@/components/sidebar/use-long-press-drag-interaction";
import { PinnedSectionHeader } from "@/components/sidebar/pinned-section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import {
  type GroupedSidebarProject,
  type SidebarGroupRef,
  type SidebarProjectGroup,
  type SidebarWorkspaceGroup,
  useSidebarGroups,
} from "@/hooks/use-sidebar-groups";
import { createGroupId, useGroupActions, type GroupAssignment } from "@/hooks/use-group-actions";

import {
  SidebarWorkspaceRowFrame,
  SidebarWorkspaceRowContent,
  SidebarWorkspaceShortcutBadge,
  resolveTrailingActionVisibility,
  SidebarWorkspaceTrailingActionBase,
  SidebarWorkspaceTrailingActionOverlay,
  SidebarWorkspaceTrailingActionSlot,
} from "@/components/sidebar/sidebar-workspace-row-content";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import { selectWorkspaceServiceSummary } from "@/components/sidebar/workspace-meta-row";
import {
  SidebarWorkspaceTrailingContent,
  useSidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useClearWorkspaceAttention } from "@/hooks/use-clear-workspace-attention";
import type { PrHint } from "@/git/use-pr-status-query";
import {
  buildSidebarProjectRowModel,
  resolveSidebarProjectIconTargets,
  resolveSidebarProjectLocalPath,
  type SidebarProjectHostTarget,
} from "@/utils/sidebar-project-row-model";
import { redirectIfArchivingActiveWorkspace } from "@/utils/sidebar-workspace-archive-redirect";
import { openExternalUrl } from "@/utils/open-external-url";
import { requireWorkspaceDirectory } from "@/utils/workspace-directory";
import { useWorkspaceArchive } from "@/workspace/use-workspace-archive";
import {
  getCurrentProjectRemoveReadiness,
  removeProjectFromHosts,
} from "@/projects/project-remove";
import {
  isWeb as platformIsWeb,
  isNative as platformIsNative,
  getIsElectron,
} from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import type { HostBadgeModel } from "@/hosts/appearance";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";

const WORKSPACE_STATUS_DOT_WIDTH = 14;
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedPlus = withUnistyles(Plus);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedSettings = withUnistyles(Settings);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const redColorMapping = (theme: Theme) => ({
  color: theme.colors.statusDanger,
});
const greenColorMapping = (theme: Theme) => ({
  color: theme.colors.statusSuccess,
});
const purpleColorMapping = (theme: Theme) => ({
  color: theme.colors.statusMerged,
});

function getPrIconUniMapping(state: PrHint["state"]) {
  switch (state) {
    case "merged":
      return purpleColorMapping;
    case "open":
      return greenColorMapping;
    case "closed":
      return redColorMapping;
  }
}

function isWorkspaceSelected(input: {
  selection: ActiveWorkspaceSelection | null;
  serverId: string | null;
  workspaceId: string;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.selection?.serverId === input.serverId &&
    input.selection.workspaceId === input.workspaceId
  );
}

function isProjectSelectedByRoute(input: {
  selection: ActiveWorkspaceSelection | null;
  project: SidebarProjectEntry;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.project.workspaces.some(
      (workspace) =>
        workspace.serverId === input.selection?.serverId &&
        workspace.workspaceId === input.selection.workspaceId,
    )
  );
}

function activeWorkspaceSelectionKey(selection: ActiveWorkspaceSelection | null): string {
  return selection ? `${selection.serverId}:${selection.workspaceId}` : "";
}

function selectionForSelectedWorkspace(
  selected: boolean,
  workspace: SidebarWorkspaceEntry,
): ActiveWorkspaceSelection | null {
  return selected ? { serverId: workspace.serverId, workspaceId: workspace.workspaceId } : null;
}

interface SidebarWorkspaceListProps {
  statusGroups: StatusGroup[];
  pinnedGroups: PinnedSidebarGroups;
  projects: SidebarProjectEntry[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  collapsedProjectKeys: ReadonlySet<string>;
  onToggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  groupMode: "project" | "status";
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onWorkspacePress?: () => void;
  onAddProject?: () => void;
  listFooterComponent?: ReactElement | null;
  // Rendered inside the scroll area, below the Pinned section and above the workspace
  // list. Holds the "Workspaces" section header so pinned items sit above it.
  listHeaderComponent?: ReactElement | null;
  /** Gesture ref for coordinating with parent gestures (e.g., sidebar close) */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  dragGestureHostPresented?: boolean;
}

interface ProjectHeaderRowProps {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  statusBucket: SidebarStateBucket | null;
  selected?: boolean;
  chevron: "expand" | "collapse" | null;
  onPress: () => void;
  worktreeTarget: SidebarProjectHostTarget | null;
  isProjectActive?: boolean;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  drag: () => void;
  isDragging: boolean;
  isArchiving?: boolean;
  menuController: ReturnType<typeof useContextMenu> | null;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending";
  groupMenu?: ProjectGroupMenu;
  onNewWorkspaceGroup?: () => void;
  dragHandleProps?: DraggableListDragHandleProps;
}

interface WorkspaceRowInnerProps {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  isArchiving: boolean;
  isCreating?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  menuController: ReturnType<typeof useContextMenu> | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  // The groups that already exist in this workspace's project, so the menu can offer
  // them as move targets. Empty until the user makes their first group.
  availableGroups?: SidebarGroupRef[];
  currentGroupId?: string | null;
  reserveIdleStatusIndicatorSpace?: boolean;
}

export function PrBadge({ hint, style }: { hint: PrHint; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(hint.url);
    },
    [hint.url],
  );

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  // Callers that place the badge in a list of icon+text rows pass that row's layout in, so the
  // icon and text land on the same rails as their neighbors instead of on the badge's tighter
  // inline spacing.
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      prBadgeStyles.badge,
      style,
      pressed && prBadgeStyles.badgePressed,
    ],
    [style],
  );

  const textStyle = isHovered
    ? [prBadgeStyles.text, prBadgeStyles.textHovered]
    : prBadgeStyles.text;
  const iconUniProps = isHovered ? foregroundColorMapping : getPrIconUniMapping(hint.state);
  const presentation = getForgePresentation(normalizeForge(hint.forge));

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("workspace.git.pr.accessibility.pullRequest", {
        number: hint.number,
        context: presentation.changeRequestContext,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      {isHovered ? (
        <ThemedExternalLink size={12} uniProps={iconUniProps} />
      ) : (
        <ThemedGitPullRequest size={12} uniProps={iconUniProps} />
      )}
      <Text style={textStyle} numberOfLines={1}>
        {hint.number}
      </Text>
    </Pressable>
  );
}

function projectKebabStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.projectKebabButton, hovered && styles.projectKebabButtonHovered];
}

function getProjectWorkspaceRowStyle({
  isDragging,
  selected,
  isHovered,
}: {
  isDragging: boolean;
  selected: boolean;
  isHovered: boolean;
}) {
  return [
    styles.workspaceRow,
    isDragging && styles.workspaceRowDragging,
    selected && styles.sidebarRowSelected,
    isHovered && styles.workspaceRowHovered,
  ];
}

function noop() {}

const prBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  badgePressed: {
    opacity: 0.82,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  textHovered: {
    color: theme.colors.foreground,
  },
}));

function ProjectRowTrailingActions({
  projectViewKey,
  displayName,
  worktreeTarget,
  settingsTarget,
  projectPath,
  isHovered,
  isMobileBreakpoint,
  isProjectActive,
  onBeginWorkspaceSetup,
  onRemoveProject,
  removeProjectStatus,
  groupMenu,
  onNewWorkspaceGroup,
}: {
  projectViewKey: string;
  displayName: string;
  groupMenu?: ProjectGroupMenu;
  onNewWorkspaceGroup?: () => void;
  worktreeTarget: SidebarProjectHostTarget | null;
  settingsTarget: { serverId: string; projectId: string } | null;
  projectPath: string;
  isHovered: boolean;
  isMobileBreakpoint: boolean;
  isProjectActive: boolean;
  onBeginWorkspaceSetup: () => void;
  onRemoveProject?: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
}) {
  const actionsVisible = isHovered || platformIsNative || isMobileBreakpoint;
  return (
    <View style={styles.projectTrailingActions}>
      {worktreeTarget ? (
        <NewWorktreeButton
          displayName={displayName}
          onPress={onBeginWorkspaceSetup}
          visible={actionsVisible}
          showShortcutHint={isProjectActive}
          testID={`sidebar-project-new-worktree-${projectViewKey}`}
        />
      ) : null}
      {onRemoveProject ? (
        <View
          style={!actionsVisible && styles.projectKebabButtonHidden}
          pointerEvents={actionsVisible ? "auto" : "none"}
        >
          <ProjectKebabMenu
            projectViewKey={projectViewKey}
            settingsTarget={settingsTarget}
            projectPath={projectPath}
            onRemoveProject={onRemoveProject}
            removeProjectStatus={removeProjectStatus}
            groupMenu={groupMenu}
            onNewWorkspaceGroup={onNewWorkspaceGroup}
          />
        </View>
      ) : null}
    </View>
  );
}

const trash2LeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;
const settingsLeadingIcon = <ThemedSettings size={14} uniProps={foregroundMutedColorMapping} />;
// Every group this file names is a PROJECT group, so they all carry the Folder. Layers
// belongs to workspace groups, which live in the workspace row's menu.
const ThemedFolderIcon = withUnistyles(Folder);
const ThemedFolderPlusIcon = withUnistyles(FolderPlus);
const ThemedFolderMinusIcon = withUnistyles(FolderMinus);
const folderLeadingIcon = <ThemedFolderIcon size={14} uniProps={foregroundMutedColorMapping} />;
const folderPlusLeadingIcon = (
  <ThemedFolderPlusIcon size={14} uniProps={foregroundMutedColorMapping} />
);
const folderMinusLeadingIcon = (
  <ThemedFolderMinusIcon size={14} uniProps={foregroundMutedColorMapping} />
);
const openInNewWindowLeadingIcon = (
  <ThemedExternalLink size={14} uniProps={foregroundMutedColorMapping} />
);

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

// Bundled so the six group props don't have to be threaded one-by-one through
// ProjectBlock -> ProjectHeaderRow -> ProjectRowTrailingActions -> ProjectKebabMenu.
// Undefined means this project's hosts can't group (old daemon), so the whole
// submenu is withheld rather than shown broken.
export interface ProjectGroupMenu {
  availableGroups: SidebarGroupRef[];
  currentGroupId: string | null;
  onMoveToGroup: (group: SidebarGroupRef) => void;
  onMoveToNewGroup: () => void;
  onRemoveFromGroup: () => void;
}

// Binds one project group to its own onSelect so the menu doesn't build a fresh
// closure per group on every render.
function MoveProjectToGroupItem({
  surface,
  projectViewKey,
  group,
  selected,
  onMoveToGroup,
}: {
  surface: ProjectMenuSurface;
  projectViewKey: string;
  group: SidebarGroupRef;
  selected: boolean;
  onMoveToGroup: (group: SidebarGroupRef) => void;
}) {
  const handleSelect = useCallback(() => {
    onMoveToGroup(group);
  }, [onMoveToGroup, group]);

  return (
    <ProjectMenuItem
      surface={surface}
      testID={`sidebar-project-menu-move-to-group-${projectViewKey}-${group.groupId}`}
      leading={folderLeadingIcon}
      selected={selected}
      onSelect={handleSelect}
    >
      {group.groupName}
    </ProjectMenuItem>
  );
}

// The project groups are a PAGE, reached from a root row that reads as the current group.
// Undefined when this project's hosts cannot hold a layout at all, so the row is withheld
// rather than shown broken. See docs/menus.md.
const PROJECT_GROUP_PAGE_ID = "projectGroup";

function useProjectGroupPages(
  surface: ProjectMenuSurface,
  projectViewKey: string,
  groupMenu: ProjectGroupMenu | undefined,
): MenuPageDefinition[] | undefined {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!groupMenu) {
      return undefined;
    }
    return [
      {
        id: PROJECT_GROUP_PAGE_ID,
        title: t("sidebar.projectGroup.moveToGroup"),
        content: (
          <>
            {groupMenu.availableGroups.map((group) => (
              <MoveProjectToGroupItem
                key={group.groupId}
                surface={surface}
                projectViewKey={projectViewKey}
                group={group}
                selected={group.groupId === groupMenu.currentGroupId}
                onMoveToGroup={groupMenu.onMoveToGroup}
              />
            ))}
            {groupMenu.availableGroups.length > 0 ? <MenuSeparator /> : null}
            {/* Without this the whole project-grouping stack is unreachable: rename and
                delete can only act on a group that already exists, so nothing could ever
                create the first one. */}
            <ProjectMenuItem
              surface={surface}
              testID={`sidebar-project-menu-new-group-${projectViewKey}`}
              leading={folderPlusLeadingIcon}
              onSelect={groupMenu.onMoveToNewGroup}
            >
              {t("sidebar.projectGroup.moveToNewGroup")}
            </ProjectMenuItem>
            {groupMenu.currentGroupId ? (
              <ProjectMenuItem
                surface={surface}
                testID={`sidebar-project-menu-remove-from-group-${projectViewKey}`}
                leading={folderMinusLeadingIcon}
                onSelect={groupMenu.onRemoveFromGroup}
              >
                {t("sidebar.projectGroup.removeFromGroup")}
              </ProjectMenuItem>
            ) : null}
          </>
        ),
      },
    ];
  }, [t, surface, projectViewKey, groupMenu]);
}

function ProjectKebabMenu({
  projectViewKey,
  settingsTarget,
  projectPath,
  onRemoveProject,
  removeProjectStatus,
  groupMenu,
  onNewWorkspaceGroup,
}: {
  projectViewKey: string;
  settingsTarget: { serverId: string; projectId: string } | null;
  projectPath: string;
  onRemoveProject: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
  groupMenu?: ProjectGroupMenu;
  onNewWorkspaceGroup?: () => void;
}) {
  const { t } = useTranslation();
  const groupPages = useProjectGroupPages("dropdown", projectViewKey, groupMenu);
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        hitSlop={8}
        style={projectKebabStyle}
        accessibilityRole={platformIsWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.project.actions.menu")}
        testID={`sidebar-project-kebab-${projectViewKey}`}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={220}
        pages={groupPages}
        sheetTitle={t("sidebar.project.actions.menu")}
      >
        <ProjectMenuItems
          surface="dropdown"
          projectViewKey={projectViewKey}
          settingsTarget={settingsTarget}
          projectPath={projectPath}
          onRemoveProject={onRemoveProject}
          removeProjectStatus={removeProjectStatus}
          groupMenu={groupMenu}
          onNewWorkspaceGroup={onNewWorkspaceGroup}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ProjectMenuSurface = "context" | "dropdown";

function ProjectMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: ProjectMenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function ProjectMenuItems({
  surface,
  projectViewKey,
  settingsTarget,
  projectPath,
  onRemoveProject,
  removeProjectStatus,
  groupMenu,
  onNewWorkspaceGroup,
}: {
  surface: ProjectMenuSurface;
  projectViewKey: string;
  settingsTarget: { serverId: string; projectId: string } | null;
  projectPath: string;
  onRemoveProject: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
  groupMenu?: ProjectGroupMenu;
  // Creates an EMPTY workspace group in this project. Until now a group could only be
  // born by moving something into it, which is backwards: you group the things you
  // already have, but you also want somewhere to put the next one.
  onNewWorkspaceGroup?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const handleOpenProjectSettings = useCallback(() => {
    if (!settingsTarget) return;
    router.navigate(buildProjectSettingsRoute(settingsTarget.serverId, settingsTarget.projectId));
  }, [settingsTarget]);
  const canOpenInNewWindow = getIsElectron() && projectPath.trim().length > 0;
  const handleOpenInNewWindow = useCallback(() => {
    const trimmedPath = projectPath.trim();
    if (trimmedPath.length === 0) return;
    void getDesktopHost()
      ?.window?.openNew?.({ pendingOpenProjectPath: trimmedPath })
      ?.catch((error) => {
        console.warn("[sidebar] openNew failed", error);
        toast.error(t("sidebar.project.actions.openNewWindowFailed"));
      });
  }, [projectPath, t, toast]);

  return (
    <>
      {settingsTarget ? (
        <ProjectMenuItem
          surface={surface}
          testID={`sidebar-project-menu-open-settings-${projectViewKey}`}
          leading={settingsLeadingIcon}
          onSelect={handleOpenProjectSettings}
        >
          {t("sidebar.project.actions.openSettings")}
        </ProjectMenuItem>
      ) : null}
      {canOpenInNewWindow ? (
        <ProjectMenuItem
          surface={surface}
          testID={`sidebar-project-menu-open-new-window-${projectViewKey}`}
          leading={openInNewWindowLeadingIcon}
          onSelect={handleOpenInNewWindow}
        >
          {t("sidebar.project.actions.openNewWindow")}
        </ProjectMenuItem>
      ) : null}
      <OpenInFileManagerMenuItem
        surface={surface}
        path={projectPath}
        testID={`sidebar-project-menu-open-folder-${projectViewKey}`}
      />
      {groupMenu ? (
        <MenuSubTrigger
          id={PROJECT_GROUP_PAGE_ID}
          value={
            groupMenu.availableGroups.find((group) => group.groupId === groupMenu.currentGroupId)
              ?.groupName
          }
          testID={`sidebar-project-menu-move-to-group-${projectViewKey}`}
        >
          {t("sidebar.projectGroup.moveToGroup")}
        </MenuSubTrigger>
      ) : null}
      {onNewWorkspaceGroup ? (
        <ProjectMenuItem
          surface={surface}
          testID={`sidebar-project-menu-new-workspace-group-${projectViewKey}`}
          leading={folderPlusLeadingIcon}
          onSelect={onNewWorkspaceGroup}
        >
          {t("sidebar.workspaceGroup.newGroup")}
        </ProjectMenuItem>
      ) : null}
      <ProjectMenuItem
        surface={surface}
        testID={`sidebar-project-menu-remove-${projectViewKey}`}
        leading={trash2LeadingIcon}
        status={removeProjectStatus}
        pendingLabel={t("sidebar.project.actions.removing")}
        onSelect={onRemoveProject}
      >
        {t("sidebar.project.actions.remove")}
      </ProjectMenuItem>
    </>
  );
}

function WorkspaceRowRightGroup({
  workspace,
  isHovered,
  isTouchPlatform,
  isCreating,
  showShortcutBadge,
  shortcutNumber,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onArchive,
  onMarkAsRead,
  onCopyBranchName,
  onCopyPath,
  onRename,
  isPinned,
  onTogglePin,
  availableGroups,
  currentGroupId,
  onMoveToGroup,
  onMoveToNewGroup,
  onRemoveFromGroup,
}: {
  workspace: SidebarWorkspaceEntry;
  availableGroups?: SidebarGroupRef[];
  // Which group this row currently sits in. It comes from the layout document via the
  // section that renders the row, not from the workspace record — a workspace does not
  // know what group it is in, the document does.
  currentGroupId?: string | null;
  onMoveToGroup?: (group: SidebarGroupRef) => void;
  onMoveToNewGroup?: () => void;
  onRemoveFromGroup?: () => void;
  isHovered: boolean;
  isTouchPlatform: boolean;
  isCreating: boolean;
  showShortcutBadge: boolean;
  shortcutNumber: number | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  onArchive?: () => void;
  onMarkAsRead?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
}) {
  const workspacePath = workspace.workspaceDirectory ?? workspace.projectRootPath;
  const { t } = useTranslation();
  const trailing = useSidebarWorkspaceTrailing();
  const showShortcut = showShortcutBadge && shortcutNumber !== null;
  const {
    showTrailing,
    showKebab: showKebabInSlot,
    showScrim,
    renderSlot,
    reserveSlotWidth,
  } = resolveTrailingActionVisibility({
    workspace,
    trailing,
    hasArchiveAction: Boolean(onArchive),
    isHovered,
    isTouchPlatform,
    showShortcut,
  });
  const kebab = useOpenKebabMenuVisibility(showKebabInSlot);

  return (
    <>
      {isCreating ? (
        <Text style={styles.workspaceCreatingText}>{t("sidebar.workspace.status.creating")}</Text>
      ) : null}
      {renderSlot ? (
        <SidebarWorkspaceTrailingActionSlot reserveWidth={reserveSlotWidth}>
          <SidebarWorkspaceTrailingActionBase visible={showTrailing}>
            <SidebarWorkspaceTrailingContent workspace={workspace} trailing={trailing} />
          </SidebarWorkspaceTrailingActionBase>
          <SidebarWorkspaceTrailingActionOverlay visible={kebab.showKebab} scrim={showScrim}>
            {onArchive ? (
              <SidebarWorkspaceMenu
                {...kebab.menuProps}
                workspaceKey={workspace.workspaceKey}
                onCopyPath={onCopyPath}
                onCopyBranchName={onCopyBranchName}
                onRename={onRename}
                onMarkAsRead={onMarkAsRead}
                onArchive={onArchive}
                archiveLabel={archiveLabel}
                archiveStatus={archiveStatus}
                archivePendingLabel={archivePendingLabel}
                archiveShortcutKeys={archiveShortcutKeys}
                isPinned={isPinned}
                onTogglePin={onTogglePin}
                openInFileManagerPath={workspacePath}
                availableGroups={availableGroups}
                currentGroupId={currentGroupId ?? null}
                onMoveToGroup={onMoveToGroup}
                onMoveToNewGroup={onMoveToNewGroup}
                onRemoveFromGroup={onRemoveFromGroup}
              />
            ) : null}
          </SidebarWorkspaceTrailingActionOverlay>
        </SidebarWorkspaceTrailingActionSlot>
      ) : null}
    </>
  );
}

function NewWorktreeButton({
  displayName,
  onPress,
  visible,
  loading = false,
  testID,
  showShortcutHint = false,
}: {
  displayName: string;
  onPress: () => void;
  visible: boolean;
  loading?: boolean;
  testID: string;
  showShortcutHint?: boolean;
}) {
  const { t } = useTranslation();
  const newWorktreeKeys = useShortcutKeys("new-worktree");

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.projectIconActionButton,
      !visible && styles.projectIconActionButtonHidden,
      (Boolean(hovered) || pressed) && !loading && styles.projectIconActionButtonHovered,
    ],
    [visible, loading],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <View style={styles.projectTrailingControlSlot} pointerEvents={visible ? "auto" : "none"}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild disabled={!visible}>
          <Pressable
            style={pressableStyle}
            onPress={handlePress}
            disabled={loading}
            accessibilityRole={platformIsWeb ? undefined : "button"}
            accessibilityLabel={t("sidebar.workspace.actions.createWorkspaceFor", {
              projectName: displayName,
            })}
            testID={testID}
          >
            {({ hovered, pressed }) =>
              loading ? (
                <ThemedLoadingSpinner size={14} uniProps={foregroundMutedColorMapping} />
              ) : (
                <ThemedPlus
                  size={15}
                  uniProps={
                    hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                  }
                />
              )
            }
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.projectActionTooltipRow}>
            <Text style={styles.projectActionTooltipText}>
              {t("sidebar.workspace.actions.newWorkspace")}
            </Text>
            {showShortcutHint && newWorktreeKeys ? (
              <Shortcut chord={newWorktreeKeys} style={styles.projectActionTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function NewWorkspaceGhostRow({
  project,
  displayName,
  worktreeTarget,
  onWorkspacePress,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  worktreeTarget: SidebarProjectHostTarget;
  onWorkspacePress?: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onWorkspacePress?.();
    router.navigate(
      buildNewWorkspaceRoute({
        serverId: worktreeTarget.serverId,
        sourceDirectory: worktreeTarget.iconWorkingDir,
        displayName,
        projectId: worktreeTarget.projectId,
      }) as Href,
    );
  }, [displayName, onWorkspacePress, worktreeTarget]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.newWorkspaceGhostRow,
      hovered && !pressed && styles.newWorkspaceGhostRowHovered,
      pressed && styles.newWorkspaceGhostRowPressed,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole={platformIsWeb ? undefined : "button"}
      accessibilityLabel={t("sidebar.workspace.actions.createWorkspaceFor", {
        projectName: displayName,
      })}
      onPress={handlePress}
      style={rowStyle}
      testID={`sidebar-project-new-workspace-row-${project.viewKey}`}
    >
      {({ hovered, pressed }) => (
        <>
          <View style={styles.newWorkspaceGhostIconSlot}>
            <ThemedPlus
              size={14}
              uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </View>
          <Text
            style={
              hovered || pressed
                ? styles.newWorkspaceGhostTextHovered
                : styles.newWorkspaceGhostText
            }
            numberOfLines={1}
          >
            {t("sidebar.workspace.actions.newWorkspace")}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function ProjectHeaderRow({
  project,
  displayName,
  iconDataUri,
  statusBucket,
  selected = false,
  chevron,
  onPress,
  worktreeTarget,
  isProjectActive = false,
  onWorkspacePress,
  onWorktreeCreated: _onWorktreeCreated,
  shortcutNumber = null,
  showShortcutBadge = false,
  drag,
  isDragging,
  isArchiving = false,
  menuController,
  onRemoveProject,
  removeProjectStatus = "idle",
  groupMenu,
  onNewWorkspaceGroup,
  dragHandleProps,
}: ProjectHeaderRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const isMobileBreakpoint = useIsCompactFormFactor();
  const localDaemonServerId = useLocalDaemonServerId();
  const projectPath = resolveSidebarProjectLocalPath(project, localDaemonServerId);
  const settingsTarget = project.hosts[0] ?? null;
  // The row's own context menu declares the same page the kebab does — pages are data on
  // a surface, and these are two surfaces.
  const contextGroupPages = useProjectGroupPages("context", project.viewKey, groupMenu);
  const handleBeginWorkspaceSetup = useCallback(() => {
    if (!worktreeTarget) {
      return;
    }
    onWorkspacePress?.();
    router.navigate(
      buildNewWorkspaceRoute({
        serverId: worktreeTarget.serverId,
        sourceDirectory: worktreeTarget.iconWorkingDir,
        displayName,
        projectId: worktreeTarget.projectId,
      }) as Href,
    );
  }, [displayName, onWorkspacePress, worktreeTarget]);
  const interaction = useLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);

  const projectRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.projectRow,
      isDragging && styles.projectRowDragging,
      selected && styles.sidebarRowSelected,
      isHovered && styles.projectRowHovered,
      pressed && styles.projectRowPressed,
    ],
    [isDragging, selected, isHovered],
  );

  const rowChildren = (
    <>
      <View style={styles.projectRowLeft}>
        <ProjectLeadingVisual
          displayName={displayName}
          iconDataUri={iconDataUri}
          statusBucket={statusBucket}
          projectViewKey={project.viewKey}
          backdrop={getSidebarRowBackdrop({ isDragging, selected, isHovered })}
          chevron={chevron}
          showChevron={isHovered && chevron !== null}
          isArchiving={isArchiving}
        />

        <View style={styles.projectTitleGroup}>
          <Text style={styles.projectTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
      </View>
      <ProjectRowTrailingActions
        projectViewKey={project.viewKey}
        displayName={displayName}
        groupMenu={groupMenu}
        onNewWorkspaceGroup={onNewWorkspaceGroup}
        worktreeTarget={worktreeTarget}
        settingsTarget={settingsTarget}
        projectPath={projectPath}
        isHovered={isHovered}
        isMobileBreakpoint={isMobileBreakpoint}
        isProjectActive={isProjectActive}
        onBeginWorkspaceSetup={handleBeginWorkspaceSetup}
        onRemoveProject={onRemoveProject}
        removeProjectStatus={removeProjectStatus}
      />
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.projectShortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </>
  );

  if (!onRemoveProject) {
    return (
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <PressHighlight
          accessibilityRole="button"
          style={projectRowStyle}
          highlightStyle={styles.projectRowHovered}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-project-row-${project.viewKey}`}
        >
          {rowChildren}
        </PressHighlight>
      </View>
    );
  }

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={handleContextMenuOpenChange}>
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenuTrigger
          enabledOnMobile={false}
          accessibilityRole="button"
          style={projectRowStyle}
          highlightStyle={styles.projectRowHovered}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-project-row-${project.viewKey}`}
        >
          {rowChildren}
        </ContextMenuTrigger>
      </View>
      <ContextMenuContent
        align="start"
        width={220}
        pages={contextGroupPages}
        testID={`sidebar-project-context-menu-${project.viewKey}`}
      >
        <ProjectMenuItems
          surface="context"
          projectViewKey={project.viewKey}
          settingsTarget={settingsTarget}
          projectPath={projectPath}
          onRemoveProject={onRemoveProject}
          removeProjectStatus={removeProjectStatus}
          groupMenu={groupMenu}
          onNewWorkspaceGroup={onNewWorkspaceGroup}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WorkspaceRowInner({
  workspace,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  isArchiving,
  isCreating = false,
  dragHandleProps,
  menuController,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  availableGroups,
  currentGroupId,
  onMoveToGroup,
  onMoveToNewGroup,
  onRemoveFromGroup,
  reserveIdleStatusIndicatorSpace = true,
}: WorkspaceRowInnerProps & {
  onMoveToGroup?: (group: SidebarGroupRef) => void;
  onMoveToNewGroup?: () => void;
  onRemoveFromGroup?: () => void;
}) {
  const _isCompact = useIsCompactFormFactor();
  const isTouchPlatform = platformIsNative;
  const interaction = useLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <SidebarWorkspaceRowFrame workspace={workspace} isDragging={isDragging}>
      {({ isHovered, contextMenuOpen, onContextMenuOpenChange, hoverHandlers }) => {
        const isDesktop = !isTouchPlatform;
        const serviceSummary = isDesktop ? selectWorkspaceServiceSummary(workspace.scripts) : null;
        const workspaceRowStyle = getProjectWorkspaceRowStyle({
          isDragging,
          selected,
          isHovered,
        });
        return (
          <View
            {...dragAttributes}
            {...dragHandleProps?.listeners}
            ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
            style={styles.workspaceRowContainer}
            {...hoverHandlers}
          >
            <SidebarWorkspaceContextMenu
              contextMenuOpen={contextMenuOpen}
              onContextMenuOpenChange={onContextMenuOpenChange}
              workspace={workspace}
              leadingProjectName={leadingProjectName}
              hostBadgeLabel={hostBadge?.label}
              workspaceKey={workspace.workspaceKey}
              onCopyPath={onCopyPath}
              onCopyBranchName={onCopyBranchName}
              onRename={onRename}
              onArchive={onArchive}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              isPinned={isPinned}
              onTogglePin={onTogglePin}
              openInFileManagerPath={workspace.workspaceDirectory}
              disabled={isArchiving}
              aria-selected={selected}
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              style={workspaceRowStyle}
              highlightStyle={styles.workspaceRowHovered}
              onPressIn={interaction.handlePressIn}
              onTouchMove={interaction.handleTouchMove}
              onPressOut={interaction.handlePressOut}
              onPress={handlePress}
              testID={`sidebar-workspace-row-${workspace.workspaceKey}`}
            >
              <SidebarWorkspaceRowContent
                workspace={workspace}
                hostBadge={hostBadge}
                leadingProjectName={leadingProjectName}
                leadingProjectIconDataUri={leadingProjectIconDataUri}
                serviceSummary={serviceSummary}
                backdrop={getSidebarRowBackdrop({ isDragging, selected, isHovered })}
                isHovered={isHovered}
                isLoading={isArchiving || isCreating}
                isCreating={isCreating}
                shortcutNumber={shortcutNumber}
                showShortcutBadge={showShortcutBadge}
                reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
              >
                <WorkspaceRowRightGroup
                  workspace={workspace}
                  isHovered={isHovered}
                  isTouchPlatform={isTouchPlatform}
                  isCreating={isCreating}
                  showShortcutBadge={showShortcutBadge}
                  shortcutNumber={shortcutNumber}
                  archiveLabel={archiveLabel}
                  archiveStatus={archiveStatus}
                  archivePendingLabel={archivePendingLabel}
                  archiveShortcutKeys={archiveShortcutKeys}
                  onArchive={onArchive}
                  onCopyBranchName={onCopyBranchName}
                  onCopyPath={onCopyPath}
                  onRename={onRename}
                  isPinned={isPinned}
                  onTogglePin={onTogglePin}
                  availableGroups={availableGroups}
                  currentGroupId={currentGroupId ?? null}
                  onMoveToGroup={onMoveToGroup}
                  onMoveToNewGroup={onMoveToNewGroup}
                  onRemoveFromGroup={onRemoveFromGroup}
                />
              </SidebarWorkspaceRowContent>
            </SidebarWorkspaceContextMenu>
          </View>
        );
      }}
    </SidebarWorkspaceRowFrame>
  );
}

function WorkspaceRowWithMenu({
  workspace,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  canPin,
  canGroup,
  availableGroups,
  currentGroupId,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  isCreating = false,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  canGroup?: boolean;
  availableGroups?: SidebarGroupRef[];
  currentGroupId?: string | null;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  isCreating?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHidingWorkspace, setIsHidingWorkspace] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const isArchiving = workspace.archivingAt !== null || isHidingWorkspace;
  const redirectAfterArchive = useCallback(() => {
    redirectIfArchivingActiveWorkspace({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      activeWorkspaceSelection: selectionForSelectedWorkspace(selected, workspace),
    });
  }, [selected, workspace]);

  const archiveController = useWorkspaceArchive({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
    workspaceKind: workspace.workspaceKind,
    name: workspace.name,
    ...toWorktreeArchiveRisk(workspace),
    onArchiveStarted: redirectAfterArchive,
    onSetHiding: setIsHidingWorkspace,
  });

  const handleArchive = useCallback(() => {
    if (isArchiving) {
      return;
    }
    archiveController.archive();
  }, [archiveController, isArchiving]);

  const handleCopyPath = useCallback(() => {
    let copyTargetDirectory: string;
    try {
      copyTargetDirectory = requireWorkspaceDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("sidebar.workspace.toasts.workspacePathUnavailable"),
      );
      return;
    }
    void Clipboard.setStringAsync(copyTargetDirectory);
    toast.copied(t("sidebar.workspace.toasts.pathCopied"));
  }, [t, toast, workspace.workspaceDirectory, workspace.workspaceId]);

  const handleCopyBranchName = useCallback(() => {
    if (!workspace.currentBranch) {
      return;
    }
    void Clipboard.setStringAsync(workspace.currentBranch);
    toast.copied(t("sidebar.workspace.toasts.branchNameCopied"));
  }, [t, toast, workspace.currentBranch]);

  const renameMutation = useMutation({
    mutationFn: async (title: string) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspaceTitle(workspace.workspaceId, title.length === 0 ? null : title);
    },
  });

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const handleSubmitRename = useCallback(
    async (value: string) => {
      await renameMutation.mutateAsync(value.trim());
    },
    [renameMutation],
  );

  const isPinned = workspace.pinnedAt != null;
  const handleTogglePin = useCallback(() => {
    onToggleWorkspacePin(workspace);
  }, [onToggleWorkspacePin, workspace]);
  const onTogglePin = canPin ? handleTogglePin : undefined;

  const { assignWorkspaceGroup } = useGroupActions();

  const [isNewGroupOpen, setIsNewGroupOpen] = useState(false);
  const groupTarget = useMemo(
    () => [{ projectKey: workspace.projectViewKey, workspaceKey: workspace.workspaceKey }],
    [workspace.projectViewKey, workspace.workspaceKey],
  );

  const handleMoveToGroup = useCallback(
    (group: SidebarGroupRef) => {
      assignWorkspaceGroup(groupTarget, { groupId: group.groupId, groupName: group.groupName });
    },
    [assignWorkspaceGroup, groupTarget],
  );

  const handleOpenNewGroup = useCallback(() => {
    setIsNewGroupOpen(true);
  }, []);

  const handleCloseNewGroup = useCallback(() => {
    setIsNewGroupOpen(false);
  }, []);

  // Moving into an id nobody has seen yet is what creates the group, so naming it and
  // joining it are one action. (An EMPTY group is created from the group header menu.)
  const handleSubmitNewGroup = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        assignWorkspaceGroup(groupTarget, { groupId: createGroupId(), groupName: trimmed });
      }
      setIsNewGroupOpen(false);
    },
    [assignWorkspaceGroup, groupTarget],
  );

  const handleRemoveFromGroup = useCallback(() => {
    assignWorkspaceGroup(groupTarget, { groupId: null, groupName: null });
  }, [assignWorkspaceGroup, groupTarget]);

  const archiveShortcutKeys = useShortcutKeys("archive-workspace");
  const { hasClearableAttention, clearAttention } = useClearWorkspaceAttention({
    serverId: workspace.serverId,
    workspaceId: workspace.workspaceId,
  });
  const handleMarkAsRead = useCallback(() => {
    void clearAttention().catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to mark workspace as read");
    });
  }, [clearAttention, toast]);

  useKeyboardActionHandler({
    handlerId: `workspace-archive-${workspace.workspaceKey}`,
    actions: ["workspace.archive"],
    enabled: selected && !isArchiving,
    priority: 0,
    handle: () => {
      handleArchive();
      return true;
    },
  });

  return (
    <>
      <WorkspaceRowInner
        availableGroups={canGroup ? availableGroups : undefined}
        currentGroupId={currentGroupId ?? null}
        onMoveToGroup={canGroup ? handleMoveToGroup : undefined}
        onMoveToNewGroup={canGroup ? handleOpenNewGroup : undefined}
        onRemoveFromGroup={canGroup ? handleRemoveFromGroup : undefined}
        workspace={workspace}
        hostBadge={hostBadge}
        leadingProjectName={leadingProjectName}
        leadingProjectIconDataUri={leadingProjectIconDataUri}
        selected={selected}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        onPress={onPress}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isArchiving}
        isCreating={isCreating}
        dragHandleProps={dragHandleProps}
        menuController={null}
        archiveLabel={t("sidebar.workspace.actions.archive")}
        archiveStatus={isArchiving ? "pending" : "idle"}
        archivePendingLabel={t("sidebar.workspace.actions.archiving")}
        onArchive={handleArchive}
        onCopyBranchName={canCopyBranchName ? handleCopyBranchName : undefined}
        onCopyPath={handleCopyPath}
        onRename={handleOpenRename}
        onMarkAsRead={hasClearableAttention ? handleMarkAsRead : undefined}
        archiveShortcutKeys={selected ? archiveShortcutKeys : null}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      />
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={t("sidebar.workspace.rename.title")}
        initialValue={workspace.title ?? workspace.name}
        placeholder={workspace.name}
        submitLabel={t("sidebar.workspace.rename.submit")}
        onClose={handleCloseRename}
        onSubmit={handleSubmitRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
      {isNewGroupOpen ? (
        <AdaptiveRenameModal
          visible
          title={t("sidebar.workspaceGroup.newGroupTitle")}
          initialValue=""
          placeholder={t("sidebar.workspaceGroup.newGroupPlaceholder")}
          submitLabel={t("sidebar.group.create")}
          onClose={handleCloseNewGroup}
          onSubmit={handleSubmitNewGroup}
          testID={`sidebar-workspace-new-group-modal-${workspace.workspaceKey}`}
        />
      ) : null}
    </>
  );
}

interface WorkspaceRowItemProps {
  workspace: SidebarWorkspacePlacement;
  workspaceEntry: SidebarWorkspaceEntry | null;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canCopyBranchName: boolean;
  canPin: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  isCreating?: boolean;
  canGroup?: boolean;
  availableGroups?: SidebarGroupRef[];
  currentGroupId?: string | null;
  selectionEnabled: boolean;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

function WorkspaceRowItem({
  workspace,
  workspaceEntry,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  shortcutNumber,
  showShortcutBadge,
  canCopyBranchName,
  canPin,
  canGroup,
  availableGroups,
  currentGroupId,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  isCreating = false,
  selectionEnabled,
  activeWorkspaceSelection,
  onWorkspacePress,
  drag,
  isDragging = false,
  dragHandleProps,
}: WorkspaceRowItemProps) {
  const handlePress = useCallback(() => {
    if (!workspace.serverId) {
      return;
    }
    onWorkspacePress?.();
    navigateToWorkspace({ serverId: workspace.serverId, workspaceId: workspace.workspaceId });
  }, [onWorkspacePress, workspace.serverId, workspace.workspaceId]);

  return (
    <WorkspaceRow
      workspaceEntry={workspaceEntry}
      hostBadge={hostBadge}
      leadingProjectName={leadingProjectName}
      leadingProjectIconDataUri={leadingProjectIconDataUri}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      canCopyBranchName={canCopyBranchName}
      canPin={canPin}
      canGroup={canGroup}
      availableGroups={availableGroups}
      currentGroupId={currentGroupId ?? null}
      onToggleWorkspacePin={onToggleWorkspacePin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      isCreating={isCreating}
      selected={isWorkspaceSelected({
        selection: activeWorkspaceSelection,
        serverId: workspace.serverId,
        workspaceId: workspace.workspaceId,
        enabled: selectionEnabled,
      })}
      onPress={handlePress}
      drag={drag ?? noop}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
    />
  );
}

function areWorkspaceRowItemPropsEqual(
  previous: WorkspaceRowItemProps,
  next: WorkspaceRowItemProps,
): boolean {
  const previousSelected = isWorkspaceSelected({
    selection: previous.activeWorkspaceSelection,
    serverId: previous.workspace.serverId,
    workspaceId: previous.workspace.workspaceId,
    enabled: previous.selectionEnabled,
  });
  const nextSelected = isWorkspaceSelected({
    selection: next.activeWorkspaceSelection,
    serverId: next.workspace.serverId,
    workspaceId: next.workspace.workspaceId,
    enabled: next.selectionEnabled,
  });
  return (
    previous.workspace === next.workspace &&
    previous.workspaceEntry === next.workspaceEntry &&
    previous.hostBadge === next.hostBadge &&
    previous.leadingProjectName === next.leadingProjectName &&
    previous.leadingProjectIconDataUri === next.leadingProjectIconDataUri &&
    previous.shortcutNumber === next.shortcutNumber &&
    previous.showShortcutBadge === next.showShortcutBadge &&
    previous.canCopyBranchName === next.canCopyBranchName &&
    previous.canPin === next.canPin &&
    previous.onToggleWorkspacePin === next.onToggleWorkspacePin &&
    previous.reserveIdleStatusIndicatorSpace === next.reserveIdleStatusIndicatorSpace &&
    previous.isCreating === next.isCreating &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previousSelected === nextSelected
  );
}

const MemoWorkspaceRowItem = memo(WorkspaceRowItem, areWorkspaceRowItemPropsEqual);

function WorkspaceRow({
  workspaceEntry,
  hostBadge,
  leadingProjectName,
  leadingProjectIconDataUri,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  canPin,
  canGroup,
  availableGroups,
  currentGroupId,
  onToggleWorkspacePin,
  reserveIdleStatusIndicatorSpace = true,
  isCreating = false,
  selected,
}: {
  workspaceEntry: SidebarWorkspaceEntry | null;
  hostBadge?: HostBadgeModel | null;
  leadingProjectName?: string | null;
  leadingProjectIconDataUri?: string | null;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  canPin: boolean;
  canGroup?: boolean;
  availableGroups?: SidebarGroupRef[];
  currentGroupId?: string | null;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  reserveIdleStatusIndicatorSpace?: boolean;
  isCreating?: boolean;
  selected: boolean;
}) {
  if (!workspaceEntry) {
    return null;
  }

  return (
    <WorkspaceRowWithMenu
      canGroup={canGroup}
      availableGroups={availableGroups}
      currentGroupId={currentGroupId ?? null}
      workspace={workspaceEntry}
      hostBadge={hostBadge}
      leadingProjectName={leadingProjectName}
      leadingProjectIconDataUri={leadingProjectIconDataUri}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      onPress={onPress}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      canCopyBranchName={canCopyBranchName}
      canPin={canPin}
      onToggleWorkspacePin={onToggleWorkspacePin}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
      isCreating={isCreating}
    />
  );
}

export function SidebarWorkspaceList({
  statusGroups,
  pinnedGroups,
  projects,
  workspaceEntriesByKey,
  collapsedProjectKeys,
  onToggleProjectCollapsed,
  shortcutIndexByWorkspaceKey,
  groupMode,
  isRefreshing: _isRefreshing = false,
  onRefresh: _onRefresh,
  onWorkspacePress,
  onAddProject,
  listFooterComponent,
  listHeaderComponent,
  parentGestureRef,
  dragGestureHostPresented,
}: SidebarWorkspaceListProps) {
  const pathname = usePathname();
  const hosts = useHosts();
  const rowItems = useSidebarRowItems();
  // Host badge visibility is a lattice, not three competing switches: this gate is the global
  // "off", `shouldShowSidebarHostLabels` is the automatic "there is only one host so it says
  // nothing", and each host's own `badgeDisplay` decides name vs icon vs hidden. Turning the
  // item off here removes the badge everywhere; leaving it on defers to the per-host setting.
  const hostBadgeByServerId = useHostBadges({
    enabled: rowItems.host && shouldShowSidebarHostLabels(projects),
  });
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsMultiplicityByServerId = useHostFeatureMap(serverIds, "workspaceMultiplicity");
  const supportsPinningByServerId = useHostFeatureMap(serverIds, "workspacePinning");
  const onToggleWorkspacePin = useSidebarWorkspacePinController();
  // Status mode drops the project grouping, so its rows carry their own project
  // icon. Project mode fetches the same icons inside ProjectModeList for its
  // project headers, so only the active mode requests them.
  const statusProjectIconTargets = useMemo(
    () => (groupMode === "status" ? resolveSidebarProjectIconTargets(projects) : []),
    [groupMode, projects],
  );
  const statusProjectIconByProjectViewKey = useProjectIcons({
    projects: statusProjectIconTargets,
  });

  const content =
    groupMode === "status" ? (
      <SidebarStatusModeWrapper
        statusGroups={statusGroups}
        pinnedGroups={pinnedGroups}
        workspaceEntriesByKey={workspaceEntriesByKey}
        projectIconByProjectViewKey={statusProjectIconByProjectViewKey}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        onWorkspacePress={onWorkspacePress}
        hostBadgeByServerId={hostBadgeByServerId}
        supportsPinningByServerId={supportsPinningByServerId}
        onToggleWorkspacePin={onToggleWorkspacePin}
        listHeaderComponent={listHeaderComponent}
      />
    ) : (
      <ProjectModeList
        projects={projects}
        pinnedGroups={pinnedGroups}
        workspaceEntriesByKey={workspaceEntriesByKey}
        collapsedProjectKeys={collapsedProjectKeys}
        onToggleProjectCollapsed={onToggleProjectCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        onWorkspacePress={onWorkspacePress}
        onAddProject={onAddProject}
        listFooterComponent={listFooterComponent}
        listHeaderComponent={listHeaderComponent}
        parentGestureRef={parentGestureRef}
        dragGestureHostPresented={dragGestureHostPresented}
        pathname={pathname}
        hostBadgeByServerId={hostBadgeByServerId}
        supportsMultiplicityByServerId={supportsMultiplicityByServerId}
        supportsPinningByServerId={supportsPinningByServerId}
        onToggleWorkspacePin={onToggleWorkspacePin}
      />
    );

  return content;
}

function SidebarStatusModeWrapper({
  statusGroups,
  pinnedGroups,
  workspaceEntriesByKey,
  projectIconByProjectViewKey,
  shortcutIndexByWorkspaceKey: _projectShortcutIndex,
  onWorkspacePress,
  hostBadgeByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
  listHeaderComponent,
}: {
  statusGroups: StatusGroup[];
  pinnedGroups: PinnedSidebarGroups;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  onWorkspacePress?: () => void;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
  listHeaderComponent?: ReactElement | null;
}) {
  const showShortcutBadges = useShowShortcutBadges();

  return (
    <SidebarStatusWorkspaceList
      groups={statusGroups}
      pinnedWorkspaces={pinnedGroups.pinnedChats.flatMap((workspace) => {
        const entry = workspaceEntriesByKey.get(workspace.workspaceKey);
        return entry ? [entry] : [];
      })}
      projectIconByProjectViewKey={projectIconByProjectViewKey}
      shortcutIndexByWorkspaceKey={_projectShortcutIndex}
      showShortcutBadges={showShortcutBadges}
      onWorkspacePress={onWorkspacePress}
      hostBadgeByServerId={hostBadgeByServerId}
      supportsPinningByServerId={supportsPinningByServerId}
      onToggleWorkspacePin={onToggleWorkspacePin}
      listHeaderComponent={listHeaderComponent}
    />
  );
}

// The project header, as one row of the flat list. It owns only DERIVED state — the
// aggregate status a collapsed project shows for the workspaces it is hiding. Anything
// that has to outlive the row (an open dialog, a remove in flight) lives in the
// container, because the list unmounts rows that scroll far enough away.
const ProjectHeaderFlatRow = memo(function ProjectHeaderFlatRow({
  row,
  iconDataUri,
  isProjectActive,
  isRemoving,
  canGroup,
  availableProjectGroups,
  supportsMultiplicityByServerId,
  onToggleCollapsed,
  onWorkspacePress,
  onWorktreeCreated,
  onNewWorkspaceGroup,
  onSetProjectGroup,
  onNewProjectGroup,
  onRemoveProject,
  drag,
  isDragging,
  dragHandleProps,
}: {
  row: SidebarProjectHeaderRow;
  iconDataUri: string | null;
  isProjectActive: boolean;
  isRemoving: boolean;
  canGroup: boolean;
  availableProjectGroups: SidebarGroupRef[];
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
  onToggleCollapsed: (projectViewKey: string) => void;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  onNewWorkspaceGroup: (projectKey: string) => void;
  onSetProjectGroup: (project: GroupedSidebarProject, assignment: GroupAssignment) => void;
  onNewProjectGroup: (project: GroupedSidebarProject) => void;
  onRemoveProject: (project: GroupedSidebarProject) => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { project, collapsed } = row;
  const rowModel = useMemo(
    () => buildSidebarProjectRowModel({ project, collapsed, supportsMultiplicityByServerId }),
    [project, collapsed, supportsMultiplicityByServerId],
  );

  // Collapsed rows hide their workspace rows, so the project row carries the most urgent
  // status among them; expanded rows leave the signal to the child rows themselves.
  const aggregateStatusBucket = useSidebarProjectStatusBucket({
    workspaces: project.workspaces,
    enabled: collapsed,
  });

  const handleToggle = useCallback(
    () => onToggleCollapsed(project.viewKey),
    [onToggleCollapsed, project.viewKey],
  );
  const handleNewWorkspaceGroup = useCallback(
    () => onNewWorkspaceGroup(project.viewKey),
    [onNewWorkspaceGroup, project.viewKey],
  );
  const handleRemove = useCallback(() => onRemoveProject(project), [onRemoveProject, project]);

  const groupMenu = useMemo<ProjectGroupMenu | undefined>(
    () =>
      canGroup
        ? {
            availableGroups: availableProjectGroups,
            currentGroupId: row.parentGroupId,
            onMoveToGroup: (group: SidebarGroupRef) =>
              onSetProjectGroup(project, {
                groupId: group.groupId,
                groupName: group.groupName,
              }),
            onMoveToNewGroup: () => onNewProjectGroup(project),
            onRemoveFromGroup: () => onSetProjectGroup(project, { groupId: null, groupName: null }),
          }
        : undefined,
    [
      canGroup,
      availableProjectGroups,
      row.parentGroupId,
      project,
      onSetProjectGroup,
      onNewProjectGroup,
    ],
  );

  return (
    <ProjectHeaderRow
      groupMenu={groupMenu}
      onNewWorkspaceGroup={canGroup ? handleNewWorkspaceGroup : undefined}
      project={project}
      displayName={project.projectName}
      iconDataUri={iconDataUri}
      statusBucket={aggregateStatusBucket}
      selected={false}
      chevron={rowModel.chevron}
      onPress={handleToggle}
      worktreeTarget={
        rowModel.trailingAction.kind === "new_workspace" ? rowModel.trailingAction.target : null
      }
      isProjectActive={isProjectActive}
      onWorkspacePress={onWorkspacePress}
      onWorktreeCreated={onWorktreeCreated}
      drag={drag}
      isDragging={isDragging}
      isArchiving={isRemoving}
      menuController={null}
      onRemoveProject={handleRemove}
      removeProjectStatus={isRemoving ? "pending" : "idle"}
      dragHandleProps={dragHandleProps}
    />
  );
});

// The two group headers, one component each, for the same reason every other row kind has
// one: a header renders a handful of callbacks, and building them in the list's renderItem
// would rebuild every one of them on every keystroke somewhere else in the sidebar.
const ProjectGroupHeaderFlatRow = memo(function ProjectGroupHeaderFlatRow({
  row,
  onToggleCollapsed,
  onRename,
  onDelete,
  drag,
  isDragging,
  dragHandleProps,
}: {
  row: SidebarProjectGroupHeaderRow;
  onToggleCollapsed: (collapseKey: string) => void;
  onRename: (group: SidebarProjectGroup) => void;
  onDelete: (group: SidebarProjectGroup) => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { group } = row;
  const handleToggle = useCallback(
    () => onToggleCollapsed(group.groupId),
    [onToggleCollapsed, group.groupId],
  );
  const handleRename = useCallback(() => onRename(group), [onRename, group]);
  const handleDelete = useCallback(() => onDelete(group), [onDelete, group]);

  return (
    <GroupSectionHeader
      kind="project"
      groupId={group.groupId}
      groupName={group.groupName}
      count={row.count}
      collapsed={row.collapsed}
      onToggle={handleToggle}
      onRename={handleRename}
      onDelete={handleDelete}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      testID={`sidebar-project-group-${group.groupId}`}
    />
  );
});

const WorkspaceGroupHeaderFlatRow = memo(function WorkspaceGroupHeaderFlatRow({
  row,
  onToggleCollapsed,
  onRename,
  onDelete,
  drag,
  isDragging,
  dragHandleProps,
}: {
  row: SidebarWorkspaceGroupHeaderRow;
  onToggleCollapsed: (collapseKey: string) => void;
  onRename: (group: SidebarWorkspaceGroup) => void;
  onDelete: (group: SidebarWorkspaceGroup) => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { group } = row;
  const handleToggle = useCallback(
    () => onToggleCollapsed(group.groupId),
    [onToggleCollapsed, group.groupId],
  );
  const handleRename = useCallback(() => onRename(group), [onRename, group]);
  const handleDelete = useCallback(() => onDelete(group), [onDelete, group]);

  return (
    <GroupSectionHeader
      kind="workspace"
      groupId={group.groupId}
      groupName={group.groupName}
      count={row.count}
      collapsed={row.collapsed}
      onToggle={handleToggle}
      onRename={handleRename}
      onDelete={handleDelete}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      indented
      testID={`sidebar-workspace-group-${row.projectKey}-${group.groupId}`}
    />
  );
});

// A remainder is the ABSENCE of a group, not a group: no glyph, no menu, no drag handle,
// nothing to rename. It renders as a header anyway, because once everything has been
// grouped that header is the only thing left to aim at — without it, nothing could ever be
// dragged back out.
const RemainderHeaderFlatRow = memo(function RemainderHeaderFlatRow({
  kind,
  collapseKey,
  groupName,
  count,
  collapsed,
  indented,
  testID,
  onToggleCollapsed,
}: {
  kind: SidebarGroupKind;
  collapseKey: string;
  groupName: string;
  count: number;
  collapsed: boolean;
  indented?: boolean;
  testID: string;
  onToggleCollapsed: (collapseKey: string) => void;
}) {
  const handleToggle = useCallback(
    () => onToggleCollapsed(collapseKey),
    [onToggleCollapsed, collapseKey],
  );
  return (
    <GroupSectionHeader
      kind={kind}
      ungrouped
      groupId={collapseKey}
      groupName={groupName}
      count={count}
      collapsed={collapsed}
      onToggle={handleToggle}
      indented={indented}
      testID={testID}
    />
  );
});

const ShowMoreFlatRow = memo(function ShowMoreFlatRow({
  row,
  onToggleSection,
}: {
  row: SidebarShowMoreRow;
  onToggleSection: (sectionKey: string) => void;
}) {
  const handlePress = useCallback(
    () => onToggleSection(row.sectionKey),
    [onToggleSection, row.sectionKey],
  );
  return (
    <SidebarGroupToggleRow expanded={row.expanded} onPress={handlePress} testID={row.testID} />
  );
});

// Which dialog the container is showing. One at a time, and never owned by a row.
type SidebarActiveModal =
  | { kind: "rename-workspace-group"; group: SidebarWorkspaceGroup }
  | { kind: "rename-project-group"; group: SidebarProjectGroup }
  | { kind: "new-workspace-group"; projectKey: string }
  | { kind: "new-project-group"; project: GroupedSidebarProject };

const MODAL_TITLE_KEYS = {
  "rename-workspace-group": "sidebar.workspaceGroup.renameGroupTitle",
  "rename-project-group": "sidebar.projectGroup.renameGroupTitle",
  "new-workspace-group": "sidebar.workspaceGroup.newGroupTitle",
  "new-project-group": "sidebar.projectGroup.newGroupTitle",
} as const;

const MODAL_PLACEHOLDER_KEYS = {
  "rename-workspace-group": "sidebar.workspaceGroup.newGroupPlaceholder",
  "rename-project-group": "sidebar.projectGroup.newGroupPlaceholder",
  "new-workspace-group": "sidebar.workspaceGroup.newGroupPlaceholder",
  "new-project-group": "sidebar.projectGroup.newGroupPlaceholder",
} as const;

// Kept project-scoped for the two "new group" dialogs even though one component now owns
// them all: the id names which project the group is being created in, and the tests that
// drive those dialogs address them that way.
function modalTestID(modal: SidebarActiveModal): string {
  switch (modal.kind) {
    case "rename-workspace-group":
      return "sidebar-group-rename-modal";
    case "rename-project-group":
      return "sidebar-project-group-rename-modal";
    case "new-workspace-group":
      return `sidebar-project-new-workspace-group-modal-${modal.projectKey}`;
    case "new-project-group":
      return `sidebar-project-new-group-modal-${modal.project.viewKey}`;
  }
}

const EMPTY_GROUP_REFS: SidebarGroupRef[] = [];

const flatRowKeyExtractor = (row: SidebarFlatRow) => row.key;

// Native reshapes its rows one commit and one frame before the lift. This is the way back
// out if a device turns out not to like that: with it off the header travels alone and the
// drop means the same thing, since the policy resolves at block granularity either way.
const COLLAPSE_ON_LIFT_NATIVE = true;

// Enough rows to fill a tall sidebar on first paint. The whole sidebar is one list now, so
// the default window would leave the lower half blank until the first scroll.
const INITIAL_ROWS_TO_RENDER = 25;

// The whole sidebar in project mode: ONE draggable list, which is also the scroll
// container. Pinned rows, group headers, project rows, workspace rows and "show more"
// toggles are all rows of it.
//
// It is flat because a drag has to cross group boundaries, and the only way a drag crosses
// a boundary for free is if there is no boundary. The nested per-section lists this
// replaced could only do it on web, through a second drag engine hoisted above them.
function ProjectModeList({
  projects,
  pinnedGroups,
  workspaceEntriesByKey,
  onToggleProjectCollapsed,
  shortcutIndexByWorkspaceKey,
  onWorkspacePress,
  onAddProject,
  listFooterComponent,
  listHeaderComponent,
  parentGestureRef,
  dragGestureHostPresented,
  pathname,
  hostBadgeByServerId,
  supportsMultiplicityByServerId,
  supportsPinningByServerId,
  onToggleWorkspacePin,
}: Omit<SidebarWorkspaceListProps, "statusGroups" | "groupMode" | "isRefreshing" | "onRefresh"> & {
  pathname: string;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
}) {
  const hasActiveHostFilter = useSidebarViewStore((state) => state.hostFilters.length > 0);
  const { t } = useTranslation();
  const toast = useToast();
  const [creatingWorkspaceIds, setCreatingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const creatingWorkspaceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const showShortcutBadges = useShowShortcutBadges();
  const togglePinnedCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.togglePinnedCollapsed,
  );
  const toggleGroupCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleGroupCollapsed,
  );

  const getProjectOrder = useSidebarOrderStore((state) => state.getProjectOrder);
  const setProjectOrder = useSidebarOrderStore((state) => state.setProjectOrder);
  const getWorkspaceOrder = useSidebarOrderStore((state) => state.getWorkspaceOrder);
  const setWorkspaceOrder = useSidebarOrderStore((state) => state.setWorkspaceOrder);

  const isWorkspaceRoute = useMemo(
    () => Boolean(pathname && parseHostWorkspaceRouteFromPathname(pathname)),
    [pathname],
  );
  const selectionEnabled = isWorkspaceRoute;
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const { pinnedChats, unpinnedProjects } = pinnedGroups;
  // Groups organise what is left after the Pinned section has hoisted its chats out,
  // so this runs on unpinnedProjects, never on the raw project list.
  const groupedSidebar = useSidebarGroups(unpinnedProjects);
  const projectIconTargets = useMemo(() => resolveSidebarProjectIconTargets(projects), [projects]);
  const projectIconByProjectViewKey = useProjectIcons({ projects: projectIconTargets });

  useEffect(() => {
    const timeouts = creatingWorkspaceTimeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (creatingWorkspaceIds.size === 0) {
      return;
    }

    const visibleWorkspaceIds = new Set<string>();
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        visibleWorkspaceIds.add(workspace.workspaceId);
      }
    }

    const removedWorkspaceIds = Array.from(creatingWorkspaceIds).filter(
      (workspaceId) => !visibleWorkspaceIds.has(workspaceId),
    );
    if (removedWorkspaceIds.length === 0) {
      return;
    }

    for (const workspaceId of removedWorkspaceIds) {
      const timeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
      if (timeout) {
        clearTimeout(timeout);
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
      }
    }

    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      for (const workspaceId of removedWorkspaceIds) {
        next.delete(workspaceId);
      }
      return next;
    });
  }, [creatingWorkspaceIds, projects]);

  const handleWorktreeCreated = useCallback((workspaceId: string) => {
    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
    const existingTimeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    creatingWorkspaceTimeoutsRef.current.set(
      workspaceId,
      setTimeout(() => {
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
        setCreatingWorkspaceIds((current) => {
          if (!current.has(workspaceId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(workspaceId);
          return next;
        });
      }, 3000),
    );
  }, []);

  // One hook for every layout write in this component. Both levels edit the same
  // document, so there is no reason for two.
  const {
    isAvailable: isLayoutAvailable,
    assignProjectGroup,
    createWorkspaceGroup,
    renameProjectGroup,
    deleteProjectGroup,
    renameWorkspaceGroup,
    deleteWorkspaceGroup,
    applyDropIntent,
  } = useGroupActions();

  const { rows, buildRowsForDrag, toggleSection } = useSidebarFlatRows({
    grouped: groupedSidebar,
    pinnedChats,
    hasProjects: projects.length > 0,
    // The label earns its space only when something follows it, or when a host filter is
    // the reason nothing does.
    showWorkspacesHeader: unpinnedProjects.length > 0 || hasActiveHostFilter,
    supportsMultiplicityByServerId,
  });

  const projectByKey = useMemo(() => {
    const byKey = new Map<string, GroupedSidebarProject>();
    for (const group of groupedSidebar.projectGroups) {
      for (const project of group.projects) {
        byKey.set(project.viewKey, project);
      }
    }
    for (const project of groupedSidebar.ungroupedProjects) {
      byKey.set(project.viewKey, project);
    }
    return byKey;
  }, [groupedSidebar]);

  // Built once per project rather than per row: a row does not know which groups its
  // project has, and deriving it per row would subscribe every row to the whole document.
  const workspaceGroupRefsByProject = useMemo(() => {
    const byKey = new Map<string, SidebarGroupRef[]>();
    for (const [projectKey, project] of projectByKey) {
      byKey.set(
        projectKey,
        project.workspaceGroups.map((group) => ({
          groupId: group.groupId,
          groupName: group.groupName,
        })),
      );
    }
    return byKey;
  }, [projectByKey]);

  const availableProjectGroups = useMemo<SidebarGroupRef[]>(
    () =>
      groupedSidebar.projectGroups.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
      })),
    [groupedSidebar.projectGroups],
  );

  // ---------------------------------------------------------------------------
  // Drag
  // ---------------------------------------------------------------------------

  // The rows a drag runs against, frozen for its duration. A replica arriving mid-drag
  // must not reshape the list under the finger — on native it would cancel the drag
  // outright — and the drop is anchored to keys rather than indices, so applying it to a
  // document that has moved on is still well defined.
  const [dragState, setDragState] = useState<{
    origin: SidebarDragOrigin;
    rows: SidebarFlatRow[];
  } | null>(null);
  const pendingDragRef = useRef<(() => void) | null>(null);
  const listData = dragState?.rows ?? rows;

  const endDrag = useCallback(() => {
    pendingDragRef.current = null;
    setDragState(null);
  }, []);

  // NATIVE: the rows have to be reshaped BEFORE the drag activates, because the list
  // cancels any drag whose data changes. So the row arms instead of dragging: state, then
  // one commit, then one frame for the cells to lay out at their new offsets, and only
  // then the lift.
  const armDrag = useCallback(
    (row: SidebarFlatRow, startDrag: () => void) => {
      const origin = dragOriginForRow(row);
      if (!origin) {
        return;
      }
      pendingDragRef.current = startDrag;
      setDragState({ origin, rows: buildRowsForDrag(origin) });
    },
    [buildRowsForDrag],
  );

  useEffect(() => {
    if (!dragState || !pendingDragRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const startDrag = pendingDragRef.current;
      pendingDragRef.current = null;
      startDrag?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [dragState]);

  // WEB: dnd-kit measures from the DOM at drag start, so the rows can be reshaped there.
  // The drag then runs against whatever this returns.
  const handleDragSnapshot = useCallback(
    (data: SidebarFlatRow[], from: number) => {
      const row = data[from];
      const origin = row ? dragOriginForRow(row) : null;
      if (!origin) {
        return data;
      }
      const next = buildRowsForDrag(origin);
      setDragState({ origin, rows: next });
      return next;
    },
    [buildRowsForDrag],
  );

  const canDragRow = useCallback(
    (row: SidebarFlatRow) => {
      if (!isDraggableRow(row)) {
        return false;
      }
      // Pinned order lives in the layout document and nowhere else, so a host too old to
      // hold one leaves the section in pinnedAt order rather than in an order the user
      // arranged and then lost.
      if (row.kind === "pinned-workspace") {
        return isLayoutAvailable;
      }
      return true;
    },
    [isLayoutAvailable],
  );

  const getValidSlotsForDrag = useCallback(
    (data: SidebarFlatRow[], from: number) => validSlots(data, from),
    [],
  );

  const handleDrop = useCallback(
    (_data: SidebarFlatRow[], meta: DraggableListDropMeta) => {
      const dragRows = dragState?.rows ?? rows;
      endDrag();

      const intent = interpretSidebarDrop(dragRows, meta.from, meta.to);
      if (isLayoutAvailable) {
        applyDropIntent(intent);
        return;
      }

      // No host can store a layout, so grouping is not on screen and the only drop that
      // can have happened is a plain reorder. It goes to the local order store, which is
      // the only thing being read in that case.
      const fallback = legacyDropFallback(intent);
      if (!fallback) {
        return;
      }
      const currentOrder =
        fallback.kind === "reorder-projects"
          ? getProjectOrder()
          : getWorkspaceOrder(fallback.projectKey);
      if (
        !hasVisibleOrderChanged({
          currentOrder,
          reorderedVisibleKeys: fallback.orderedVisibleKeys,
        })
      ) {
        return;
      }
      const merged = mergeWithRemainder({
        currentOrder,
        reorderedVisibleKeys: fallback.orderedVisibleKeys,
      });
      if (fallback.kind === "reorder-projects") {
        setProjectOrder(merged);
      } else {
        setWorkspaceOrder(fallback.projectKey, merged);
      }
    },
    [
      dragState,
      rows,
      endDrag,
      isLayoutAvailable,
      applyDropIntent,
      getProjectOrder,
      setProjectOrder,
      getWorkspaceOrder,
      setWorkspaceOrder,
    ],
  );

  // ---------------------------------------------------------------------------
  // Dialogs and mutations, all owned here
  // ---------------------------------------------------------------------------

  const [activeModal, setActiveModal] = useState<SidebarActiveModal | null>(null);
  const closeModal = useCallback(() => setActiveModal(null), []);
  const [removingProjectKeys, setRemovingProjectKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const handleSetProjectGroup = useCallback(
    (project: GroupedSidebarProject, assignment: GroupAssignment) => {
      assignProjectGroup([project.viewKey], assignment);
    },
    [assignProjectGroup],
  );

  const handleSubmitModal = useCallback(
    (nextName: string) => {
      const trimmed = nextName.trim();
      setActiveModal(null);
      if (!activeModal || trimmed.length === 0) {
        return;
      }
      switch (activeModal.kind) {
        case "rename-workspace-group":
          renameWorkspaceGroup(activeModal.group.groupId, trimmed);
          return;
        // One edit. The group is an entity, so renaming it does not mean rewriting every
        // row that happens to be inside it.
        case "rename-project-group":
          renameProjectGroup(activeModal.group.groupId, trimmed);
          return;
        case "new-workspace-group":
          createWorkspaceGroup({ projectKey: activeModal.projectKey, name: trimmed });
          return;
        case "new-project-group":
          handleSetProjectGroup(activeModal.project, {
            groupId: createGroupId(),
            groupName: trimmed,
          });
      }
    },
    [
      activeModal,
      renameWorkspaceGroup,
      renameProjectGroup,
      createWorkspaceGroup,
      handleSetProjectGroup,
    ],
  );

  const handleDeleteProjectGroup = useCallback(
    (group: SidebarProjectGroup) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.projectGroup.confirmations.deleteTitle"),
          message: t("sidebar.projectGroup.confirmations.deleteMessage", {
            groupName: group.groupName,
          }),
          confirmLabel: t("sidebar.group.deleteConfirm"),
          cancelLabel: t("sidebar.group.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        // Deleting a group never deletes what was in it: the projects fall back to
        // ungrouped, in the order they had inside the group.
        deleteProjectGroup(group.groupId);
      })();
    },
    [deleteProjectGroup, t],
  );

  const handleDeleteWorkspaceGroup = useCallback(
    (group: SidebarWorkspaceGroup) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.workspaceGroup.confirmations.deleteTitle"),
          message: t("sidebar.workspaceGroup.confirmations.deleteMessage", {
            groupName: group.groupName,
          }),
          confirmLabel: t("sidebar.group.deleteConfirm"),
          cancelLabel: t("sidebar.group.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        // The workspaces are untouched; they fall back to ungrouped.
        deleteWorkspaceGroup(group.groupId);
      })();
    },
    [deleteWorkspaceGroup, t],
  );

  const handleRemoveProject = useCallback(
    (project: GroupedSidebarProject) => {
      const markRemoving = (removing: boolean) =>
        setRemovingProjectKeys((current) => {
          const next = new Set(current);
          if (removing) {
            next.add(project.viewKey);
          } else {
            next.delete(project.viewKey);
          }
          return next;
        });

      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.project.confirmations.removeTitle"),
          message: t("sidebar.project.confirmations.removeMessage", {
            projectName: project.projectName,
          }),
          confirmLabel: t("sidebar.project.confirmations.removeConfirm"),
          cancelLabel: t("sidebar.project.confirmations.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        markRemoving(true);
        const readiness = getCurrentProjectRemoveReadiness({ hosts: project.hosts });
        if (readiness.kind === "needs_host_update") {
          toast.error(t("sidebar.project.toasts.updateHostToRemove"));
          markRemoving(false);
          return;
        }

        void removeProjectFromHosts({
          targets: readiness.targets,
          getClient: (serverId) => getHostRuntimeStore().getClient(serverId),
        })
          .then((outcome) => {
            if (outcome.kind === "host_disconnected") {
              toast.error(t("sidebar.project.toasts.hostDisconnected"));
              return null;
            }
            if (outcome.kind === "failed") {
              toast.error(t("sidebar.project.toasts.removeFailed"));
            }
            return null;
          })
          .catch((error) => {
            toast.error(
              error instanceof Error ? error.message : t("sidebar.project.toasts.removeFailed"),
            );
          })
          .finally(() => {
            markRemoving(false);
          });
      })();
    },
    [t, toast],
  );

  const handleOpenNewWorkspaceGroup = useCallback((projectKey: string) => {
    setActiveModal({ kind: "new-workspace-group", projectKey });
  }, []);

  const handleOpenNewProjectGroup = useCallback((project: GroupedSidebarProject) => {
    setActiveModal({ kind: "new-project-group", project });
  }, []);

  const handleRenameProjectGroup = useCallback((group: SidebarProjectGroup) => {
    setActiveModal({ kind: "rename-project-group", group });
  }, []);

  const handleRenameWorkspaceGroup = useCallback((group: SidebarWorkspaceGroup) => {
    setActiveModal({ kind: "rename-workspace-group", group });
  }, []);

  // ---------------------------------------------------------------------------
  // Row rendering
  // ---------------------------------------------------------------------------

  const renderWorkspaceRow = useCallback(
    (
      workspace: SidebarWorkspacePlacement,
      input: {
        drag: () => void;
        isDragging: boolean;
        dragHandleProps?: DraggableListDragHandleProps;
        availableGroups?: SidebarGroupRef[];
        currentGroupId?: string | null;
        // Pinned rows come from every project at once, so each one says where it is from.
        leading?: boolean;
      },
    ) => (
      <MemoWorkspaceRowItem
        workspace={workspace}
        workspaceEntry={workspaceEntriesByKey.get(workspace.workspaceKey) ?? null}
        hostBadge={hostBadgeByServerId.get(workspace.serverId) ?? null}
        leadingProjectName={input.leading ? workspace.projectName : undefined}
        leadingProjectIconDataUri={
          input.leading
            ? (projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null)
            : undefined
        }
        shortcutNumber={shortcutIndexByWorkspaceKey.get(workspace.workspaceKey) ?? null}
        showShortcutBadge={showShortcutBadges}
        canCopyBranchName={workspace.projectKind === "git"}
        canPin={supportsPinningByServerId.get(workspace.serverId) === true}
        canGroup={Boolean(input.availableGroups) && isLayoutAvailable}
        availableGroups={input.availableGroups}
        currentGroupId={input.currentGroupId ?? null}
        onToggleWorkspacePin={onToggleWorkspacePin}
        isCreating={creatingWorkspaceIds.has(workspace.workspaceId)}
        selectionEnabled={selectionEnabled}
        activeWorkspaceSelection={activeWorkspaceSelection}
        onWorkspacePress={onWorkspacePress}
        drag={input.drag}
        isDragging={input.isDragging}
        dragHandleProps={input.dragHandleProps}
      />
    ),
    [
      workspaceEntriesByKey,
      hostBadgeByServerId,
      projectIconByProjectViewKey,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
      isLayoutAvailable,
      onToggleWorkspacePin,
      creatingWorkspaceIds,
      selectionEnabled,
      activeWorkspaceSelection,
      onWorkspacePress,
    ],
  );

  // oxlint-disable-next-line complexity
  const renderRowBody = useCallback(
    (
      row: SidebarFlatRow,
      info: {
        drag: () => void;
        isDragging: boolean;
        dragHandleProps?: DraggableListDragHandleProps;
      },
    ) => {
      switch (row.kind) {
        // The section testID rides the header, which is the only row the Pinned section
        // always has. There is no section view left to hang it on.
        case "pinned-header":
          return (
            <View testID="sidebar-pinned-section">
              <PinnedSectionHeader collapsed={row.collapsed} onToggle={togglePinnedCollapsed} />
            </View>
          );

        case "pinned-workspace":
          return renderWorkspaceRow(row.workspace, { ...info, leading: true });

        case "workspaces-header":
          return listHeaderComponent ?? null;

        case "project-group-header":
          return (
            <ProjectGroupHeaderFlatRow
              row={row}
              onToggleCollapsed={toggleGroupCollapsed}
              onRename={handleRenameProjectGroup}
              onDelete={handleDeleteProjectGroup}
              drag={info.drag}
              isDragging={info.isDragging}
              dragHandleProps={info.dragHandleProps}
            />
          );

        case "ungrouped-projects-header":
          return (
            <RemainderHeaderFlatRow
              kind="project"
              collapseKey={UNGROUPED_PROJECTS_COLLAPSE_KEY}
              groupName={t("sidebar.projectGroup.noGroup")}
              count={row.count}
              collapsed={row.collapsed}
              testID="sidebar-project-no-group"
              onToggleCollapsed={toggleGroupCollapsed}
            />
          );

        case "project-header":
          return (
            <ProjectHeaderFlatRow
              row={row}
              iconDataUri={projectIconByProjectViewKey.get(row.project.viewKey) ?? null}
              isProjectActive={isProjectSelectedByRoute({
                selection: activeWorkspaceSelection,
                project: row.project,
                enabled: selectionEnabled,
              })}
              isRemoving={removingProjectKeys.has(row.project.viewKey)}
              canGroup={isLayoutAvailable}
              availableProjectGroups={availableProjectGroups}
              supportsMultiplicityByServerId={supportsMultiplicityByServerId}
              onToggleCollapsed={onToggleProjectCollapsed}
              onWorkspacePress={onWorkspacePress}
              onWorktreeCreated={handleWorktreeCreated}
              onNewWorkspaceGroup={handleOpenNewWorkspaceGroup}
              onSetProjectGroup={handleSetProjectGroup}
              onNewProjectGroup={handleOpenNewProjectGroup}
              onRemoveProject={handleRemoveProject}
              drag={info.drag}
              isDragging={info.isDragging}
              dragHandleProps={info.dragHandleProps}
            />
          );

        case "workspace-group-header":
          return (
            <WorkspaceGroupHeaderFlatRow
              row={row}
              onToggleCollapsed={toggleGroupCollapsed}
              onRename={handleRenameWorkspaceGroup}
              onDelete={handleDeleteWorkspaceGroup}
              drag={info.drag}
              isDragging={info.isDragging}
              dragHandleProps={info.dragHandleProps}
            />
          );

        case "workspace-remainder-header":
          return (
            <RemainderHeaderFlatRow
              kind="workspace"
              collapseKey={workspaceRemainderCollapseKey(row.projectKey)}
              groupName={t("sidebar.workspaceGroup.noGroup")}
              count={row.count}
              collapsed={row.collapsed}
              indented
              testID={`sidebar-workspace-no-group-${row.projectKey}`}
              onToggleCollapsed={toggleGroupCollapsed}
            />
          );

        case "workspace":
          return renderWorkspaceRow(row.workspace, {
            ...info,
            availableGroups: workspaceGroupRefsByProject.get(row.projectKey) ?? EMPTY_GROUP_REFS,
            currentGroupId: row.groupId,
          });

        case "show-more":
          return <ShowMoreFlatRow row={row} onToggleSection={toggleSection} />;

        case "new-workspace-ghost":
          return (
            <NewWorkspaceGhostRow
              project={row.project}
              displayName={row.project.projectName}
              worktreeTarget={row.worktreeTarget}
              onWorkspacePress={onWorkspacePress}
            />
          );

        case "empty-state":
          return (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle} testID="sidebar-project-empty-state">
                {t("sidebar.project.empty.title")}
              </Text>
              <Text style={styles.emptyText}>{t("sidebar.project.empty.description")}</Text>
              <Button variant="ghost" size="sm" leftIcon={Plus} onPress={onAddProject}>
                {t("sidebar.actions.addProject")}
              </Button>
            </View>
          );
      }
    },
    [
      t,
      listHeaderComponent,
      togglePinnedCollapsed,
      toggleGroupCollapsed,
      toggleSection,
      renderWorkspaceRow,
      workspaceGroupRefsByProject,
      projectIconByProjectViewKey,
      activeWorkspaceSelection,
      selectionEnabled,
      removingProjectKeys,
      isLayoutAvailable,
      availableProjectGroups,
      supportsMultiplicityByServerId,
      onToggleProjectCollapsed,
      onWorkspacePress,
      handleWorktreeCreated,
      handleOpenNewWorkspaceGroup,
      handleOpenNewProjectGroup,
      handleSetProjectGroup,
      handleRemoveProject,
      handleRenameProjectGroup,
      handleDeleteProjectGroup,
      handleRenameWorkspaceGroup,
      handleDeleteWorkspaceGroup,
      onAddProject,
    ],
  );

  const renderRow = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<SidebarFlatRow>) => {
      const startDrag =
        COLLAPSE_ON_LIFT_NATIVE && platformIsNative ? () => armDrag(item, drag) : drag;
      return (
        <SidebarRowRail levels={item.railLevels} trailingGap={item.trailingGap}>
          {renderRowBody(item, { drag: startDrag, isDragging: isActive, dragHandleProps })}
        </SidebarRowRail>
      );
    },
    [renderRowBody, armDrag],
  );

  return (
    <View style={styles.container}>
      <DraggableList
        testID="sidebar-project-workspace-list-scroll"
        data={listData}
        keyExtractor={flatRowKeyExtractor}
        renderItem={renderRow}
        onDragEnd={handleDrop}
        onDragTerminate={endDrag}
        canDrag={canDragRow}
        getValidSlots={getValidSlotsForDrag}
        getDragSnapshot={platformIsWeb ? handleDragSnapshot : undefined}
        extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
        initialNumToRender={INITIAL_ROWS_TO_RENDER}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        useDragHandle
        simultaneousGestureRef={parentGestureRef}
        gestureHostPresented={dragGestureHostPresented}
        ListFooterComponent={listFooterComponent ?? null}
      />
      {activeModal ? (
        <AdaptiveRenameModal
          visible
          title={t(MODAL_TITLE_KEYS[activeModal.kind])}
          initialValue={
            activeModal.kind === "rename-workspace-group" ||
            activeModal.kind === "rename-project-group"
              ? activeModal.group.groupName
              : ""
          }
          placeholder={t(MODAL_PLACEHOLDER_KEYS[activeModal.kind])}
          submitLabel={t(
            activeModal.kind === "rename-workspace-group" ||
              activeModal.kind === "rename-project-group"
              ? "sidebar.group.save"
              : "sidebar.group.create",
          )}
          onClose={closeModal}
          onSubmit={handleSubmitModal}
          testID={modalTestID(activeModal)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing[2],
    // Optical inset: aligns the visible Pinned/Workspaces glyph edge with the
    // Schedules icon across the divider; their layout boxes have different insets.
    paddingTop: 2,
    paddingBottom: theme.spacing[4],
  },
  ungroupedProjectsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  projectListContainer: {
    width: "100%",
  },
  pinnedSection: {
    marginBottom: theme.spacing[1],
  },
  // Three times the gap a row keeps from its neighbour, so the break between two groups reads as
  // a break rather than as one more row of pitch. Kept equal to `statusGroupBlockExpanded` — the
  // two groupings are the same list under a different heading and must not breathe differently.
  //
  // Padding on the block rather than margin, and only while it has children: the gap belongs to
  // the rows underneath the header, so a collapsed project gives it back and a column of collapsed
  // headers closes up to the pitch of a list instead of staying spaced for content that is gone.
  projectBlockExpanded: {
    paddingBottom: theme.spacing[3],
  },
  workspaceListContainer: {},
  // Kept in step with `workspaceRow` above. It stands in a project's list where a workspace row
  // would be, so it takes that row's geometry and both of its fills.
  newWorkspaceGhostRow: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  newWorkspaceGhostRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  newWorkspaceGhostRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // The width of a workspace row's status slot, so the label lands on the same rail as the
  // titles above it.
  newWorkspaceGhostIconSlot: {
    width: theme.iconSize.md,
    height: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  newWorkspaceGhostText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
  },
  newWorkspaceGhostTextHovered: {
    fontSize: theme.fontSize.sm,
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
  },
  emptyContainer: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  projectRow: {
    position: "relative",
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[1],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  projectRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  projectRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  projectRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  projectTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  projectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    minWidth: 0,
    flexShrink: 1,
  },
  projectActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  projectActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectActionButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  projectIconActionButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectIconActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectIconActionButtonHidden: {
    opacity: 0,
  },
  projectTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    // MoreVertical paints only around the center of its 14px SVG. Keep the 24px controls,
    // but pull their painted edge through the unused view-box space onto the row rail.
    marginRight: -6,
  },
  projectKebabButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectKebabButtonHidden: {
    opacity: 0,
  },
  projectKebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  projectTrailingControlSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectActionTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  projectActionTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  projectActionTooltipShortcut: {},
  projectShortcutBadgeOverlay: {
    position: "absolute",
    top: theme.spacing[2] + 1,
    right: theme.spacing[2],
  },
  workspaceRow: {
    minHeight: 36,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  workspaceRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  sidebarRowSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowContainer: {
    position: "relative",
  },
  workspaceStatusDot: {
    position: "relative",
    width: WORKSPACE_STATUS_DOT_WIDTH,
    height: 16,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workspaceArchivingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: `${theme.colors.surface0}cc`,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    zIndex: 1,
  },
  workspaceArchivingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  workspacePrBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: WORKSPACE_STATUS_DOT_WIDTH + theme.spacing[2],
  },
  workspaceCreatingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  kebabButton: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  kebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
