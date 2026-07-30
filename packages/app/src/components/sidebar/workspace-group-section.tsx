import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableRefObject } from "react";
import type { GestureType } from "react-native-gesture-handler";
import { GroupSectionHeader } from "@/components/sidebar/group-section-header";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import type { GroupedSidebarProject, SidebarWorkspaceGroup } from "@/hooks/use-sidebar-groups";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { SIDEBAR_GROUP_DRAG_ENABLED } from "@/components/sidebar/sidebar-group-drag-context";
import {
  useIsSidebarGroupItemDragging,
  useSidebarGroupDragActiveId,
  type SidebarGroupItemDragData,
} from "@/components/sidebar/sidebar-group-drag-shared";
import {
  SidebarGroupDropTarget,
  SidebarGroupSortable,
} from "@/components/sidebar/sidebar-group-sortable";

interface WorkspaceGroupSectionProps {
  projectKey: string;
  // Null renders the derived "Ungrouped" remainder. It looks like a group — a collapsible
  // header with a count — but it is the absence of one, so it has no glyph, no menu and no
  // drag handle, and its title is italic to say so.
  groupId: string | null;
  groupName?: string;
  workspaces: SidebarWorkspacePlacement[];
  renderWorkspace: (info: DraggableRenderItemInfo<SidebarWorkspacePlacement>) => React.ReactElement;
  keyExtractor: (workspace: SidebarWorkspacePlacement) => string;
  // Reports WHICH list was reordered. Without the groupId the writer cannot tell
  // which of the project's lists the drag belongs to, and every group would write over
  // the same one.
  onDragEnd: (groupId: string | null, workspaces: SidebarWorkspacePlacement[]) => void;
  extraData?: string | null;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  useNestable: boolean;
  group?: SidebarWorkspaceGroup;
  project?: GroupedSidebarProject;
  onRenameGroup?: (group: SidebarWorkspaceGroup, project: GroupedSidebarProject) => void;
  onDeleteGroup?: (group: SidebarWorkspaceGroup, project: GroupedSidebarProject) => void;
}

export function WorkspaceGroupSection({
  projectKey,
  groupId,
  groupName,
  workspaces,
  renderWorkspace,
  keyExtractor,
  onDragEnd,
  extraData,
  parentGestureRef,
  useNestable,
  group,
  project,
  onRenameGroup,
  onDeleteGroup,
}: WorkspaceGroupSectionProps) {
  const { t } = useTranslation();
  const dragActiveId = useSidebarGroupDragActiveId();
  const isRowDragging = useIsSidebarGroupItemDragging();

  // A long group renders its first window of rows and hides the rest behind "show more",
  // the same cap every other sidebar list uses. Drag reorders only the visible rows, and
  // the reorder write folds them back into the group's stored order (mergeWithinSlots), so
  // the rows past the cap keep their place — rearranging what is on screen never ejects the
  // tail into "Ungrouped".
  const {
    visibleItems: visibleWorkspaces,
    expanded,
    canToggle,
    toggleExpanded,
  } = useLimitedSidebarGroup(workspaces);

  // Tag every row with the group it currently lives in. Without this the shared drag
  // context can't tell which group a row came from or was dropped on, and a
  // cross-group drop is unreadable (dnd-kit's event carries only ids otherwise).
  const getItemData = useCallback(
    (workspace: SidebarWorkspacePlacement): Record<string, unknown> => {
      // The generic drag machinery speaks itemKey; at this level an item is a workspace.
      const data: SidebarGroupItemDragData = {
        kind: "sidebar-group-item",
        groupId,
        itemKey: workspace.workspaceKey,
      };
      return data as unknown as Record<string, unknown>;
    },
    [groupId],
  );

  // One collapse key for both shapes: a real group is keyed by its id, the remainder by a
  // synthetic per-project key that cannot collide with a uuid. Both ride the same
  // collapsedGroupKeys set, so the "Ungrouped" section collapses and PERSISTS exactly like a
  // group — which is the whole ask.
  const collapseKey = groupId ?? `ungrouped:${projectKey}`;

  // Read the collapse store here in the leaf rather than threading it through the
  // project block's props: the block's memo comparator does not know about group
  // state and would go stale.
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedGroupKeys.has(collapseKey),
  );
  const toggleGroupCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleGroupCollapsed,
  );

  const handleToggle = useCallback(() => {
    toggleGroupCollapsed(collapseKey);
  }, [toggleGroupCollapsed, collapseKey]);

  const handleRename = useCallback(() => {
    if (group && project) {
      onRenameGroup?.(group, project);
    }
  }, [onRenameGroup, group, project]);

  const handleDelete = useCallback(() => {
    if (group && project) {
      onDeleteGroup?.(group, project);
    }
  }, [onDeleteGroup, group, project]);

  const handleDragEnd = useCallback(
    (reordered: SidebarWorkspacePlacement[]) => {
      onDragEnd(groupId, reordered);
    },
    [onDragEnd, groupId],
  );

  const canEdit = Boolean(group && project && onRenameGroup && onDeleteGroup);
  const testID = groupId
    ? `sidebar-workspace-group-${projectKey}-${groupId}`
    : `sidebar-workspace-no-group-${projectKey}`;

  const workspaceList = collapsed ? null : (
    // The rail is the containment cue: a single left border per nesting level, stepped by
    // the same TREE_INDENT_PER_LEVEL the Files and Changes trees use so the sidebar's
    // nesting can't drift away from theirs. The remainder is railed like a group now that it
    // has a header of its own — its rows hang off it the same way a group's do.
    <View style={styles.railed}>
      <DraggableList
        testID={`${testID}-list`}
        data={visibleWorkspaces}
        keyExtractor={keyExtractor}
        renderItem={renderWorkspace}
        onDragEnd={handleDragEnd}
        extraData={extraData ?? undefined}
        scrollEnabled={false}
        useDragHandle
        nestable={useNestable}
        simultaneousGestureRef={parentGestureRef}
        externalDndContext={SIDEBAR_GROUP_DRAG_ENABLED}
        getItemData={SIDEBAR_GROUP_DRAG_ENABLED ? getItemData : undefined}
        activeId={dragActiveId}
      />
      {canToggle ? (
        <SidebarGroupToggleRow
          expanded={expanded}
          onPress={toggleExpanded}
          testID={`${testID}-show-more`}
        />
      ) : null}
    </View>
  );

  // The remainder is the ABSENCE of a group, but it renders as one: a collapsible header
  // with a count, on the same row rhythm, set apart only by an italic muted title and by
  // having no menu and no drag handle. It is not sortable (there is nothing to reorder it
  // against) and cannot be renamed or deleted, so those props are simply left off.
  //
  // It stays a drop target, for the same reason a group header is: once every workspace has
  // been grouped there are no ungrouped rows left to drop between, and the header is the only
  // place left to aim to drag one back out. When it is otherwise empty it appears only WHILE
  // a row is in flight — a standing "Ungrouped" header over nothing is noise, but it has to
  // be there the moment you need to aim at it. Dragging a GROUP does not summon it.
  if (!groupId) {
    if (workspaces.length === 0 && !isRowDragging) {
      return null;
    }
    return (
      <View style={styles.section}>
        <SidebarGroupDropTarget groupId={null}>
          <GroupSectionHeader
            kind="workspace"
            ungrouped
            groupId={collapseKey}
            groupName={t("sidebar.workspaceGroup.noGroup")}
            count={workspaces.length}
            collapsed={collapsed}
            onToggle={handleToggle}
            indented
            testID={testID}
          />
        </SidebarGroupDropTarget>
        {workspaceList}
      </View>
    );
  }

  // The sortable node is the WHOLE section, header and rows together, and the header is
  // only its handle. Making just the header sortable moved the bare headers around while
  // their rows sat still, and snapped everything into place at the end.
  return (
    <SidebarGroupSortable groupId={groupId}>
      {(sortable) => (
        <View style={styles.section}>
          <SidebarGroupDropTarget groupId={groupId}>
            <GroupSectionHeader
              kind="workspace"
              groupId={groupId}
              groupName={groupName ?? ""}
              count={workspaces.length}
              collapsed={collapsed}
              onToggle={handleToggle}
              onRename={canEdit ? handleRename : undefined}
              onDelete={canEdit ? handleDelete : undefined}
              dragHandleProps={sortable.dragHandleProps}
              isDragging={sortable.isDragging}
              indented
              testID={testID}
            />
          </SidebarGroupDropTarget>
          {workspaceList}
        </View>
      )}
    </SidebarGroupSortable>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[0],
  },
  railed: {
    marginLeft: TREE_INDENT_PER_LEVEL,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.surface2,
  },
}));
