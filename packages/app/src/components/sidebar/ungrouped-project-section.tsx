import { useCallback } from "react";
import type { MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { GestureType } from "react-native-gesture-handler";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { GroupedSidebarProject } from "@/hooks/use-sidebar-groups";
import { SIDEBAR_GROUP_DRAG_ENABLED } from "@/components/sidebar/sidebar-group-drag-context";
import {
  useIsSidebarGroupItemDragging,
  useSidebarGroupDragActiveId,
  type SidebarGroupItemDragData,
} from "@/components/sidebar/sidebar-group-drag-shared";
import { SidebarGroupDropTarget } from "@/components/sidebar/sidebar-group-sortable";

interface UngroupedProjectSectionProps {
  projects: GroupedSidebarProject[];
  // The label only earns its space once a real project group exists. Without one it would
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

  const getItemData = useCallback((project: GroupedSidebarProject): Record<string, unknown> => {
    const data: SidebarGroupItemDragData = {
      kind: "sidebar-group-item",
      groupId: null,
      itemKey: project.viewKey,
    };
    return data as unknown as Record<string, unknown>;
  }, []);

  // Once every project has been grouped there are no ungrouped rows left to drop between,
  // so without the label standing there as a target a project could never be dragged back
  // out. It appears while a project is in flight and stays hidden otherwise: a standing
  // label over nothing is noise.
  const showLabel = hasProjectGroups && (projects.length > 0 || isItemDragging);

  if (projects.length === 0 && !isItemDragging) {
    return null;
  }

  return (
    <View>
      {showLabel ? (
        <SidebarGroupDropTarget groupId={null}>
          {(isOver) => (
            <View style={isOver ? styles.labelDropTarget : styles.label}>
              <Text style={styles.labelText} testID="sidebar-project-no-group">
                {t("sidebar.projectGroup.noGroup")}
              </Text>
            </View>
          )}
        </SidebarGroupDropTarget>
      ) : null}
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
}

const styles = StyleSheet.create((theme) => ({
  label: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: "transparent",
  },
  labelDropTarget: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  labelText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
}));
