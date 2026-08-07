import { useCallback, useMemo, useState } from "react";
import type { SidebarWorkspacePlacement } from "@/hooks/sidebar-workspaces-view-model";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import {
  buildDragRows,
  buildSidebarFlatRows,
  type SidebarDragOrigin,
  type SidebarFlatRow,
} from "./sidebar-flat-rows";
import type { GroupedSidebar } from "./sidebar-groups";

export interface SidebarFlatRowsInputs {
  grouped: GroupedSidebar;
  pinnedChats: readonly SidebarWorkspacePlacement[];
  hasProjects: boolean;
  showWorkspacesHeader: boolean;
  supportsMultiplicityByServerId: ReadonlyMap<string, boolean>;
}

export interface SidebarFlatRowsResult {
  // The sidebar at rest.
  rows: SidebarFlatRow[];
  // The sidebar for the duration of one drag: the lifted container's children folded into
  // it, and the remainder section the drag needs to aim at brought into being. Computed in
  // one go BEFORE the drag activates, because the native list cancels any drag whose rows
  // change underneath it — so there is no such thing as reacting to a drag in progress.
  buildRowsForDrag: (origin: SidebarDragOrigin) => SidebarFlatRow[];
  // Sections whose "show more" has been pressed. Not persisted: a capped list is about
  // this session's scroll, not a preference.
  toggleSection: (sectionKey: string) => void;
}

export function useSidebarFlatRows(input: SidebarFlatRowsInputs): SidebarFlatRowsResult {
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedGroupKeys = useSidebarCollapsedSectionsStore((state) => state.collapsedGroupKeys);

  const {
    grouped,
    pinnedChats,
    hasProjects,
    showWorkspacesHeader,
    supportsMultiplicityByServerId,
  } = input;

  const build = useCallback(
    (drag: SidebarDragOrigin | null) =>
      buildSidebarFlatRows({
        grouped,
        pinnedChats,
        pinnedCollapsed,
        collapsedProjectKeys,
        collapsedGroupKeys,
        expandedSections,
        hasProjects,
        showWorkspacesHeader,
        supportsMultiplicityByServerId,
        drag,
      }),
    [
      grouped,
      pinnedChats,
      pinnedCollapsed,
      collapsedProjectKeys,
      collapsedGroupKeys,
      expandedSections,
      hasProjects,
      showWorkspacesHeader,
      supportsMultiplicityByServerId,
    ],
  );

  const rows = useMemo(() => build(null), [build]);

  const buildRowsForDrag = useCallback(
    (origin: SidebarDragOrigin) => buildDragRows(build(origin), origin.key),
    [build],
  );

  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (!next.delete(sectionKey)) {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  return { rows, buildRowsForDrag, toggleSection };
}
