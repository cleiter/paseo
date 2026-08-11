import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  type CollapsedProjectsState,
  type PersistedCollapsedProjects,
  mergePersistedCollapsedProjects,
  PersistedCollapsedProjectsSchema,
  serializeCollapsedProjects,
  setProjectCollapsed,
  toggleLabelFiltersCollapsed,
  toggleLabelGroupCollapsed,
  togglePinnedCollapsed,
  toggleProjectCollapsed,
  toggleStatusGroupCollapsed,
} from "./state";

interface SidebarCollapsedSectionsState extends CollapsedProjectsState {
  toggleProjectCollapsed: (projectKey: string) => void;
  setProjectCollapsed: (projectKey: string, collapsed: boolean) => void;
  toggleStatusGroupCollapsed: (statusGroupKey: string) => void;
  toggleLabelGroupCollapsed: (labelGroupKey: string) => void;
  togglePinnedCollapsed: () => void;
  toggleLabelFiltersCollapsed: () => void;
}

export const useSidebarCollapsedSectionsStore = create<SidebarCollapsedSectionsState>()(
  persist<SidebarCollapsedSectionsState, [], [], PersistedCollapsedProjects>(
    (set) => ({
      collapsedProjectKeys: new Set(),
      collapsedStatusGroupKeys: new Set(),
      collapsedLabelGroupKeys: new Set(),
      collapsedPinned: false,
      collapsedLabelFilters: false,
      toggleProjectCollapsed: (projectKey) =>
        set((state) => toggleProjectCollapsed(state, projectKey)),
      setProjectCollapsed: (projectKey, collapsed) =>
        set((state) => setProjectCollapsed(state, projectKey, collapsed)),
      toggleStatusGroupCollapsed: (statusGroupKey) =>
        set((state) => toggleStatusGroupCollapsed(state, statusGroupKey)),
      toggleLabelGroupCollapsed: (labelGroupKey) =>
        set((state) => toggleLabelGroupCollapsed(state, labelGroupKey)),
      togglePinnedCollapsed: () => set((state) => togglePinnedCollapsed(state)),
      toggleLabelFiltersCollapsed: () => set((state) => toggleLabelFiltersCollapsed(state)),
    }),
    {
      name: "sidebar-collapsed-sections",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedCollapsedProjectsSchema),
      partialize: (state) => serializeCollapsedProjects(state),
      merge: (persistedState, currentState) =>
        mergePersistedCollapsedProjects(persistedState, currentState),
    },
  ),
);
