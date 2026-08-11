import React, { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  useSidebarWorkspacesList,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacesListResult,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceEntries } from "@/hooks/use-sidebar-workspace-entries";
import { usePinnedSidebarKeys, type PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarRowMenuStore } from "@/stores/sidebar-row-menu-store";
import { useSidebarViewStore, type SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { SidebarShortcutModel } from "@/utils/sidebar-shortcuts";
import {
  applySidebarFilter,
  NO_SIDEBAR_FILTER,
  selectFilterableLabels,
  type SidebarFilterResult,
  type SidebarFilterWorkspace,
} from "./sidebar-filter";
import type { SidebarGroup } from "./sidebar-groups";
import { buildSidebarProjection } from "./sidebar-projection";
import { useKnownWorkspaceLabels } from "./workspace-labels/model";

interface SidebarModel extends SidebarWorkspacesListResult {
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  groupMode: SidebarGroupMode;
  groups: SidebarGroup[];
  pinnedGroups: PinnedSidebarGroups;
  collapsedProjectKeys: ReadonlySet<string>;
  toggleProjectCollapsed: (projectViewKey: string) => void;
  shortcutModel: SidebarShortcutModel;
  filter: SidebarFilterResult;
  /** What the label filter controls offer — the catalog, narrowed to the host/project facets. */
  filterableLabels: readonly string[];
}

const SidebarModelContext = createContext<SidebarModel | null>(null);
const EMPTY_WORKSPACE_ENTRIES = new Map<string, SidebarWorkspaceEntry>();

export function SidebarModelProvider({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const list = useSidebarWorkspacesList();
  const groupMode = useSidebarViewStore((state) => state.groupMode);
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const collapsedStatusGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedStatusGroupKeys,
  );
  const collapsedLabelGroupKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedLabelGroupKeys,
  );
  const pinnedCollapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedPinned);
  const toggleProjectCollapsed = useSidebarCollapsedSectionsStore(
    (state) => state.toggleProjectCollapsed,
  );
  // Both flat modes read every workspace's entry rather than the project tree's placements: a
  // status bucket needs the status, a label group needs the labels, and neither is on a placement.
  const isFlatMode = groupMode === "status" || groupMode === "label";
  const workspaceEntriesByKey = useSidebarWorkspaceEntries(
    list.workspacePlacements,
    active !== false || isFlatMode,
  );
  const projectionWorkspaceEntriesByKey = isFlatMode
    ? workspaceEntriesByKey
    : EMPTY_WORKSPACE_ENTRIES;
  const knownLabels = useKnownWorkspaceLabels();
  const unlabelledLabel = t("sidebar.groups.unlabelled");
  const pinnedKeys = usePinnedSidebarKeys(list.projects);
  const labelFilters = useSidebarViewStore((state) => state.labelFilters);
  const labelMatch = useSidebarViewStore((state) => state.labelMatch);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  useReconciledProjectFilters(list.projects);
  const activeSelection = useActiveWorkspaceSelection();
  const activeWorkspaceKey = activeSelection
    ? `${activeSelection.serverId}:${activeSelection.workspaceId}`
    : null;
  const openMenuWorkspaceKey = useSidebarRowMenuStore((state) => state.workspaceKey);
  const filter = useMemo(
    () =>
      // No entries means nothing has told us which labels these workspaces carry, which is not
      // the same as their carrying none. Filtering on that would empty the sidebar.
      workspaceEntriesByKey.size === 0
        ? NO_SIDEBAR_FILTER
        : applySidebarFilter({
            workspaces: toFilterWorkspaces(workspaceEntriesByKey),
            projectFilters,
            labelFilters,
            labelMatch,
            activeWorkspaceKey,
            openMenuWorkspaceKey,
          }),
    [
      activeWorkspaceKey,
      labelFilters,
      labelMatch,
      openMenuWorkspaceKey,
      projectFilters,
      workspaceEntriesByKey,
    ],
  );
  // Same guard as the filter above: no entries means nothing has said what these workspaces carry,
  // so narrowing on that would offer an empty picker rather than the catalog.
  const filterableLabels = useMemo(
    () =>
      workspaceEntriesByKey.size === 0
        ? knownLabels
        : selectFilterableLabels({
            knownLabels,
            workspaces: toFilterWorkspaces(workspaceEntriesByKey),
            projectFilters,
            labelFilters,
            hostFiltered: hostFilters.length > 0,
          }),
    [hostFilters, knownLabels, labelFilters, projectFilters, workspaceEntriesByKey],
  );
  const projection = useMemo(
    () =>
      buildSidebarProjection({
        projects: list.projects,
        pinnedKeys,
        workspaceEntriesByKey: projectionWorkspaceEntriesByKey,
        projectNamesByViewKey: list.projectNamesByViewKey,
        groupMode,
        knownLabels,
        unlabelledLabel,
        pinnedCollapsed,
        collapsedProjectKeys,
        collapsedStatusGroupKeys,
        collapsedLabelGroupKeys,
        filter,
      }),
    [
      collapsedLabelGroupKeys,
      collapsedProjectKeys,
      collapsedStatusGroupKeys,
      filter,
      groupMode,
      knownLabels,
      list.projectNamesByViewKey,
      list.projects,
      pinnedCollapsed,
      pinnedKeys,
      projectionWorkspaceEntriesByKey,
      unlabelledLabel,
    ],
  );
  const value = useMemo(
    () => ({
      ...list,
      workspaceEntriesByKey,
      groupMode,
      groups: projection.groups,
      pinnedGroups: projection.pinnedGroups,
      collapsedProjectKeys,
      toggleProjectCollapsed,
      shortcutModel: projection.shortcutModel,
      filter,
      filterableLabels,
    }),
    [
      collapsedProjectKeys,
      filter,
      filterableLabels,
      groupMode,
      list,
      projection,
      toggleProjectCollapsed,
      workspaceEntriesByKey,
    ],
  );

  return <SidebarModelContext.Provider value={value}>{children}</SidebarModelContext.Provider>;
}

function toFilterWorkspaces(
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
): SidebarFilterWorkspace[] {
  return Array.from(entries.values(), (entry) => ({
    workspaceKey: entry.workspaceKey,
    projectViewKey: entry.projectViewKey,
    labels: entry.labels,
  }));
}

/**
 * Forgets projects that are no longer there. A view key goes stale when a project is removed or
 * its last host disconnects, and a filter naming only keys that no longer exist would hide the
 * whole sidebar with no row left to say why.
 */
function useReconciledProjectFilters(projects: readonly SidebarProjectEntry[]): void {
  const reconcileProjectFilters = useSidebarViewStore((state) => state.reconcileProjectFilters);
  const viewKeys = useMemo(() => projects.map((project) => project.viewKey), [projects]);
  useEffect(() => {
    if (viewKeys.length === 0) return;
    reconcileProjectFilters(viewKeys);
  }, [reconcileProjectFilters, viewKeys]);
}

export function useSidebarModel(): SidebarModel {
  const model = useContext(SidebarModelContext);
  if (!model) throw new Error("SidebarModelProvider is required");
  return model;
}
