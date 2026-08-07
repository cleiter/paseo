import {
  useCallback,
  useMemo,
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  CircleCheck,
  Copy,
  Layers,
  Minus,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Plus,
} from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { SidebarGroupRef } from "@/hooks/use-sidebar-groups";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { MenuSeparator, MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { resolveSidebarWorkspaceAccessibilityLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
// Every group this menu names is a WORKSPACE group, so the noun is Layers. The verbs are
// plain Plus/Minus: lucide has no LayersPlus, and a FolderPlus would contradict the noun.
const ThemedLayers = withUnistyles(Layers);
const ThemedPlus = withUnistyles(Plus);
const ThemedMinus = withUnistyles(Minus);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;
const workspaceGroupLeadingIcon = <ThemedLayers size={14} uniProps={foregroundMutedColorMapping} />;
const newGroupLeadingIcon = <ThemedPlus size={14} uniProps={foregroundMutedColorMapping} />;
const removeFromGroupLeadingIcon = <ThemedMinus size={14} uniProps={foregroundMutedColorMapping} />;

// The groups a row can move into are a PAGE, not a row each. The menu is then the same height
// whether the project has one group or ten, and the root row reads as the current answer —
// which is when docs/menus.md says a decision has earned a submenu.
const WORKSPACE_GROUP_PAGE_ID = "workspaceGroup";

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  openInFileManagerPath?: string | null;
  availableGroups?: SidebarGroupRef[];
  currentGroupId?: string | null;
  onMoveToGroup?: (group: SidebarGroupRef) => void;
  onMoveToNewGroup?: () => void;
  onRemoveFromGroup?: () => void;
  /**
   * Lifted so the row that reveals the kebab can keep it mounted while its menu is up. See
   * `useOpenKebabMenuVisibility`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange"
> {
  onArchive?: () => void;
}

type MenuSurface = "context" | "dropdown";

type WorkspaceGroupMenuProps = Pick<
  SidebarWorkspaceMenuProps,
  | "workspaceKey"
  | "availableGroups"
  | "currentGroupId"
  | "onMoveToGroup"
  | "onMoveToNewGroup"
  | "onRemoveFromGroup"
>;

// Binds the group to its own onSelect so the page does not create a fresh closure per group
// on every render.
function MoveToGroupItem({
  surface,
  workspaceKey,
  group,
  selected,
  onMoveToGroup,
}: {
  surface: MenuSurface;
  workspaceKey: string;
  group: SidebarGroupRef;
  selected: boolean;
  onMoveToGroup: (group: SidebarGroupRef) => void;
}) {
  const handleSelect = useCallback(() => {
    onMoveToGroup(group);
  }, [onMoveToGroup, group]);

  return (
    <WorkspaceMenuItem
      surface={surface}
      testID={`sidebar-workspace-menu-move-to-group-${workspaceKey}-${group.groupId}`}
      leading={workspaceGroupLeadingIcon}
      selected={selected}
      onSelect={handleSelect}
    >
      {group.groupName}
    </WorkspaceMenuItem>
  );
}

// Undefined when the row cannot be grouped at all — no page, and so no trigger row either.
// Both surfaces build the same page; only what opens them differs.
function useWorkspaceGroupPages(
  surface: MenuSurface,
  {
    workspaceKey,
    availableGroups = [],
    currentGroupId,
    onMoveToGroup,
    onMoveToNewGroup,
    onRemoveFromGroup,
  }: WorkspaceGroupMenuProps,
): MenuPageDefinition[] | undefined {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!onMoveToGroup || !onMoveToNewGroup) {
      return undefined;
    }
    return [
      {
        id: WORKSPACE_GROUP_PAGE_ID,
        title: t("sidebar.workspaceGroup.moveToGroup"),
        content: (
          <>
            {availableGroups.map((group) => (
              <MoveToGroupItem
                key={group.groupId}
                surface={surface}
                workspaceKey={workspaceKey}
                group={group}
                selected={group.groupId === currentGroupId}
                onMoveToGroup={onMoveToGroup}
              />
            ))}
            {availableGroups.length > 0 ? <MenuSeparator /> : null}
            <WorkspaceMenuItem
              surface={surface}
              testID={`sidebar-workspace-menu-new-group-${workspaceKey}`}
              leading={newGroupLeadingIcon}
              onSelect={onMoveToNewGroup}
            >
              {t("sidebar.workspaceGroup.moveToNewGroup")}
            </WorkspaceMenuItem>
            {onRemoveFromGroup && currentGroupId ? (
              <WorkspaceMenuItem
                surface={surface}
                testID={`sidebar-workspace-menu-remove-from-group-${workspaceKey}`}
                leading={removeFromGroupLeadingIcon}
                onSelect={onRemoveFromGroup}
              >
                {t("sidebar.workspaceGroup.removeFromGroup")}
              </WorkspaceMenuItem>
            ) : null}
          </>
        ),
      },
    ];
  }, [
    t,
    surface,
    workspaceKey,
    availableGroups,
    currentGroupId,
    onMoveToGroup,
    onMoveToNewGroup,
    onRemoveFromGroup,
  ]);
}

function WorkspaceMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function SidebarWorkspaceMenuItems({
  surface,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  availableGroups = [],
  currentGroupId,
  hasGroupPage,
}: SidebarWorkspaceMenuItemsProps & {
  surface: MenuSurface;
  // The page itself is built by the surface, which is the only place it can be declared —
  // pages are data on the surface, not children of the item list. See docs/menus.md.
  hasGroupPage: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const currentGroupName = availableGroups.find(
    (group) => group.groupId === currentGroupId,
  )?.groupName;

  return (
    <>
      {onCopyPath ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyPath}
        >
          {t("sidebar.workspace.actions.copyPath")}
        </WorkspaceMenuItem>
      ) : null}
      {onCopyBranchName ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
          leading={copyLeadingIcon}
          onSelect={onCopyBranchName}
        >
          {t("sidebar.workspace.actions.copyBranchName")}
        </WorkspaceMenuItem>
      ) : null}
      {onRename ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
          leading={renameLeadingIcon}
          onSelect={onRename}
        >
          {t("sidebar.workspace.actions.rename")}
        </WorkspaceMenuItem>
      ) : null}
      {onMarkAsRead ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
          leading={markAsReadLeadingIcon}
          onSelect={onMarkAsRead}
        >
          Mark as read
        </WorkspaceMenuItem>
      ) : null}
      {onTogglePin ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-pin-${workspaceKey}`}
          leading={isPinned ? unpinLeadingIcon : pinLeadingIcon}
          onSelect={onTogglePin}
        >
          {isPinned ? t("sidebar.workspace.actions.unpin") : t("sidebar.workspace.actions.pin")}
        </WorkspaceMenuItem>
      ) : null}
      <OpenInFileManagerMenuItem
        surface={surface}
        path={openInFileManagerPath}
        testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
      />
      {hasGroupPage ? (
        <MenuSubTrigger
          id={WORKSPACE_GROUP_PAGE_ID}
          value={currentGroupName}
          // This menu is a column of actions, every one of them carrying its glyph. A root
          // row goes without one only where the whole root is labels and their values.
          leading={workspaceGroupLeadingIcon}
          testID={`sidebar-workspace-menu-move-to-group-${workspaceKey}`}
        >
          {t("sidebar.workspaceGroup.moveToGroup")}
        </MenuSubTrigger>
      ) : null}
      {onArchive ? (
        <WorkspaceMenuItem
          surface={surface}
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? t("sidebar.workspace.actions.archive")}
        </WorkspaceMenuItem>
      ) : null}
    </>
  );
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  availableGroups,
  currentGroupId,
  onMoveToGroup,
  onMoveToNewGroup,
  onRemoveFromGroup,
  open,
  onOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const groupPages = useWorkspaceGroupPages("dropdown", {
    workspaceKey,
    availableGroups,
    currentGroupId,
    onMoveToGroup,
    onMoveToNewGroup,
    onRemoveFromGroup,
  });
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={groupPages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
      >
        <SidebarWorkspaceMenuItems
          surface="dropdown"
          workspaceKey={workspaceKey}
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
          openInFileManagerPath={openInFileManagerPath}
          availableGroups={availableGroups}
          currentGroupId={currentGroupId}
          hasGroupPage={groupPages !== undefined}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "children" | "enabledOnMobile" | "highlightStyle"
>;

export function SidebarWorkspaceContextMenu({
  children,
  contextMenuOpen,
  onContextMenuOpenChange,
  workspace,
  leadingProjectName,
  hostBadgeLabel,
  serviceSummary,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  availableGroups,
  currentGroupId,
  onMoveToGroup,
  onMoveToNewGroup,
  onRemoveFromGroup,
  accessibilityLabel,
  highlightStyle,
  ...triggerProps
}: PropsWithChildren<
  SidebarWorkspaceMenuItemsProps &
    ContextTriggerProps & {
      contextMenuOpen: boolean;
      onContextMenuOpenChange: (open: boolean) => void;
      workspace: SidebarWorkspaceEntry;
      leadingProjectName?: string | null;
      hostBadgeLabel?: string | null;
      serviceSummary?: WorkspaceServiceSummary | null;
      highlightStyle: ComponentProps<typeof ContextMenuTrigger>["highlightStyle"];
    }
>) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const { t } = useTranslation();
  const groupPages = useWorkspaceGroupPages("context", {
    workspaceKey,
    availableGroups,
    currentGroupId,
    onMoveToGroup,
    onMoveToNewGroup,
    onRemoveFromGroup,
  });
  const pullRequestLabel = workspace.prHint
    ? t("workspace.git.pr.accessibility.pullRequest", {
        number: workspace.prHint.number,
        context: getForgePresentation(normalizeForge(workspace.prHint.forge)).changeRequestContext,
      })
    : null;
  const rowAccessibilityLabel = resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel,
    pullRequestLabel,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
  });

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger
        {...triggerProps}
        enabledOnMobile={false}
        accessibilityLabel={accessibilityLabel ?? rowAccessibilityLabel}
        highlightStyle={highlightStyle}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={260}
        pages={groupPages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-context-menu-${workspaceKey}`}
      >
        <SidebarWorkspaceMenuItems
          surface="context"
          workspaceKey={workspaceKey}
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
          openInFileManagerPath={openInFileManagerPath}
          availableGroups={availableGroups}
          currentGroupId={currentGroupId}
          hasGroupPage={groupPages !== undefined}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing-content rail.
    marginRight: -7,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
