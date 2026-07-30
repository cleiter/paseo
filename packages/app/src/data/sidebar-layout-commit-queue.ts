// Layout writes go out ONE AT A TIME, in the order the user made them.
//
// Not a throttle — a fix for a conflict that was never real. The daemon handles inbound
// messages concurrently (`websocket-server.ts` dispatches without awaiting its handler),
// and `SidebarLayoutStore.set` awaits its persist BEFORE assigning the new revision. So a
// second write sent while the first is still in flight reads the pre-first revision and is
// refused as stale — even though its `expectedRevision` was exactly right for the write
// ahead of it.
//
// The client does recover, by re-applying its edit on the document it gets back. It just
// pays for it: two overlapping edits can spend most of MAX_EDIT_ATTEMPTS on conflicts that
// only existed because both were in the air at once, and a third is dropped with no error
// at all — the pending layout clears and the sidebar silently puts the action back. Waiting
// costs one round trip. Guessing costs the edit.
//
// This queues the WRITE and nothing else. The optimistic layout is published synchronously
// by the caller, before it enqueues, so the sidebar still moves in the frame the user acted
// in whether or not a commit is ahead of it in the queue.
//
// A wedged host cannot stall the queue indefinitely: the RPC carries the client's 60s
// timeout and rejects, which releases the next commit.
//
// Module state rather than a ref, for the same reason the pending layout is: two components
// calling useSidebarLayout must share one queue, and a ref in the hook would give them two.
let queue: Promise<void> = Promise.resolve();

// Resolves when this commit has settled — the caller uses that to release its claim on the
// pending layout. It never REJECTS: one failed commit must not wedge every edit behind it.
export function enqueueSidebarLayoutCommit(commit: () => Promise<void>): Promise<void> {
  const settled = queue.then(commit).catch(() => {});
  queue = settled;
  return settled;
}
