import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SidebarLayout } from "@getpaseo/protocol/messages";
import { useReplicaQueries } from "@/data/query";
import {
  findStaleHosts,
  pickWinningLayout,
  sidebarLayoutQueryKey,
  type HostLayoutEntry,
} from "@/data/sidebar-layout";
import {
  getPendingSidebarLayout,
  resolvePendingLayout,
  setPendingSidebarLayout,
  usePendingSidebarLayout,
} from "@/data/sidebar-layout-pending";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";
import { seedLayoutFromLocalOrder } from "@/sidebar/sidebar-layout-order";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";

// How many times an edit will re-apply itself on top of a newer document before giving
// up. A conflict means another device wrote between our read and our write; re-applying
// once is almost always enough, and a bound keeps a pathological loop off the wire.
const MAX_EDIT_ATTEMPTS = 3;

export interface SidebarLayoutController {
  layout: SidebarLayout;
  // False when no connected host can store a layout — every host is old, or none is
  // connected. The sidebar hides grouping entirely rather than offering an action that
  // would silently fail to persist.
  isAvailable: boolean;
  edit: (recipe: (layout: SidebarLayout) => SidebarLayout) => void;
  // A preview is an edit that is NOT committed: it shows in the sidebar and goes no
  // further. Dragging a row across groups uses it, so the target group's list really
  // contains the row while the cursor is over it — which is what lets dnd-kit's sorting
  // strategy open a gap for it. A strategy can only shift rows it knows about.
  preview: (recipe: (layout: SidebarLayout) => SidebarLayout) => void;
  cancelPreview: () => void;
}

function readHostLayouts(
  queryClient: QueryClient,
  serverIds: readonly string[],
): HostLayoutEntry[] {
  return serverIds.map((serverId) => ({
    serverId,
    layout: queryClient.getQueryData<SidebarLayout>(sidebarLayoutQueryKey(serverId)) ?? null,
  }));
}

// Applies the recipe ONCE, to a base of the caller's choosing.
//
// `includePreview` decides whether the uncommitted drag preview counts as part of that
// base. A first attempt says yes — the drop must land where the gap opened, so it builds
// on the preview and is a reorder within a group the row already sits in. A RETRY says no:
// the preview is stale by then, and re-applying on top of it would apply the recipe to its
// own result.
function applyEdit(input: {
  entries: readonly HostLayoutEntry[];
  recipe: (layout: SidebarLayout) => SidebarLayout;
  includePreview: boolean;
}): SidebarLayout {
  const winner = pickWinningLayout(input.entries);
  const base = input.includePreview
    ? resolvePendingLayout(winner, getPendingSidebarLayout())
    : winner;
  // The first write to an empty document carries the user's existing per-device drag
  // order into it. Doing it here rather than in a mount-time migration means there is no
  // window where the document exists without the order they already had.
  const seeded =
    base.revision === 0 ? seedLayoutFromLocalOrder(base, useSidebarOrderStore.getState()) : base;
  return {
    ...input.recipe(seeded),
    // Must clear the HOSTS, not just the base: a preview already sits one ahead of them.
    revision: Math.max(seeded.revision, winner.revision) + 1,
    updatedAt: new Date().toISOString(),
  };
}

// Writes the document to every host, at each host's own expectedRevision. A host that
// is behind gets healed by the same call that publishes the edit — there is no separate
// repair path, because "catch this host up" and "save my change" are the same write.
//
// It takes the ALREADY-COMPUTED layout. The recipe has run; running it again here would
// apply it to its own result — which is invisible for a rename or a move (they are
// idempotent) and duplicates the group for a create. It is only re-run to REBUILD after a
// conflict, and then against the authoritative document rather than the stale preview.
async function commitLayout(input: {
  queryClient: QueryClient;
  serverIds: readonly string[];
  layout: SidebarLayout;
  recipe: (layout: SidebarLayout) => SidebarLayout;
}): Promise<void> {
  const store = getHostRuntimeStore();
  let next = input.layout;

  for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
    const entries = readHostLayouts(input.queryClient, input.serverIds);

    // Optimistic: the sidebar re-renders from the cache, so it has to move now, not
    // after a round trip to every daemon.
    for (const serverId of input.serverIds) {
      input.queryClient.setQueryData(sidebarLayoutQueryKey(serverId), next);
    }

    const results = await Promise.all(
      entries.map(async (entry) => {
        const client = store.getSnapshot(entry.serverId)?.client;
        if (!client) {
          return null;
        }
        try {
          const result = await client.setSidebarLayout({
            layout: next,
            expectedRevision: entry.layout?.revision ?? 0,
          });
          return {
            serverId: entry.serverId,
            accepted: result.accepted,
            layout: result.layout,
          };
        } catch {
          // A host that dropped mid-write is not a conflict. It reconnects behind, and
          // the next read sees it as stale and heals it.
          return null;
        }
      }),
    );

    // Whatever a host actually holds is what the cache must say it holds.
    for (const result of results) {
      if (result) {
        input.queryClient.setQueryData(sidebarLayoutQueryKey(result.serverId), result.layout);
      }
    }

    const rejected = results.some((result) => result && !result.accepted);
    if (!rejected) {
      return;
    }
    // Someone else's write landed first. The cache now holds their document, so rebuild
    // this edit on top of theirs instead of clobbering it — and on the AUTHORITATIVE
    // document, not the preview, which is stale the moment a conflict is known.
    next = applyEdit({
      entries: readHostLayouts(input.queryClient, input.serverIds),
      recipe: input.recipe,
      includePreview: false,
    });
  }
}

export function useSidebarLayout(): SidebarLayoutController {
  const queryClient = useQueryClient();
  const hosts = useHosts();

  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const supportsLayout = useHostFeatureMap(serverIds, "sidebarLayout");

  const activeServerIds = useMemo(
    () =>
      serverIds.filter(
        (serverId) => statuses.get(serverId) === "online" && supportsLayout.get(serverId) === true,
      ),
    [serverIds, statuses, supportsLayout],
  );

  const layoutQueries = useReplicaQueries<SidebarLayout>(
    activeServerIds.map((serverId) => ({
      queryKey: sidebarLayoutQueryKey(serverId),
      pushEvent: "status:sidebar_layout_changed",
      queryFn: async () => {
        const client = getHostRuntimeStore().getSnapshot(serverId)?.client;
        if (!client) {
          throw new Error(`Host ${serverId} is not connected`);
        }
        return client.getSidebarLayout();
      },
    })),
  );

  // Read what we last KNEW for every host, out of the cache — not only what a host that is
  // online right now is serving.
  //
  // A host drops to "connecting" for a moment on any reconnect. Deriving the entries from
  // the live queries meant that in that moment there were none, and pickWinningLayout of
  // nothing is the EMPTY document — whose revision 0 does not mean "empty", it means "no
  // device has ever written a layout". The sidebar reads that as "this user does not use
  // grouping", throws away every group, and falls back to the per-device order. One blink of
  // the connection and a drag you just finished is on screen in its old position again.
  //
  // Absence of a connected host is not absence of a document. The queries still own fetching
  // and live updates for the hosts that are up; the cache owns what we render.
  const entries = useMemo<HostLayoutEntry[]>(() => {
    const live = new Map<string, SidebarLayout>();
    activeServerIds.forEach((serverId, index) => {
      const data = layoutQueries[index]?.data;
      if (data) {
        live.set(serverId, data);
      }
    });
    // Live where a host is up; last-known where it is not. Every host we have ever heard
    // from stays in the list, so none of them can take the document with it when it blinks.
    return serverIds.map((serverId) => ({
      serverId,
      layout:
        live.get(serverId) ??
        queryClient.getQueryData<SidebarLayout>(sidebarLayoutQueryKey(serverId)) ??
        null,
    }));
  }, [activeServerIds, layoutQueries, queryClient, serverIds]);

  const confirmed = useMemo(() => pickWinningLayout(entries), [entries]);

  // The optimistic layout stands only while it is genuinely ahead of what the hosts have
  // confirmed. The moment the confirmed document catches up — or a NEWER one arrives from
  // another device — it wins.
  const pending = usePendingSidebarLayout();
  const layout = resolvePendingLayout(confirmed, pending);

  // A host that came back behind the others is caught up on sight. This is the whole of
  // the reconnect story: no repair queue and no divergence to resolve, because the
  // document is replicated whole rather than assembled from per-host fragments.
  //
  // Measured against CONFIRMED, never against the optimistic layout: an in-flight edit is
  // ahead of every host by definition, so using it here would mark them all stale and
  // race a second write against the one already on the wire.
  const staleServerIds = useMemo(() => findStaleHosts(entries, confirmed), [entries, confirmed]);
  const staleKey = staleServerIds.join(",");
  useEffect(() => {
    if (staleServerIds.length === 0) {
      return;
    }
    const store = getHostRuntimeStore();
    for (const serverId of staleServerIds) {
      const client = store.getSnapshot(serverId)?.client;
      if (!client) {
        continue;
      }
      const behind = entries.find((entry) => entry.serverId === serverId);
      void (async () => {
        try {
          const result = await client.setSidebarLayout({
            layout: confirmed,
            expectedRevision: behind?.layout?.revision ?? 0,
          });
          queryClient.setQueryData(sidebarLayoutQueryKey(serverId), result.layout);
        } catch {
          // Best effort. It stays behind, and the next read tries again.
        }
      })();
    }
    // `staleKey` collapses the array identity so a re-render with the same stale hosts
    // does not re-issue the same heal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleKey, confirmed.revision, queryClient]);

  const edit = useCallback(
    (recipe: (layout: SidebarLayout) => SidebarLayout) => {
      if (activeServerIds.length === 0) {
        return;
      }
      // Publish the result SYNCHRONOUSLY, before the async commit. React batches this
      // with dnd-kit clearing its drag transforms, so the row lands in its new place in
      // the same painted frame. Waiting on setQueryData instead leaves one frame of the
      // old order on screen, because React Query notifies its observers on a macrotask.
      const next = applyEdit({
        entries: readHostLayouts(queryClient, activeServerIds),
        recipe,
        includePreview: true,
      });
      setPendingSidebarLayout(next);

      void commitLayout({
        queryClient,
        serverIds: activeServerIds,
        layout: next,
        recipe,
      }).finally(() => {
        // The confirmed document is authoritative from here. If the write failed, this is
        // what puts the sidebar back to what the hosts actually hold rather than leaving
        // it showing an order nobody stored.
        setPendingSidebarLayout(null);
      });
    },
    [activeServerIds, queryClient],
  );

  const preview = useCallback(
    (recipe: (layout: SidebarLayout) => SidebarLayout) => {
      if (activeServerIds.length === 0) {
        return;
      }
      const hostLayouts = readHostLayouts(queryClient, activeServerIds);
      const confirmedNow = pickWinningLayout(hostLayouts);
      const displayed = resolvePendingLayout(confirmedNow, getPendingSidebarLayout());
      setPendingSidebarLayout({
        ...recipe(displayed),
        // Pinned one ahead of the hosts rather than incremented per move: a drag fires
        // dragOver many times, and each one would otherwise inflate the revision.
        revision: confirmedNow.revision + 1,
        updatedAt: new Date().toISOString(),
      });
    },
    [activeServerIds, queryClient],
  );

  const cancelPreview = useCallback(() => {
    setPendingSidebarLayout(null);
  }, []);

  return {
    layout,
    isAvailable: activeServerIds.length > 0,
    edit,
    preview,
    cancelPreview,
  };
}
