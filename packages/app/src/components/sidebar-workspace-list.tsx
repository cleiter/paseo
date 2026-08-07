import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  View,
  Text,
  Pressable,
  ScrollView,
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
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list";
import type { DraggableListDragHandleProps } from "./draggable-list.types";
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
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { WorkspaceGroupSection } from "@/components/sidebar/workspace-group-section";
import { SidebarGroupDragContext } from "@/components/sidebar/sidebar-group-drag-context";
import type { SidebarGroupDropEvent } from "@/components/sidebar/sidebar-group-drag-shared";
import { ProjectGroupSection } from "@/components/sidebar/project-group-section";
import { UngroupedProjectSection } from "@/components/sidebar/ungrouped-project-section";
import {
  type GroupedSidebarProject,
  type SidebarGroupRef,
  type SidebarProjectGroup,
  type SidebarWorkspaceGroup,
  useSidebarGroups,
} from "@/hooks/use-sidebar-groups";
import { createGroupId, useGroupActions, type GroupAssignment } from "@/hooks/use-group-actions";
import { mergeWithinSlots } from "@/utils/sidebar-reorder";

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

const workspaceKeyExtractor = (workspace: SidebarWorkspacePlacement) => workspace.workspaceKey;

const projectViewKeyExtractor = (project: SidebarProjectEntry) => project.viewKey;

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

// One list, exactly as the sidebar draws it. A drop is positional, and the document can
// only position rows it already knows — a project or workspace created since the last
// layout write is not in it, so the drop has nothing to measure against and the row snaps
// back. Handing the drawn list over is what lets the edit adopt those rows first.
function visibleWorkspaceKeys(
  project: GroupedSidebarProject,
  groupId: string | null,
): readonly string[] {
  if (groupId === null) {
    return project.ungroupedWorkspaces.map((workspace) => workspace.workspaceKey);
  }
  return (
    project.workspaceGroups
      .find((group) => group.groupId === groupId)
      ?.workspaces.map((workspace) => workspace.workspaceKey) ?? []
  );
}

function visibleProjectKeys(
  grouped: { projectGroups: SidebarProjectGroup[]; ungroupedProjects: GroupedSidebarProject[] },
  groupId: string | null,
): readonly string[] {
  if (groupId === null) {
    return grouped.ungroupedProjects.map((project) => project.viewKey);
  }
  return (
    grouped.projectGroups
      .find((group) => group.groupId === groupId)
      ?.projects.map((project) => project.viewKey) ?? []
  );
}

function ProjectBlock({
  project,
  workspaceEntriesByKey,
  collapsed,
  displayName,
  iconDataUri,
  selectionEnabled,
  showShortcutBadges,
  shortcutIndexByWorkspaceKey,
  parentGestureRef,
  onToggleCollapsed,
  onWorkspacePress,
  onWorkspaceReorder,
  onWorktreeCreated,
  drag,
  isDragging,
  dragHandleProps,
  useNestable,
  dragGestureHostPresented,
  creatingWorkspaceIds,
  activeWorkspaceSelection,
  hostBadgeByServerId,
  supportsMultiplicityByServerId,
  supportsPinningByServerId,
  isLayoutAvailable,
  onToggleWorkspacePin,
  onWorkspaceGroupReorder,
  onRenameGroup,
  onDeleteGroup,
  availableProjectGroups,
  onSetProjectGroup,
  onWorkspaceGroupDrop,
  onWorkspaceGroupDragPreview,
  onWorkspaceGroupDragPreviewCancel,
  onWorkspaceGroupsReorder,
}: {
  project: GroupedSidebarProject;
  availableProjectGroups: SidebarGroupRef[];
  onSetProjectGroup: (project: GroupedSidebarProject, assignment: GroupAssignment) => void;
  onWorkspaceGroupDrop: (
    projectKey: string,
    event: SidebarGroupDropEvent,
    visibleKeys: readonly string[],
  ) => void;
  onWorkspaceGroupDragPreview: (
    projectKey: string,
    event: SidebarGroupDropEvent,
    visibleKeys: readonly string[],
  ) => void;
  onWorkspaceGroupDragPreviewCancel: () => void;
  onWorkspaceGroupsReorder: (projectKey: string, orderedGroupIds: string[]) => void;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  collapsed: boolean;
  displayName: string;
  iconDataUri: string | null;
  selectionEnabled: boolean;
  showShortcutBadges: boolean;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  onToggleCollapsed: (projectViewKey: string) => void;
  onWorkspacePress?: () => void;
  onWorkspaceReorder: (projectViewKey: string, workspaces: SidebarWorkspacePlacement[]) => void;
  onWorkspaceGroupReorder: (
    projectKey: string,
    groupId: string | null,
    workspaces: SidebarWorkspacePlacement[],
  ) => void;
  onRenameGroup: (group: SidebarWorkspaceGroup, project: GroupedSidebarProject) => void;
  onDeleteGroup: (group: SidebarWorkspaceGroup, project: GroupedSidebarProject) => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  useNestable: boolean;
  dragGestureHostPresented?: boolean;
  creatingWorkspaceIds: ReadonlySet<string>;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
  hostBadgeByServerId: ReadonlyMap<string, HostBadgeModel>;
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
  supportsPinningByServerId: ReadonlyMap<string, boolean>;
  // Whether ANY connected host can store the layout document. Grouping is one write to
  // one replicated document, so that is the whole question — see the row gate below.
  isLayoutAvailable: boolean;
  onToggleWorkspacePin: ToggleSidebarWorkspacePin;
}) {
  const {
    visibleItems: visibleWorkspaces,
    expanded: workspacesExpanded,
    canToggle: canToggleWorkspaces,
    toggleExpanded: toggleWorkspacesExpanded,
  } = useLimitedSidebarGroup(project.workspaces);
  const rowModel = useMemo(
    () =>
      buildSidebarProjectRowModel({
        project,
        collapsed,
        supportsMultiplicityByServerId,
      }),
    [collapsed, project, supportsMultiplicityByServerId],
  );

  // Collapsed rows hide their workspace rows, so the project row carries the most urgent
  // status among them; expanded rows leave the signal to the child rows themselves.
  const aggregateStatusBucket = useSidebarProjectStatusBucket({
    workspaces: project.workspaces,
    enabled: collapsed,
  });

  // The groups that already exist in this project, offered as move targets in every
  // one of its workspace menus.
  const projectGroupRefs = useMemo<SidebarGroupRef[]>(
    () =>
      project.workspaceGroups.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
      })),
    [project.workspaceGroups],
  );

  // Built once per project rather than derived per row: a row does not know its own
  // group (the document does), and re-deriving it in every row would subscribe every
  // row to the whole layout.
  const groupIdByWorkspaceKey = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const group of project.workspaceGroups) {
      for (const workspace of group.workspaces) {
        byKey.set(workspace.workspaceKey, group.groupId);
      }
    }
    return byKey;
  }, [project.workspaceGroups]);

  const [isNewProjectGroupOpen, setIsNewProjectGroupOpen] = useState(false);
  const [isNewWorkspaceGroupOpen, setIsNewWorkspaceGroupOpen] = useState(false);
  const { createWorkspaceGroup } = useGroupActions();

  const handleOpenNewWorkspaceGroup = useCallback(() => setIsNewWorkspaceGroupOpen(true), []);
  const handleCloseNewWorkspaceGroup = useCallback(() => setIsNewWorkspaceGroupOpen(false), []);
  const handleSubmitNewWorkspaceGroup = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        createWorkspaceGroup({ projectKey: project.viewKey, name: trimmed });
      }
      setIsNewWorkspaceGroupOpen(false);
    },
    [createWorkspaceGroup, project.viewKey],
  );

  const handleMoveProjectToGroup = useCallback(
    (group: SidebarGroupRef) => {
      onSetProjectGroup(project, { groupId: group.groupId, groupName: group.groupName });
    },
    [onSetProjectGroup, project],
  );
  const handleOpenNewProjectGroup = useCallback(() => setIsNewProjectGroupOpen(true), []);
  const handleCloseNewProjectGroup = useCallback(() => setIsNewProjectGroupOpen(false), []);
  const handleSubmitNewProjectGroup = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        onSetProjectGroup(project, { groupId: createGroupId(), groupName: trimmed });
      }
      setIsNewProjectGroupOpen(false);
    },
    [onSetProjectGroup, project],
  );
  const handleRemoveProjectFromGroup = useCallback(() => {
    onSetProjectGroup(project, { groupId: null, groupName: null });
  }, [onSetProjectGroup, project]);

  const groupMenu = useMemo<ProjectGroupMenu | undefined>(
    () =>
      isLayoutAvailable
        ? {
            availableGroups: availableProjectGroups,
            currentGroupId: project.projectGroup?.groupId ?? null,
            onMoveToGroup: handleMoveProjectToGroup,
            onMoveToNewGroup: handleOpenNewProjectGroup,
            onRemoveFromGroup: handleRemoveProjectFromGroup,
          }
        : undefined,
    [
      isLayoutAvailable,
      availableProjectGroups,
      project.projectGroup,
      handleMoveProjectToGroup,
      handleOpenNewProjectGroup,
      handleRemoveProjectFromGroup,
    ],
  );

  const active = isProjectSelectedByRoute({
    selection: activeWorkspaceSelection,
    project,
    enabled: selectionEnabled,
  });

  const renderWorkspaceRow = useCallback(
    (
      item: SidebarWorkspacePlacement,
      input?: {
        drag?: () => void;
        isDragging?: boolean;
        dragHandleProps?: DraggableListDragHandleProps;
      },
    ) => {
      return (
        <MemoWorkspaceRowItem
          workspace={item}
          workspaceEntry={workspaceEntriesByKey.get(item.workspaceKey) ?? null}
          hostBadge={hostBadgeByServerId.get(item.serverId) ?? null}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(item.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canCopyBranchName={project.projectKind === "git"}
          canPin={supportsPinningByServerId.get(item.serverId) === true}
          canGroup={isLayoutAvailable}
          availableGroups={projectGroupRefs}
          currentGroupId={groupIdByWorkspaceKey.get(item.workspaceKey) ?? null}
          onToggleWorkspacePin={onToggleWorkspacePin}
          isCreating={creatingWorkspaceIds.has(item.workspaceId)}
          selectionEnabled={selectionEnabled}
          activeWorkspaceSelection={activeWorkspaceSelection}
          onWorkspacePress={onWorkspacePress}
          drag={input?.drag}
          isDragging={input?.isDragging}
          dragHandleProps={input?.dragHandleProps}
        />
      );
    },
    [
      project.projectKind,
      onToggleWorkspacePin,
      supportsPinningByServerId,
      isLayoutAvailable,
      projectGroupRefs,
      groupIdByWorkspaceKey,
      activeWorkspaceSelection,
      creatingWorkspaceIds,
      hostBadgeByServerId,
      onWorkspacePress,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      workspaceEntriesByKey,
    ],
  );

  const renderWorkspace = useCallback(
    ({
      item,
      drag: workspaceDrag,
      isActive,
      dragHandleProps: workspaceDragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspacePlacement>) => {
      return renderWorkspaceRow(item, {
        drag: workspaceDrag,
        isDragging: isActive,
        dragHandleProps: workspaceDragHandleProps,
      });
    },
    [renderWorkspaceRow],
  );

  const handleWorkspaceDragEnd = useCallback(
    (workspaces: SidebarWorkspacePlacement[]) => {
      onWorkspaceReorder(project.viewKey, workspaces);
    },
    [onWorkspaceReorder, project.viewKey],
  );

  const toast = useToast();
  const { t } = useTranslation();
  const [isRemovingProject, setIsRemovingProject] = useState(false);

  const handleRemoveProject = useCallback(() => {
    if (isRemovingProject) {
      return;
    }

    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.project.confirmations.removeTitle"),
        message: t("sidebar.project.confirmations.removeMessage", { projectName: displayName }),
        confirmLabel: t("sidebar.project.confirmations.removeConfirm"),
        cancelLabel: t("sidebar.project.confirmations.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      setIsRemovingProject(true);
      const readiness = getCurrentProjectRemoveReadiness({
        hosts: project.hosts,
      });
      if (readiness.kind === "needs_host_update") {
        toast.error(t("sidebar.project.toasts.updateHostToRemove"));
        setIsRemovingProject(false);
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
          setIsRemovingProject(false);
        });
    })();
  }, [isRemovingProject, displayName, t, toast, project.hosts]);

  const handleToggleCollapsed = useCallback(() => {
    onToggleCollapsed(project.viewKey);
  }, [onToggleCollapsed, project.viewKey]);

  const handleGroupDragEnd = useCallback(
    (groupId: string | null, workspaces: SidebarWorkspacePlacement[]) => {
      onWorkspaceGroupReorder(project.viewKey, groupId, workspaces);
    },
    [onWorkspaceGroupReorder, project.viewKey],
  );

  // A drop is ONE edit now. Membership and position used to live in different places --
  // the group on the daemon, the position in a local order store -- so a drop had to hit
  // both or the row would snap back. The document holds both, so moving the row into the
  // target list at the target position is the whole operation.
  const handleGroupDrop = useCallback(
    (event: SidebarGroupDropEvent) => {
      onWorkspaceGroupDrop(project.viewKey, event, visibleWorkspaceKeys(project, event.toGroupId));
    },
    [onWorkspaceGroupDrop, project],
  );

  const handleGroupsReorder = useCallback(
    (orderedGroupIds: string[]) => {
      onWorkspaceGroupsReorder(project.viewKey, orderedGroupIds);
    },
    [onWorkspaceGroupsReorder, project.viewKey],
  );

  const handleGroupDragPreview = useCallback(
    (event: SidebarGroupDropEvent) => {
      onWorkspaceGroupDragPreview(
        project.viewKey,
        event,
        visibleWorkspaceKeys(project, event.toGroupId),
      );
    },
    [onWorkspaceGroupDragPreview, project],
  );

  const workspaceGroupIds = useMemo(
    () => project.workspaceGroups.map((group) => group.groupId),
    [project.workspaceGroups],
  );

  // The row that follows the cursor during a drag. It is the SAME row renderer the list
  // uses, so the thing under the cursor is the thing you grabbed.
  const renderWorkspaceDragOverlay = useCallback(
    (workspaceKey: string) => {
      const workspace = project.workspaces.find((item) => item.workspaceKey === workspaceKey);
      if (!workspace) {
        return null;
      }
      return renderWorkspace({
        item: workspace,
        index: 0,
        drag: noop,
        isActive: true,
      });
    },
    [project.workspaces, renderWorkspace],
  );

  let projectChildren = null;
  if (!collapsed) {
    if (project.workspaceGroups.length > 0) {
      // Grouped: each group is its own drag context, and the leftovers fall into an
      // "Ungrouped" remainder so nothing can go missing from the project.
      projectChildren = (
        <SidebarGroupDragContext
          groupIds={workspaceGroupIds}
          onDrop={handleGroupDrop}
          onReorderGroups={handleGroupsReorder}
          renderDragOverlay={renderWorkspaceDragOverlay}
          onDragPreview={handleGroupDragPreview}
          onDragPreviewCancel={onWorkspaceGroupDragPreviewCancel}
        >
          {project.workspaceGroups.map((group) => (
            <WorkspaceGroupSection
              key={group.groupId}
              projectKey={project.viewKey}
              groupId={group.groupId}
              groupName={group.groupName}
              workspaces={group.workspaces}
              renderWorkspace={renderWorkspace}
              keyExtractor={workspaceKeyExtractor}
              onDragEnd={handleGroupDragEnd}
              extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
              parentGestureRef={parentGestureRef}
              useNestable={useNestable}
              group={group}
              project={project}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
            />
          ))}
          {/* Rendered even when EMPTY, unlike before. Once every workspace has been
              grouped there are no ungrouped rows left to drop between, and without the
              label standing there as a target you could never drag one back out. */}
          <WorkspaceGroupSection
            projectKey={project.viewKey}
            groupId={null}
            workspaces={project.ungroupedWorkspaces}
            renderWorkspace={renderWorkspace}
            keyExtractor={workspaceKeyExtractor}
            onDragEnd={handleGroupDragEnd}
            extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
            parentGestureRef={parentGestureRef}
            useNestable={useNestable}
          />
        </SidebarGroupDragContext>
      );
    } else if (project.workspaces.length > 0) {
      projectChildren = (
        <>
          <DraggableList
            testID={`sidebar-workspace-list-${project.viewKey}`}
            data={visibleWorkspaces}
            keyExtractor={workspaceKeyExtractor}
            renderItem={renderWorkspace}
            onDragEnd={handleWorkspaceDragEnd}
            extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
            scrollEnabled={false}
            useDragHandle
            nestable={useNestable}
            simultaneousGestureRef={parentGestureRef}
            gestureHostPresented={dragGestureHostPresented}
            containerStyle={styles.workspaceListContainer}
          />
          {canToggleWorkspaces ? (
            <SidebarGroupToggleRow
              expanded={workspacesExpanded}
              onPress={toggleWorkspacesExpanded}
              testID={`sidebar-project-show-more-${project.viewKey}`}
            />
          ) : null}
        </>
      );
    } else if (rowModel.trailingAction.kind === "new_workspace") {
      projectChildren = (
        <NewWorkspaceGhostRow
          project={project}
          displayName={displayName}
          worktreeTarget={rowModel.trailingAction.target}
          onWorkspacePress={onWorkspacePress}
        />
      );
    }
  }

  return (
    <View
      role="group"
      accessibilityLabel={displayName}
      style={projectChildren ? styles.projectBlockExpanded : undefined}
    >
      <ProjectHeaderRow
        groupMenu={groupMenu}
        onNewWorkspaceGroup={isLayoutAvailable ? handleOpenNewWorkspaceGroup : undefined}
        project={project}
        displayName={displayName}
        iconDataUri={iconDataUri}
        statusBucket={aggregateStatusBucket}
        selected={false}
        chevron={rowModel.chevron}
        onPress={handleToggleCollapsed}
        worktreeTarget={
          rowModel.trailingAction.kind === "new_workspace" ? rowModel.trailingAction.target : null
        }
        isProjectActive={active}
        onWorkspacePress={onWorkspacePress}
        onWorktreeCreated={onWorktreeCreated}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isRemovingProject}
        menuController={null}
        onRemoveProject={handleRemoveProject}
        removeProjectStatus={isRemovingProject ? "pending" : "idle"}
        dragHandleProps={dragHandleProps}
      />

      {projectChildren}
      {isNewProjectGroupOpen ? (
        <AdaptiveRenameModal
          visible
          title={t("sidebar.projectGroup.newGroupTitle")}
          initialValue=""
          placeholder={t("sidebar.projectGroup.newGroupPlaceholder")}
          submitLabel={t("sidebar.group.create")}
          onClose={handleCloseNewProjectGroup}
          onSubmit={handleSubmitNewProjectGroup}
          testID={`sidebar-project-new-group-modal-${project.viewKey}`}
        />
      ) : null}
      {isNewWorkspaceGroupOpen ? (
        <AdaptiveRenameModal
          visible
          title={t("sidebar.workspaceGroup.newGroupTitle")}
          initialValue=""
          placeholder={t("sidebar.workspaceGroup.newGroupPlaceholder")}
          submitLabel={t("sidebar.group.create")}
          onClose={handleCloseNewWorkspaceGroup}
          onSubmit={handleSubmitNewWorkspaceGroup}
          testID={`sidebar-project-new-workspace-group-modal-${project.viewKey}`}
        />
      ) : null}
    </View>
  );
}

type ProjectBlockProps = Parameters<typeof ProjectBlock>[0];

// oxlint-disable-next-line complexity
function areProjectBlockPropsEqual(previous: ProjectBlockProps, next: ProjectBlockProps): boolean {
  return (
    previous.project === next.project &&
    previous.workspaceEntriesByKey === next.workspaceEntriesByKey &&
    previous.collapsed === next.collapsed &&
    previous.displayName === next.displayName &&
    previous.iconDataUri === next.iconDataUri &&
    previous.selectionEnabled === next.selectionEnabled &&
    previous.showShortcutBadges === next.showShortcutBadges &&
    previous.shortcutIndexByWorkspaceKey === next.shortcutIndexByWorkspaceKey &&
    previous.hostBadgeByServerId === next.hostBadgeByServerId &&
    previous.supportsMultiplicityByServerId === next.supportsMultiplicityByServerId &&
    previous.supportsPinningByServerId === next.supportsPinningByServerId &&
    previous.isLayoutAvailable === next.isLayoutAvailable &&
    previous.onToggleWorkspacePin === next.onToggleWorkspacePin &&
    previous.parentGestureRef === next.parentGestureRef &&
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.onWorkspaceReorder === next.onWorkspaceReorder &&
    previous.onWorkspaceGroupReorder === next.onWorkspaceGroupReorder &&
    previous.onRenameGroup === next.onRenameGroup &&
    previous.onDeleteGroup === next.onDeleteGroup &&
    previous.availableProjectGroups === next.availableProjectGroups &&
    previous.onSetProjectGroup === next.onSetProjectGroup &&
    previous.onWorkspaceGroupDrop === next.onWorkspaceGroupDrop &&
    previous.onWorkspaceGroupDragPreview === next.onWorkspaceGroupDragPreview &&
    previous.onWorkspaceGroupDragPreviewCancel === next.onWorkspaceGroupDragPreviewCancel &&
    previous.onWorkspaceGroupsReorder === next.onWorkspaceGroupsReorder &&
    previous.onWorktreeCreated === next.onWorktreeCreated &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previous.useNestable === next.useNestable &&
    previous.dragGestureHostPresented === next.dragGestureHostPresented &&
    previous.creatingWorkspaceIds === next.creatingWorkspaceIds &&
    areProjectBlockSelectionsEqual(previous, next)
  );
}

function areProjectBlockSelectionsEqual(
  previous: ProjectBlockProps,
  next: ProjectBlockProps,
): boolean {
  const previousActive = isProjectSelectedByRoute({
    selection: previous.activeWorkspaceSelection,
    project: previous.project,
    enabled: previous.selectionEnabled,
  });
  const nextActive = isProjectSelectedByRoute({
    selection: next.activeWorkspaceSelection,
    project: next.project,
    enabled: next.selectionEnabled,
  });
  if (previousActive !== nextActive) {
    return false;
  }
  if (!previousActive) {
    return true;
  }
  return (
    activeWorkspaceSelectionKey(previous.activeWorkspaceSelection) ===
    activeWorkspaceSelectionKey(next.activeWorkspaceSelection)
  );
}

const MemoProjectBlock = memo(ProjectBlock, areProjectBlockPropsEqual);

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

function ProjectModeList({
  projects,
  pinnedGroups,
  workspaceEntriesByKey,
  collapsedProjectKeys,
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
  const [creatingWorkspaceIds, setCreatingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const creatingWorkspaceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const showShortcutBadges = useShowShortcutBadges();
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const togglePinnedCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.togglePinnedCollapsed,
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
  const {
    visibleItems: visiblePinnedChats,
    expanded: pinnedChatsExpanded,
    canToggle: canTogglePinnedChats,
    toggleExpanded: togglePinnedChatsExpanded,
  } = useLimitedSidebarGroup(pinnedChats);
  // Groups organise what is left after the Pinned section has hoisted its chats out,
  // so this runs on unpinnedProjects, never on the raw project list.
  const groupedSidebar = useSidebarGroups(unpinnedProjects);
  const projectIconTargets = useMemo(() => resolveSidebarProjectIconTargets(projects), [projects]);
  const nativeScrollGestureProps = useMemo(
    () =>
      parentGestureRef
        ? ({
            // NestableScrollContainer forwards props to RNGH ScrollView. Keep
            // vertical scroll and sidebar close pan simultaneous: vertical
            // intent scrolls immediately, clear horizontal intent can still
            // activate close from inside the list.
            simultaneousHandlers: parentGestureRef,
          } as object)
        : undefined,
    [parentGestureRef],
  );

  const projectIconByProjectViewKey = useProjectIcons({
    projects: projectIconTargets,
  });

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

  // One hook for every layout write in this component. Both levels edit the same
  // document, so there is no reason for two.
  const {
    isAvailable: isLayoutAvailable,
    assignProjectGroup,
    renameProjectGroup,
    deleteProjectGroup,
    reorderProjectGroups,
    reorderProjectsInGroup,
    moveProjectToGroup,
    renameWorkspaceGroup,
    deleteWorkspaceGroup,
    moveWorkspaceToGroup,
    reorderWorkspaceGroups,
    reorderWorkspacesInGroup,
    setPinnedWorkspaceOrder,
    previewWorkspaceMove,
    previewProjectMove,
    cancelMovePreview,
  } = useGroupActions();

  // Every list the sidebar draws IS a document array, so a drag can hand its list
  // straight back — no merge, no slot arithmetic. The local order store is still written
  // when no host can hold a layout (an old daemon), which is the only case where it is
  // still the thing being read.
  const handleProjectDragEnd = useCallback(
    (reorderedProjects: SidebarProjectEntry[]) => {
      const reorderedProjectKeys = reorderedProjects.map((project) => project.viewKey);
      if (isLayoutAvailable) {
        reorderProjectsInGroup({ groupId: null, orderedVisibleKeys: reorderedProjectKeys });
        return;
      }

      const currentProjectOrder = getProjectOrder();
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        })
      ) {
        return;
      }

      setProjectOrder(
        mergeWithRemainder({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        }),
      );
    },
    [isLayoutAvailable, reorderProjectsInGroup, getProjectOrder, setProjectOrder],
  );

  // Same slot-preserving reorder as workspaces: a project group's drag list only
  // sees its own members, and hoisting them to the front would move the group.
  const handleProjectGroupDragEnd = useCallback(
    (groupId: string, reorderedProjects: GroupedSidebarProject[]) => {
      const reorderedProjectKeys = reorderedProjects.map((project) => project.viewKey);
      if (isLayoutAvailable) {
        reorderProjectsInGroup({ groupId, orderedVisibleKeys: reorderedProjectKeys });
        return;
      }

      const currentProjectOrder = getProjectOrder();
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        })
      ) {
        return;
      }

      setProjectOrder(
        mergeWithinSlots({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        }),
      );
    },
    [isLayoutAvailable, reorderProjectsInGroup, getProjectOrder, setProjectOrder],
  );

  // Every project group that exists anywhere in the sidebar, offered as a move target
  // on every project row.
  const availableProjectGroups = useMemo<SidebarGroupRef[]>(
    () =>
      groupedSidebar.projectGroups.map((group) => ({
        groupId: group.groupId,
        groupName: group.groupName,
      })),
    [groupedSidebar.projectGroups],
  );

  // The dropped row takes the slot of whatever it landed on, in the project's single
  // flat order. That is what makes it appear inside the target group next to that row
  // instead of springing back to its old group.
  // Covers BOTH cases the drag context can produce: a row dropped on another row (which
  // may be in a different group), and a row dropped on a group HEADER — the only way to
  // fill an empty group, since it has no rows to drop between. A null overWorkspaceKey
  // means "no position was named", so it lands at the end.
  const handleWorkspaceGroupDrop = useCallback(
    (projectKey: string, event: SidebarGroupDropEvent, visibleKeys: readonly string[]) => {
      moveWorkspaceToGroup({
        projectKey,
        workspaceKey: event.itemKey,
        groupId: event.toGroupId,
        beforeKey: event.overItemKey,
        after: event.after,
        visibleKeys,
      });
    },
    [moveWorkspaceToGroup],
  );

  const handleWorkspaceGroupsReorder = useCallback(
    (projectKey: string, orderedGroupIds: string[]) => {
      reorderWorkspaceGroups({ projectKey, orderedIds: orderedGroupIds });
    },
    [reorderWorkspaceGroups],
  );

  // Shown, not saved. The drop commits it; abandoning the drag throws it away.
  const handleWorkspaceGroupDragPreview = useCallback(
    (projectKey: string, event: SidebarGroupDropEvent, visibleKeys: readonly string[]) => {
      previewWorkspaceMove({
        projectKey,
        workspaceKey: event.itemKey,
        groupId: event.toGroupId,
        beforeKey: event.overItemKey,
        after: event.after,
        visibleKeys,
      });
    },
    [previewWorkspaceMove],
  );

  const handleSetProjectGroup = useCallback(
    (project: GroupedSidebarProject, assignment: GroupAssignment) => {
      assignProjectGroup([project.viewKey], assignment);
    },
    [assignProjectGroup],
  );

  const [renamingProjectGroup, setRenamingProjectGroup] = useState<SidebarProjectGroup | null>(
    null,
  );

  const handleRenameProjectGroup = useCallback((group: SidebarProjectGroup) => {
    setRenamingProjectGroup(group);
  }, []);

  const handleCloseRenameProjectGroup = useCallback(() => {
    setRenamingProjectGroup(null);
  }, []);

  const handleSubmitRenameProjectGroup = useCallback(
    (nextName: string) => {
      if (!renamingProjectGroup) {
        return;
      }
      const trimmed = nextName.trim();
      if (trimmed.length > 0) {
        // One edit. The group is an entity, so renaming it does not mean rewriting
        // every row that happens to be inside it.
        renameProjectGroup(renamingProjectGroup.groupId, trimmed);
      }
      setRenamingProjectGroup(null);
    },
    [renamingProjectGroup, renameProjectGroup],
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

  // A group's drag list only ever sees its own members, so the reordered keys are a
  // subset. mergeWithRemainder would hoist them to the front of the project, which
  // would drag the whole group to the top. mergeWithinSlots permutes them inside the
  // slots they already hold, leaving every other row (and every other group) put.
  const handleWorkspaceGroupReorder = useCallback(
    (
      projectKey: string,
      groupId: string | null,
      reorderedWorkspaces: SidebarWorkspacePlacement[],
    ) => {
      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      if (isLayoutAvailable) {
        reorderWorkspacesInGroup({
          projectKey,
          groupId,
          orderedVisibleKeys: reorderedWorkspaceKeys,
        });
        return;
      }

      const currentWorkspaceOrder = getWorkspaceOrder(projectKey);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setWorkspaceOrder(
        projectKey,
        mergeWithinSlots({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [isLayoutAvailable, reorderWorkspacesInGroup, getWorkspaceOrder, setWorkspaceOrder],
  );

  const [renamingGroup, setRenamingGroup] = useState<{
    group: SidebarWorkspaceGroup;
    project: GroupedSidebarProject;
  } | null>(null);

  const handleRenameWorkspaceGroup = useCallback(
    (group: SidebarWorkspaceGroup, project: GroupedSidebarProject) => {
      setRenamingGroup({ group, project });
    },
    [],
  );

  const handleCloseRenameGroup = useCallback(() => {
    setRenamingGroup(null);
  }, []);

  const handleSubmitRenameGroup = useCallback(
    (nextName: string) => {
      if (!renamingGroup) {
        return;
      }
      const trimmed = nextName.trim();
      if (trimmed.length > 0) {
        renameWorkspaceGroup(renamingGroup.group.groupId, trimmed);
      }
      setRenamingGroup(null);
    },
    [renamingGroup, renameWorkspaceGroup],
  );

  const handleDeleteWorkspaceGroup = useCallback(
    (group: SidebarWorkspaceGroup, _project: GroupedSidebarProject) => {
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

  const handleWorkspaceReorder = useCallback(
    (projectViewKey: string, reorderedWorkspaces: SidebarWorkspacePlacement[]) => {
      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      if (isLayoutAvailable) {
        reorderWorkspacesInGroup({
          projectKey: projectViewKey,
          groupId: null,
          orderedVisibleKeys: reorderedWorkspaceKeys,
        });
        return;
      }

      const currentWorkspaceOrder = getWorkspaceOrder(projectViewKey);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setWorkspaceOrder(
        projectViewKey,
        mergeWithRemainder({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [isLayoutAvailable, reorderWorkspacesInGroup, getWorkspaceOrder, setWorkspaceOrder],
  );

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

  const renderProjectBlock = useCallback(
    (
      item: GroupedSidebarProject,
      dragState: {
        drag: () => void;
        isDragging: boolean;
        dragHandleProps?: DraggableRenderItemInfo<GroupedSidebarProject>["dragHandleProps"];
      },
      // The drag overlay renders the block COLLAPSED: you grabbed the project's header,
      // and that is what should follow the cursor. Carrying the whole block — every
      // workspace group and every row under it — blankets the sidebar you are trying to
      // aim at, and hides the very drop targets the drag is for.
      forceCollapsed = false,
    ) => {
      return (
        <MemoProjectBlock
          key={item.viewKey}
          project={item}
          workspaceEntriesByKey={workspaceEntriesByKey}
          collapsed={forceCollapsed || collapsedProjectKeys.has(item.viewKey)}
          displayName={item.projectName}
          iconDataUri={projectIconByProjectViewKey.get(item.viewKey) ?? null}
          selectionEnabled={selectionEnabled}
          showShortcutBadges={showShortcutBadges}
          shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
          parentGestureRef={parentGestureRef}
          onToggleCollapsed={onToggleProjectCollapsed}
          onWorkspacePress={onWorkspacePress}
          onWorkspaceReorder={handleWorkspaceReorder}
          onWorkspaceGroupReorder={handleWorkspaceGroupReorder}
          onRenameGroup={handleRenameWorkspaceGroup}
          onDeleteGroup={handleDeleteWorkspaceGroup}
          availableProjectGroups={availableProjectGroups}
          onSetProjectGroup={handleSetProjectGroup}
          onWorkspaceGroupDrop={handleWorkspaceGroupDrop}
          onWorkspaceGroupDragPreview={handleWorkspaceGroupDragPreview}
          onWorkspaceGroupDragPreviewCancel={cancelMovePreview}
          onWorkspaceGroupsReorder={handleWorkspaceGroupsReorder}
          onWorktreeCreated={handleWorktreeCreated}
          drag={dragState.drag}
          isDragging={dragState.isDragging}
          dragHandleProps={dragState.dragHandleProps}
          useNestable={platformIsNative}
          dragGestureHostPresented={dragGestureHostPresented}
          creatingWorkspaceIds={creatingWorkspaceIds}
          activeWorkspaceSelection={activeWorkspaceSelection}
          hostBadgeByServerId={hostBadgeByServerId}
          supportsMultiplicityByServerId={supportsMultiplicityByServerId}
          supportsPinningByServerId={supportsPinningByServerId}
          isLayoutAvailable={isLayoutAvailable}
          onToggleWorkspacePin={onToggleWorkspacePin}
        />
      );
    },
    [
      collapsedProjectKeys,
      activeWorkspaceSelection,
      handleWorktreeCreated,
      handleWorkspaceReorder,
      handleWorkspaceGroupReorder,
      handleWorkspaceGroupDragPreview,
      cancelMovePreview,
      handleRenameWorkspaceGroup,
      handleDeleteWorkspaceGroup,
      availableProjectGroups,
      handleSetProjectGroup,
      handleWorkspaceGroupsReorder,
      handleWorkspaceGroupDrop,
      hostBadgeByServerId,
      supportsMultiplicityByServerId,
      supportsPinningByServerId,
      isLayoutAvailable,
      onToggleWorkspacePin,
      onWorkspacePress,
      onToggleProjectCollapsed,
      parentGestureRef,
      dragGestureHostPresented,
      projectIconByProjectViewKey,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      workspaceEntriesByKey,
      creatingWorkspaceIds,
    ],
  );

  const renderProject = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<GroupedSidebarProject>) =>
      renderProjectBlock(item, { drag, isDragging: isActive, dragHandleProps }),
    [renderProjectBlock],
  );

  const projectGroupIds = useMemo(
    () => groupedSidebar.projectGroups.map((group) => group.groupId),
    [groupedSidebar.projectGroups],
  );

  // A project dropped onto another group. One edit: the document holds membership and
  // position together, so there is nothing else to keep in step.
  const handleProjectGroupDrop = useCallback(
    (event: SidebarGroupDropEvent) => {
      moveProjectToGroup({
        projectKey: event.itemKey,
        groupId: event.toGroupId,
        beforeKey: event.overItemKey,
        after: event.after,
        visibleKeys: visibleProjectKeys(groupedSidebar, event.toGroupId),
      });
    },
    [moveProjectToGroup, groupedSidebar],
  );

  // Shown, not saved: opens the gap in the group under the cursor. The drop commits it.
  const handleProjectGroupDragPreview = useCallback(
    (event: SidebarGroupDropEvent) => {
      previewProjectMove({
        projectKey: event.itemKey,
        groupId: event.toGroupId,
        beforeKey: event.overItemKey,
        after: event.after,
        visibleKeys: visibleProjectKeys(groupedSidebar, event.toGroupId),
      });
    },
    [previewProjectMove, groupedSidebar],
  );

  // The row that follows the cursor. Same renderer the list uses, so what is under the
  // cursor is what you grabbed.
  const renderProjectDragOverlay = useCallback(
    (projectKey: string) => {
      const project =
        groupedSidebar.projectGroups
          .flatMap((group) => group.projects)
          .find((entry) => entry.viewKey === projectKey) ??
        groupedSidebar.ungroupedProjects.find((entry) => entry.viewKey === projectKey);
      if (!project) {
        return null;
      }
      return renderProjectBlock(project, { drag: noop, isDragging: true }, true);
    },
    [groupedSidebar.projectGroups, groupedSidebar.ungroupedProjects, renderProjectBlock],
  );

  // Reordering the groups is one edit to the document: array order IS group order, so
  // there is no rank to renumber and nothing for two devices to disagree about.
  const handleProjectGroupOrderChange = useCallback(
    (orderedGroupIds: string[]) => {
      reorderProjectGroups(orderedGroupIds);
    },
    [reorderProjectGroups],
  );

  const renderPinnedChat = useCallback(
    (
      workspace: SidebarWorkspacePlacement,
      dragInfo?: Pick<
        DraggableRenderItemInfo<SidebarWorkspacePlacement>,
        "drag" | "dragHandleProps"
      > & { isDragging: boolean },
    ) => {
      return (
        <MemoWorkspaceRowItem
          key={workspace.workspaceKey}
          workspace={workspace}
          workspaceEntry={workspaceEntriesByKey.get(workspace.workspaceKey) ?? null}
          hostBadge={hostBadgeByServerId.get(workspace.serverId) ?? null}
          leadingProjectName={workspace.projectName}
          leadingProjectIconDataUri={
            projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null
          }
          shortcutNumber={shortcutIndexByWorkspaceKey.get(workspace.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canCopyBranchName={workspace.projectKind === "git"}
          canPin={supportsPinningByServerId.get(workspace.serverId) === true}
          onToggleWorkspacePin={onToggleWorkspacePin}
          isCreating={creatingWorkspaceIds.has(workspace.workspaceId)}
          selectionEnabled={selectionEnabled}
          activeWorkspaceSelection={activeWorkspaceSelection}
          onWorkspacePress={onWorkspacePress}
          drag={dragInfo?.drag}
          isDragging={dragInfo?.isDragging}
          dragHandleProps={dragInfo?.dragHandleProps}
        />
      );
    },
    [
      activeWorkspaceSelection,
      creatingWorkspaceIds,
      hostBadgeByServerId,
      onWorkspacePress,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      supportsPinningByServerId,
      onToggleWorkspacePin,
      projectIconByProjectViewKey,
      workspaceEntriesByKey,
    ],
  );

  const renderPinnedItem = useCallback(
    ({
      item,
      drag,
      isActive,
      dragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspacePlacement>) =>
      renderPinnedChat(item, { drag, isDragging: isActive, dragHandleProps }),
    [renderPinnedChat],
  );

  // The Pinned section owns its drag outright — it is one flat list and nothing can be
  // dragged into or out of it (pinning is the ⋯ menu's job), so it needs none of the shared
  // group drag context. Which also means it reorders on native, where a drag cannot cross
  // between lists at all.
  const handlePinnedDragEnd = useCallback(
    (reordered: SidebarWorkspacePlacement[]) => {
      setPinnedWorkspaceOrder(reordered.map((workspace) => workspace.workspaceKey));
    },
    [setPinnedWorkspaceOrder],
  );

  const pinnedBody = useMemo(() => {
    if (pinnedCollapsed) {
      return null;
    }
    // Cap the initial render at the same 20-row limit every other sidebar list uses, with a
    // "show more" toggle past that. Drag reorders only the VISIBLE rows, but the pinned-order
    // write folds a visible reorder back into the full order (mergeWithinSlots), so the hidden
    // tail keeps its place — you never lose the rows beyond the cap by rearranging the ones on
    // screen. Pinning 20+ workspaces is pathological, so this rarely bites at all.
    const toggle = canTogglePinnedChats ? (
      <SidebarGroupToggleRow
        expanded={pinnedChatsExpanded}
        onPress={togglePinnedChatsExpanded}
        testID="sidebar-pinned-show-more"
      />
    ) : null;
    // No host can store a layout, so there is no order to write. The section still renders
    // — pinning itself is older than this document and does not depend on it — it simply
    // cannot be rearranged, and stays in pinnedAt order.
    if (!isLayoutAvailable) {
      return (
        <>
          {visiblePinnedChats.map((workspace) => renderPinnedChat(workspace))}
          {toggle}
        </>
      );
    }
    return (
      <>
        <DraggableList
          testID="sidebar-pinned-list"
          data={visiblePinnedChats}
          keyExtractor={workspaceKeyExtractor}
          renderItem={renderPinnedItem}
          onDragEnd={handlePinnedDragEnd}
          scrollEnabled={false}
          useDragHandle
          nestable={platformIsNative}
          simultaneousGestureRef={parentGestureRef}
          extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
        />
        {toggle}
      </>
    );
  }, [
    activeWorkspaceSelection,
    canTogglePinnedChats,
    handlePinnedDragEnd,
    isLayoutAvailable,
    parentGestureRef,
    pinnedChatsExpanded,
    pinnedCollapsed,
    renderPinnedChat,
    renderPinnedItem,
    togglePinnedChatsExpanded,
    visiblePinnedChats,
  ]);

  const content = (
    <>
      {pinnedChats.length > 0 ? (
        <View style={styles.pinnedSection} testID="sidebar-pinned-section">
          <PinnedSectionHeader collapsed={pinnedCollapsed} onToggle={togglePinnedCollapsed} />
          {pinnedBody}
        </View>
      ) : null}
      {unpinnedProjects.length > 0 || hasActiveHostFilter ? listHeaderComponent : null}
      {projects.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle} testID="sidebar-project-empty-state">
            {t("sidebar.project.empty.title")}
          </Text>
          <Text style={styles.emptyText}>{t("sidebar.project.empty.description")}</Text>
          <Button variant="ghost" size="sm" leftIcon={Plus} onPress={onAddProject}>
            {t("sidebar.actions.addProject")}
          </Button>
        </View>
      ) : (
        <>
          {/* ONE drag context for the whole project level: the group sections, the
              projects inside them, and the ungrouped remainder. Each group's project list
              used to own a DndContext of its own, and dnd-kit cannot move an item between
              two of them — so a project could never be dropped into another group. The
              same context makes each group HEADER a drop target, which is how a project
              lands in a group that is still empty. */}
          <SidebarGroupDragContext
            groupIds={projectGroupIds}
            onDrop={handleProjectGroupDrop}
            onReorderGroups={handleProjectGroupOrderChange}
            renderDragOverlay={renderProjectDragOverlay}
            onDragPreview={handleProjectGroupDragPreview}
            onDragPreviewCancel={cancelMovePreview}
          >
            {groupedSidebar.projectGroups.map((group) => (
              <ProjectGroupSection
                key={group.groupId}
                group={group}
                renderProject={renderProject}
                keyExtractor={projectViewKeyExtractor}
                onDragEnd={handleProjectGroupDragEnd}
                extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
                parentGestureRef={parentGestureRef}
                onRename={handleRenameProjectGroup}
                onDelete={handleDeleteProjectGroup}
                useNestable={platformIsNative}
              />
            ))}
            {/* The remainder is the absence of a group, not a group: a plain section
                label, no chevron, no folder, nothing to rename. It only earns its space
                once a real project group exists — otherwise it would be a label over the
                whole sidebar, which is exactly the change a non-user must never see. It
                IS a drop target though, and appears while a project is in flight even
                when empty, or a project grouped away could never be dragged back out. */}
            <UngroupedProjectSection
              projects={groupedSidebar.ungroupedProjects}
              hasProjectGroups={groupedSidebar.projectGroups.length > 0}
              renderProject={renderProject}
              keyExtractor={projectViewKeyExtractor}
              onDragEnd={handleProjectDragEnd}
              extraData={activeWorkspaceSelectionKey(activeWorkspaceSelection)}
              parentGestureRef={parentGestureRef}
              useNestable={platformIsNative}
            />
          </SidebarGroupDragContext>
        </>
      )}
      {listFooterComponent}
      {renamingGroup ? (
        <AdaptiveRenameModal
          visible
          title={t("sidebar.workspaceGroup.renameGroupTitle")}
          initialValue={renamingGroup.group.groupName}
          placeholder={t("sidebar.workspaceGroup.newGroupPlaceholder")}
          submitLabel={t("sidebar.group.save")}
          onClose={handleCloseRenameGroup}
          onSubmit={handleSubmitRenameGroup}
          testID="sidebar-group-rename-modal"
        />
      ) : null}
      {renamingProjectGroup ? (
        <AdaptiveRenameModal
          visible
          title={t("sidebar.projectGroup.renameGroupTitle")}
          initialValue={renamingProjectGroup.groupName}
          placeholder={t("sidebar.projectGroup.newGroupPlaceholder")}
          submitLabel={t("sidebar.group.save")}
          onClose={handleCloseRenameProjectGroup}
          onSubmit={handleSubmitRenameProjectGroup}
          testID="sidebar-project-group-rename-modal"
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.container}>
      {platformIsNative ? (
        <NestableScrollContainer
          {...nativeScrollGestureProps}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </ScrollView>
      )}
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
