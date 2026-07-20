import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { GestureType } from "react-native-gesture-handler";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { GroupSectionHeader } from "@/components/sidebar/group-section-header";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import type { GroupedSidebarProject, SidebarProjectGroup } from "@/hooks/use-sidebar-groups";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { SIDEBAR_GROUP_DRAG_ENABLED } from "@/components/sidebar/sidebar-group-drag-context";
import {
  useSidebarGroupDragActiveId,
  type SidebarGroupItemDragData,
} from "@/components/sidebar/sidebar-group-drag-shared";
import {
  SidebarGroupDropTarget,
  SidebarGroupSortable,
} from "@/components/sidebar/sidebar-group-sortable";

interface ProjectGroupSectionProps {
  group: SidebarProjectGroup;
  renderProject: (info: DraggableRenderItemInfo<GroupedSidebarProject>) => React.ReactElement;
  keyExtractor: (project: GroupedSidebarProject) => string;
  // Reports WHICH group was reordered; without it every group would write over the
  // same list.
  onDragEnd: (groupId: string, projects: GroupedSidebarProject[]) => void;
  extraData?: string | null;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  // Native nests its own draggable lists; web hoists one drag context instead.
  useNestable: boolean;
  onRename: (group: SidebarProjectGroup) => void;
  onDelete: (group: SidebarProjectGroup) => void;
}

export function ProjectGroupSection({
  group,
  renderProject,
  keyExtractor,
  onDragEnd,
  extraData,
  parentGestureRef,
  onRename,
  onDelete,
  useNestable,
}: ProjectGroupSectionProps) {
  const dragActiveId = useSidebarGroupDragActiveId();

  // Read collapse state here rather than through the parent's props: the project
  // list's memo comparators know nothing about group state and would go stale.
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedGroupKeys.has(group.groupId),
  );
  const toggleGroupCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleGroupCollapsed,
  );

  const handleToggle = useCallback(() => {
    toggleGroupCollapsed(group.groupId);
  }, [toggleGroupCollapsed, group.groupId]);

  const handleRename = useCallback(() => {
    onRename(group);
  }, [onRename, group]);

  const handleDelete = useCallback(() => {
    onDelete(group);
  }, [onDelete, group]);

  const handleDragEnd = useCallback(
    (projects: GroupedSidebarProject[]) => {
      onDragEnd(group.groupId, projects);
    },
    [onDragEnd, group.groupId],
  );

  // Tags every project row with the group it currently sits in, so the shared drag
  // context can read a cross-group drop. Without it the event carries only ids.
  const getItemData = useCallback(
    (project: GroupedSidebarProject): Record<string, unknown> => {
      const data: SidebarGroupItemDragData = {
        kind: "sidebar-group-item",
        groupId: group.groupId,
        itemKey: project.viewKey,
      };
      return data as unknown as Record<string, unknown>;
    },
    [group.groupId],
  );

  // Same shape as a workspace group, one level up: the SECTION is the sortable node
  // (header and projects together, header as the handle) and the HEADER is separately a
  // drop target, so a project can be dropped onto a group by name — including a group
  // that is still empty and has no rows to drop between.
  return (
    <SidebarGroupSortable groupId={group.groupId}>
      {(sortable) => (
        <View>
          <SidebarGroupDropTarget groupId={group.groupId}>
            {(isOver) => (
              <GroupSectionHeader
                kind="project"
                groupId={group.groupId}
                groupName={group.groupName}
                count={group.projects.length}
                collapsed={collapsed}
                onToggle={handleToggle}
                onRename={handleRename}
                onDelete={handleDelete}
                dragHandleProps={sortable.dragHandleProps}
                isDragging={sortable.isDragging}
                isDropTarget={isOver}
                testID={`sidebar-project-group-${group.groupId}`}
              />
            )}
          </SidebarGroupDropTarget>
          {collapsed ? null : (
            // Same rail as a workspace group, one level up: the projects hang off their
            // group header rather than floating beside it.
            <View style={styles.railed}>
              <DraggableList
                testID={`sidebar-project-group-list-${group.groupId}`}
                data={group.projects}
                keyExtractor={keyExtractor}
                renderItem={renderProject}
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
            </View>
          )}
        </View>
      )}
    </SidebarGroupSortable>
  );
}

const styles = StyleSheet.create((theme) => ({
  railed: {
    marginLeft: TREE_INDENT_PER_LEVEL,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.surface2,
  },
}));
