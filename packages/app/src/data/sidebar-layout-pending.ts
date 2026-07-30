import { useSyncExternalStore } from "react";
import type { SidebarLayout } from "@getpaseo/protocol/messages";

// The layout an edit just produced, published SYNCHRONOUSLY so the sidebar can render it
// in the same commit as the drag that caused it.
//
// setQueryData alone is not enough. React Query notifies its observers through the
// notifyManager, whose default scheduler is a setTimeout(0) — a macrotask, which lands
// AFTER the browser paints. dnd-kit, meanwhile, clears its transforms synchronously when
// the drop handler returns. So there is exactly one painted frame in between with the
// rows back in their old order and no transform holding them anywhere else: the flash.
//
// It is a module store rather than component state because the two ends live in different
// hooks — the edit is made through useGroupActions, and the order is read by
// useWorkspaceStructure. Component state in one would not be seen by the other.

let pending: SidebarLayout | null = null;
// Bumped on every write. An edit holds the token it was given and may only clear the
// pending layout while that token is still current — see clearPendingSidebarLayout.
let token = 0;
const listeners = new Set<() => void>();

export function setPendingSidebarLayout(layout: SidebarLayout | null): number {
  pending = layout;
  token += 1;
  for (const listener of listeners) {
    listener();
  }
  return token;
}

// Clears the pending layout only if it is still the one `token` was issued for.
//
// An edit clears the optimistic layout when its write settles, and the write is async, so
// a second edit (or a drag preview) can easily start first and settle second. Clearing
// unconditionally meant the FIRST edit's completion wiped the SECOND one's optimistic
// state while its write was still on the wire: the sidebar dropped back to the confirmed
// document, showing the newer change undone, until that write landed and put it back. A
// visible snapback, on the happy path, caused entirely by whose round trip finished first.
//
// Ownership is per-write rather than per-hook because the pending layout is module state:
// two components calling useSidebarLayout share it, so a ref inside the hook would not
// see the other's edit at all.
export function clearPendingSidebarLayout(ownedToken: number): void {
  if (ownedToken !== token) {
    // A newer edit or preview owns the pending layout now. It will clear its own.
    return;
  }
  setPendingSidebarLayout(null);
}

export function getPendingSidebarLayout(): SidebarLayout | null {
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingSidebarLayout(): SidebarLayout | null {
  return useSyncExternalStore(subscribe, getPendingSidebarLayout, getPendingSidebarLayout);
}

// The optimistic layout is only believed while it is genuinely ahead of what the hosts
// have confirmed. The moment the confirmed document catches up — or a NEWER one arrives
// from another device — it wins and the optimistic copy is dropped. That is what keeps a
// failed write from leaving the sidebar showing an order nobody stored.
export function resolvePendingLayout(
  confirmed: SidebarLayout,
  optimistic: SidebarLayout | null,
): SidebarLayout {
  if (optimistic && optimistic.revision > confirmed.revision) {
    return optimistic;
  }
  return confirmed;
}
