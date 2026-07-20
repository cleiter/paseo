import { useMemo } from "react";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarLayout } from "@/hooks/use-sidebar-layout";
import { groupSidebar, type GroupedSidebar } from "@/sidebar/sidebar-groups";

export {
  groupSidebar,
  type GroupedSidebar,
  type GroupedSidebarProject,
  type SidebarGroupRef,
  type SidebarProjectGroup,
  type SidebarWorkspaceGroup,
} from "@/sidebar/sidebar-groups";

export function useSidebarGroups(projects: SidebarProjectEntry[]): GroupedSidebar {
  const { layout } = useSidebarLayout();
  return useMemo(() => groupSidebar({ projects, layout }), [projects, layout]);
}
