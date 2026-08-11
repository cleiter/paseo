import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  collectChosenWorkspaceLabelColors,
  mergeWorkspaceLabelCatalogs,
  type WorkspaceLabelCatalogEntry,
  type WorkspaceLabelColors,
} from "@/components/sidebar/workspace-labels/catalog";

/**
 * What each connected host says its labels look like.
 *
 * Not persisted. The catalog is the daemon's document — reading it from AsyncStorage on launch
 * would mean painting chips from a snapshot of a host that may have been recoloured, or that
 * this device is no longer talking to at all. It arrives on connect and repaints on broadcast.
 */
interface WorkspaceLabelCatalogState {
  catalogs: Record<string, readonly WorkspaceLabelCatalogEntry[] | undefined>;
  setCatalog: (serverId: string, catalog: readonly WorkspaceLabelCatalogEntry[]) => void;
  clearCatalog: (serverId: string) => void;
}

export const useWorkspaceLabelCatalogStore = create<WorkspaceLabelCatalogState>((set) => ({
  catalogs: {},
  setCatalog: (serverId, catalog) =>
    set((state) => ({ catalogs: { ...state.catalogs, [serverId]: catalog } })),
  clearCatalog: (serverId) =>
    set((state) => {
      if (!(serverId in state.catalogs)) return state;
      const { [serverId]: _removed, ...rest } = state.catalogs;
      return { catalogs: rest };
    }),
}));

export function setWorkspaceLabelCatalog(
  serverId: string,
  catalog: readonly WorkspaceLabelCatalogEntry[],
): void {
  useWorkspaceLabelCatalogStore.getState().setCatalog(serverId, catalog);
}

export function clearWorkspaceLabelCatalog(serverId: string): void {
  useWorkspaceLabelCatalogStore.getState().clearCatalog(serverId);
}

/**
 * One colour per label name across every host. Rows never ask which host coloured a label —
 * see `mergeWorkspaceLabelCatalogs` for why the answer has to be the same everywhere.
 *
 * Hosts are merged in id order rather than connect order, so which host wins a disagreement is
 * the same on every launch instead of depending on which daemon answered first.
 */
export function useWorkspaceLabelColors(): WorkspaceLabelColors {
  const catalogs = useSortedWorkspaceLabelCatalogs();
  return useMemo(() => mergeWorkspaceLabelCatalogs(catalogs), [catalogs]);
}

/** Which labels wear a colour someone picked — what "Reset color" is offered for. */
export function useChosenWorkspaceLabelColors(): ReadonlySet<string> {
  const catalogs = useSortedWorkspaceLabelCatalogs();
  return useMemo(() => collectChosenWorkspaceLabelColors(catalogs), [catalogs]);
}

function useSortedWorkspaceLabelCatalogs(): readonly (readonly WorkspaceLabelCatalogEntry[])[] {
  return useWorkspaceLabelCatalogStore(
    useShallow((state) =>
      Object.keys(state.catalogs)
        .sort()
        .map((serverId) => state.catalogs[serverId] ?? []),
    ),
  );
}
