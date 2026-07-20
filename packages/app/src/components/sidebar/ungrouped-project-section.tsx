import { useCallback } from "react";
import type { MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { GestureType } from "react-native-gesture-handler";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { GroupSectionHeader } from "@/components/sidebar/group-section-header";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { TREE_INDENT_PER_LEVEL } from "@/components/tree-primitives";
import type { GroupedSidebarProject } from "@/hooks/use-sidebar-groups";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { SIDEBAR_GROUP_DRAG_ENABLED } from "@/components/sidebar/sidebar-group-drag-context";
import {
  useIsSidebarGroupItemDragging,
  useSidebarGroupDragActiveId,
  type SidebarGroupItemDragData,
} from "@/components/sidebar/sidebar-group-drag-shared";
import { SidebarGroupDropTarget } from "@/components/sidebar/sidebar-group-sortable";

// There is exactly one project-level remainder — the projects in no project group — so its
// collapse state rides a single fixed key rather than a per-item one. Namespaced so it
// cannot collide with a group's uuid.
const UNGROUPED_PROJECTS_COLLAPSE_KEY = "ungrouped-projects";

interface UngroupedProjectSectionProps {
  projects: GroupedSidebarProject[];
  // The header only earns its space once a real project group exists. Without one it would
  // be a header over the entire sidebar — exactly the change someone who does not use
  // grouping must never see.
  hasProjectGroups: boolean;
  renderProject: (info: DraggableRenderItemInfo<GroupedSidebarProject>) => React.ReactElement;
  keyExtractor: (project: GroupedSidebarProject) => string;
  onDragEnd: (projects: GroupedSidebarProject[]) => void;
  extraData?: string | null;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  // Native nests its own draggable lists; web hoists one drag context instead.
  useNestable: boolean;
}

export function UngroupedProjectSection({
  projects,
  hasProjectGroups,
  renderProject,
  keyExtractor,
  onDragEnd,
  extraData,
  parentGestureRef,
  useNestable,
}: UngroupedProjectSectionProps) {
  const { t } = useTranslation();
  const dragActiveId = useSidebarGroupDragActiveId();
  const isItemDragging = useIsSidebarGroupItemDragging();

  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    state.collapsedGroupKeys.has(UNGROUPED_PROJECTS_COLLAPSE_KEY),
  );
  const toggleGroupCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleGroupCollapsed,
  );
  const handleToggle = useCallback(() => {
    toggleGroupCollapsed(UNGROUPED_PROJECTS_COLLAPSE_KEY);
  }, [toggleGroupCollapsed]);

  const getItemData = useCallback((project: GroupedSidebarProject): Record<string, unknown> => {
    const data: SidebarGroupItemDragData = {
      kind: "sidebar-group-item",
      groupId: null,
      itemKey: project.viewKey,
    };
    return data as unknown as Record<string, unknown>;
  }, []);

  // The remainder renders exactly like the workspace-level one, one level up: a collapsible
  // header — italic, no glyph, no menu, no drag handle — over a railed list. Once every
  // project has been grouped there are no ungrouped rows left to drop between, so without the
  // header standing there as a target a project could never be dragged back out; it appears
  // while a project is in flight and stays hidden otherwise, since a header over nothing is
  // noise.
  //
  // Only WITH a project group though. With none, the projects are the whole sidebar, so they
  // render as a bare list with no header and no rail — the opt-in invariant a non-user of
  // grouping must never see broken.
  const showHeader = hasProjectGroups && (projects.length > 0 || isItemDragging);

  if (projects.length === 0 && !isItemDragging) {
    return null;
  }

  const projectList =
    showHeader && collapsed ? null : (
      <View style={showHeader ? styles.railed : undefined}>
        <DraggableList
          testID="sidebar-project-list"
          data={projects}
          keyExtractor={keyExtractor}
          renderItem={renderProject}
          onDragEnd={onDragEnd}
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
    );

  return (
    <View>
      {showHeader ? (
        <SidebarGroupDropTarget groupId={null}>
          {(isOver) => (
            <GroupSectionHeader
              kind="project"
              ungrouped
              groupId={UNGROUPED_PROJECTS_COLLAPSE_KEY}
              groupName={t("sidebar.projectGroup.noGroup")}
              count={projects.length}
              collapsed={collapsed}
              onToggle={handleToggle}
              isDropTarget={isOver}
              testID="sidebar-project-no-group"
            />
          )}
        </SidebarGroupDropTarget>
      ) : null}
      {projectList}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The same rail a project group puts under its header, so the ungrouped projects hang off
  // their header the way a group's do.
  railed: {
    marginLeft: TREE_INDENT_PER_LEVEL,
    paddingLeft: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.surface2,
  },
}));
