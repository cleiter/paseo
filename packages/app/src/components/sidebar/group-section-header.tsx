import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Layers,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedFolder = withUnistyles(Folder);
const ThemedLayers = withUnistyles(Layers);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash = withUnistyles(Trash2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const deleteLeadingIcon = <ThemedTrash size={14} uniProps={foregroundMutedColorMapping} />;

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export type SidebarGroupKind = "project" | "workspace";

export interface GroupSectionHeaderProps {
  // Which kind of group this header belongs to. The header is shared by both levels, so
  // it has to be told, or its menu would say a bare "Rename group" and leave the user to
  // work out which of the two things they are renaming.
  kind: SidebarGroupKind;
  groupId: string;
  groupName: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  // The header IS the group's drag handle. A group is an entity now, so it has an
  // order of its own and something has to be grabbable to change it; the header is the
  // only part of a group that exists even when the group is empty.
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  // A row is hovering this header and would land in this group if dropped.
  isDropTarget?: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  indented?: boolean;
  // The derived "Ungrouped" remainder reuses this header for its row shape and its collapse
  // toggle, but it is NOT a group: it carries no folder/layers glyph (the chevron stands on
  // its own), and its title is italic to read as "the leftover, not something you named". A
  // menu and a drag handle are simply not passed by the caller; this flag only changes the
  // two things intrinsic to the header — the leading icon and the title style.
  ungrouped?: boolean;
  testID: string;
}

// Shape is the canonical hover pattern from docs/hover.md: a plain View owns hover,
// a SEPARATE inner Pressable owns the press, and the menu (itself a Pressable) is a
// sibling of that Pressable rather than a child of it. Putting the menu inside the
// toggling Pressable makes the two Pressables fight over hover state and swallows
// the menu's click entirely.
export function GroupSectionHeader({
  kind,
  groupId,
  groupName,
  count,
  collapsed,
  onToggle,
  drag,
  isDragging,
  dragHandleProps,
  isDropTarget,
  onRename,
  onDelete,
  indented,
  ungrouped,
  testID,
}: GroupSectionHeaderProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  // Static keys, chosen by kind — not a template key, so the resource types still catch
  // a typo or a missing translation.
  const labels =
    kind === "project"
      ? {
          menu: t("sidebar.projectGroup.actions.menu"),
          rename: t("sidebar.projectGroup.rename"),
          delete: t("sidebar.projectGroup.delete"),
        }
      : {
          menu: t("sidebar.workspaceGroup.actions.menu"),
          rename: t("sidebar.workspaceGroup.rename"),
          delete: t("sidebar.workspaceGroup.delete"),
        };

  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  // Memoized so the style prop is not a fresh array on every render.
  // Same hover fill as the project and workspace rows (surfaceSidebarHover). A group
  // header is a row in the tree like any other, so it has to answer the cursor the way
  // its neighbours do.
  const containerStyle = useMemo(
    () => [
      indented ? styles.containerIndented : styles.container,
      isHovered ? styles.containerHovered : null,
      isDropTarget ? styles.containerDropTarget : null,
      isDragging ? styles.dragging : null,
    ],
    [indented, isHovered, isDropTarget, isDragging],
  );
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;
  // A project group is a bucket you file things into — Work, Open Source — so it keeps the
  // folder. A workspace group is not a container at all: "In review", "Active development"
  // are STAGES of work, and Layers says that. The odd glyph belongs on the odd thing.
  const GroupIcon = kind === "project" ? ThemedFolder : ThemedLayers;
  const hasMenu = Boolean(onRename || onDelete);
  // Native and compact have no hover at all, so the control stays visible there or
  // it would be unreachable.
  const showMenu = hasMenu && (isHovered || isNative || isCompact);

  return (
    <View
      style={containerStyle}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={onToggle}
        onLongPress={drag}
        delayLongPress={250}
        style={styles.label}
        testID={testID}
        ref={dragHandleProps?.setActivatorNodeRef}
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
      >
        {/* One leading slot, same as the project row: the folder says what this is, and
            the chevron replaces it under the cursor to say what clicking will do. Showing
            both at once is two icons competing to be the affordance. The slot is fixed
            width so the title does not shift as they swap. The remainder has no glyph of
            its own, so its chevron stands alone at rest as well as on hover. */}
        <View style={styles.leadingSlot}>
          {ungrouped || isHovered ? (
            <Chevron size={14} uniProps={foregroundMutedColorMapping} />
          ) : (
            <GroupIcon size={14} uniProps={foregroundMutedColorMapping} />
          )}
        </View>
        <Text style={ungrouped ? styles.titleUngrouped : styles.title} numberOfLines={1}>
          {groupName}
        </Text>
      </Pressable>
      {/* The count lives at the far right of the row, and the menu OVERLAYS it rather
          than sitting beside it — the same trailing-slot trick the workspace rows use for
          their diff stat. The count keeps its width while hidden (opacity, not display),
          so nothing shifts when the menu appears under the cursor. */}
      <View style={styles.trailingSlot}>
        <Text style={showMenu ? styles.countHidden : styles.count}>{count}</Text>
        {showMenu ? (
          <View style={styles.trailingOverlay}>
            <DropdownMenu>
              <DropdownMenuTrigger
                hitSlop={8}
                accessibilityRole={isWeb ? undefined : "button"}
                accessibilityLabel={labels.menu}
                testID={`${testID}-menu`}
              >
                {renderTriggerIcon}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width={220}>
                {onRename ? (
                  <DropdownMenuItem
                    leading={renameLeadingIcon}
                    onSelect={onRename}
                    testID={`sidebar-group-rename-${groupId}`}
                  >
                    {labels.rename}
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <DropdownMenuItem
                    destructive
                    leading={deleteLeadingIcon}
                    onSelect={onDelete}
                    testID={`sidebar-group-delete-${groupId}`}
                  >
                    {labels.delete}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The container exists only to track hover and hold the row. A fixed minHeight
  // keeps the row from resizing when the menu swaps in, which would otherwise pull
  // the trigger out from under the cursor and flicker (docs/hover.md failure 2).
  // Same metrics as projectRow/workspaceRow in sidebar-workspace-list: minHeight 36,
  // spacing[2] of vertical padding, spacing[1] below. A group header is a row like any
  // other row in the tree, so it has to sit on the same rhythm — a taller one reads as a
  // banner rather than as the parent of the rows under it.
  // The hover fill lives on the CONTAINER, not on the inner Pressable: the fill has to
  // span the whole row, menu button included, the way projectRow and workspaceRow do.
  // The container is also what owns hover (docs/hover.md), so the two coincide.
  container: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    marginBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  containerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // A row is hovering: say "this group will take it". Dimming the header instead — the
  // obvious move — reads as disabled, which is the opposite message.
  containerDropTarget: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  dragging: {
    opacity: 0.5,
  },
  containerIndented: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    marginBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    marginLeft: theme.spacing[3],
  },
  label: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    // spacing[2], the same gap the project and workspace rows put between their leading
    // icon and their text. It was spacing[1] — half — so the folder's label sat tighter to
    // its icon than every row around it.
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    userSelect: "none",
  },
  trailingSlot: {
    position: "relative",
    flexShrink: 0,
    minWidth: 18,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  trailingOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    justifyContent: "center",
  },
  countHidden: {
    // Opacity, not display: the count must keep reserving its width under the menu,
    // or the row would reflow the moment the cursor entered it.
    opacity: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  leadingSlot: {
    // Sized by the token rather than a loose 14, and matching the icons it holds.
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    // Absorbs the free space, which is what pushes the count to the right edge.
    flex: 1,
    color: theme.colors.foreground,
    // Same size as the project and workspace rows it contains. A group header set
    // smaller than its own children reads as subordinate to them.
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  // The remainder is not something the user named, so it reads quieter than a group title:
  // italic and muted, on the same row rhythm. A standalone style rather than [title, …] —
  // the lint rule forbids composing an array in the render path.
  titleUngrouped: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontStyle: "italic",
    color: theme.colors.foregroundMuted,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
}));
