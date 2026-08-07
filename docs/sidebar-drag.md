# Sidebar drag and drop

How dragging works in the sidebar in project mode, and the constraints the design is
built around. Every rule below was a bug that shipped or a source that was read to settle
an argument; none of them are obvious from the code, which is why they are written down.

Read this before touching `sidebar-flat-*`, `draggable-list.*`, or the vendored
`react-native-draggable-flatlist` patch.

## The shape

Project mode is **one `DraggableList`**, and that list is the scroll container. Pinned
rows, project-group headers, project rows, workspace-group headers, workspace rows, the
"show more" toggles, the ghost "New workspace" row and the empty state are all rows of it.

That is the whole design. Every move that once needed a second mechanism — into another
group, into an empty group, a whole group to a new position — is a within-list reorder,
which both platforms already do. The platform split is confined to the `DraggableList`
primitive: `draggable-list.web.tsx` runs dnd-kit, `draggable-list.native.tsx` runs
`react-native-draggable-flatlist`. Above that line there is one implementation.

```
groupSidebar() ─┐
splitPinned() ──┼─► buildSidebarFlatRows() ──► SidebarFlatRow[] ──► one DraggableList
collapse store ─┤             │
show-more set ──┘             │  lift
                              ▼
                     buildDragRows(rows, origin)      ← all drag-time reshaping
                              │
                     frozen rows for the drag
                              │  validSlots(rows, from) ──► native: worklet spacer snap
                              │                         └─► web: droppable-disabled rows
                              ▼  drop (from, to)
                     interpretSidebarDrop ──► SidebarDropIntent ──► applyDropIntent
                                                                          │
                                                          sidebar-layout-edits ──► document
```

Order is derived state. A drop only writes the document, so a snap-back costs nothing.

| Module                                  | Owns                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `sidebar/sidebar-flat-rows.ts`          | The projection, and `buildDragRows`                     |
| `sidebar/use-sidebar-flat-rows.ts`      | Collapse and show-more state around the projection      |
| `sidebar/sidebar-flat-drop-policy.ts`   | `interpretSidebarDrop`, `validSlots`, `snapToValidSlot` |
| `sidebar/sidebar-flat-drop-apply.ts`    | Intent → document edit, and the legacy fallback         |
| `components/sidebar-workspace-list.tsx` | The list, the row dispatcher, all dialog state          |

Status mode is a different list and none of this applies to it. It still nests
`DraggableList`s inside a `NestableScrollContainer` and still uses
`use-limited-sidebar-group.ts`.

## Slot semantics

`to` is an **insertion index into the rows with the dragged row removed**. dnd-kit's
`arrayMove(items, from, to)` and the native list's `splice` pair agree on this, which is
why one policy can read both.

What that means for a user:

- An **upward** drag lands _before_ the row you are over. A **downward** drag lands
  _after_ it. There is no aim-at-the-lower-half rule — you aim at whatever currently
  occupies the destination slot.
- Aiming at a group **header** puts the row inside that group. This is the only way to
  address a group with no visible rows, so it is how an empty group and a collapsed group
  are filled, and how a row reaches the end of a group that is followed by another
  section.
- A drop into a **collapsed** group joins at the end, not the top. A drop positions the
  dragged row against rows you can see, and a collapsed group shows none.

`interpretSidebarDrop` reads the row above `to` to decide what the drop meant, and returns
one of `none`, `reorder-pinned`, `move-workspace`, `move-project`,
`reorder-workspace-groups`, `reorder-project-groups`. Only `to === from` produces `none`;
every other in-slot drop is a real edit, which is what makes the unreachable-slot rule
below hold.

## Forbidden slots are unreachable, not rejected

`validSlots(rows, from)` is the single source of where a drag may land, asked once when
the drag begins and answered against the rows the drag will actually run on. A workspace
may move within its own project's workspace sections; a pinned row within the pinned span;
a container header only where a block boundary is.

Both platforms make every other slot **unreachable** rather than rejecting a drop on it:

- **Native**: the patched worklet snaps the spacer to the nearest valid slot, so the gap
  only ever opens where the drop will land.
- **Web**: rows outside the set get `disabled: {droppable: true}`.

This is not a stylistic choice. On native, a drop the app ignores strands the rows it
displaced: `CellRendererComponent` holds the last translate and the only thing that clears
it is a fresh `onCellLayout`. A rejected drop leaves the list visibly wrong.

dnd-kit's `disabled` has to be given in its **granular** form. `disabled: true` turns off
the drop target as well as the drag source, and the rows you cannot pick up — section
headers, the "show more" toggle — are exactly the ones a drop needs to land next to.

## `buildDragRows` — all drag-time reshaping, before the lift

Lifting a container folds its contents away, so what you drag looks like what you drop.
`buildDragRows(rows, origin)` does that for all three container kinds — a project-group
header folds its projects, a project header folds its workspace sections, a workspace-group
header folds its members — and materializes the "Ungrouped" remainder header where the
drag can target it.

Two properties make it safe:

- **It runs BEFORE the drag activates**, on both platforms. Web goes through
  `getDragSnapshot`, which the list applies at dragStart. Native arms on the long press,
  sets the state, waits a commit (`useEffect`) and a frame (`requestAnimationFrame`), and
  only then calls `drag()`.
- **It only ever changes rows at or below the active row.** Descendants and remainder
  sections sit strictly below their container, so the active row's index and measured
  offset never move. A property test asserts this.

The rows are then **frozen** for the drag's duration and the policy reads `from`/`to`
against that same array. Freezing is not optional: the native list nulls `activeKey` in
the same render pass whenever the key sequence of `data` changes, so a replica pushing
rows mid-drag would cancel the drag outright. The drop still applies against the **live**
document — the edits are `beforeKey` + `after` plus adoption, which tolerate drift.

Drag state is cleared on `onDragEnd`, `onDragTerminate` and unmount. **Not** on the native
list's `onRelease`: that fires before the settle spring, so cleaning up there tears the
drag down while it is still animating into place.

## The vendored patch

`patches/react-native-draggable-flatlist+4.0.3.patch` carries three changes that this
design depends on. Flag them in review; they are vendored code.

1. **Valid-slot spacer snap** (`useCellTranslate.tsx`). A `validSlots` shared value is set
   at drag begin and the worklet snaps `result` to the nearest member before assigning
   `spacerIndexAnim`. The spacer IS the drop — the gap you aim at is the index `onDragEnd`
   reports — so snapping here is what makes a forbidden slot unreachable.
2. **No `reset()` when no drag is running** (`DraggableFlatList.tsx`). Upstream schedules
   a reset on any data key-sequence change. Rows are allowed to change shape before a drag
   activates, and a reset scheduled by that change lands after activation and cancels the
   drag it was preparing for.
3. **A separator in the key-sequence compare** (`DraggableFlatList.tsx`). Joined with
   `""`, `["ab","c"]` and `["a","bc"]` are the same string, so a change that only moves a
   boundary reads as no change and the list keeps stale indices. The separator is NUL
   rather than a space, because a row key may contain a space.

## Old daemons

A host with no layout document cannot store groups. `applyDropIntent` is gated on
`isLayoutAvailable`; without it, plain reorder intents fall through `legacyDropFallback`
to the per-device `sidebar-order-store`, and group/move intents do nothing. The sidebar
hides grouping entirely on such a host rather than offering an action that silently fails
to persist.

`applyDropIntent` also returns null — no write at all — when the intent's target group has
gone. `adoptVisible*Keys` lifts the moving key out of its source first, so a write to a
deleted group would match nothing and the key would be stored nowhere.

## Rows are pure renderers

A `FlatList` can evict a far-offscreen cell whatever `removeClippedSubviews` says. Rows
that owned their own state lost it when that happened — a rename dialog, an in-flight
archive. So **all** dialog and mutation state lives in `ProjectModeList`: one `activeModal`
plus the pending-removal set. Rows take props and render. Keep it that way.

## Things that stay true from the old design

The hoisted dnd-kit context is gone, but two of its lessons are not about it.

### Activation constants are defined once

`DEFAULT_DRAG_ACTIVATION_CONFIG` and `getDragActivationConstraints` live in
`drag-reorder/pointer-activation.ts` and are exported rather than inlined. The sidebar once
ran a second `DndContext` with its own copy of these numbers, and they drifted: it kept a
mouse hold delay after `DraggableList` dropped one, so a click-and-drag in the sidebar
activated nothing at all — no `onDragEnd`, no write, no reorder. `e2e/sidebar-reorder.spec.ts`
is the guard, and it is upstream's: it drags with a 7px mouse move and no hold, which is
precisely the input a hold delay eats.

### A drop that lands and then un-lands is usually not a drag bug

The symptom is pure drag — the row sits in its new place for a frame and the whole sidebar
snaps back to the old order — and the cause usually is not. Check these before touching
the drag code.

**`revision: 0` is overloaded.** It is what a document with nothing in it looks like and
also what `EMPTY_SIDEBAR_LAYOUT` looks like, and the sidebar reads it as "no device has
ever written a layout", drops every group, and falls back to the per-device order. So
anything that makes the layout momentarily resolve to the empty document reverts a
finished drag and hides every group while it lasts. That happened: host entries were built
from the queries of hosts that were **online**, and a host drops to `connecting` on any
reconnect. Entries are now read from the React Query cache for every known host — absence
of a connected host is not absence of a document. The same ambiguity remains on a cold
start; if that flash ever needs fixing, fix it by distinguishing "not loaded yet" from
"empty", not by special-casing groups.

**A row the document has never seen cannot be positioned.** The document holds only rows
some device has written into it. A project added since the last layout edit is not in it,
and neither is a workspace created an hour ago — both still render, because
`applyStoredOrdering` leaves unrecognised keys where it found them. But a positional edit
is index arithmetic over the **stored** list, so two unknown rows cannot be ordered against
each other at all. This is not an edge case; it is every new project on a machine where
anything has ever been grouped. So a positional edit **adopts the visible list first**
(`adoptVisibleProjectKeys` / `adoptVisibleWorkspaceKeys`), and two properties of that are
load-bearing:

- **Splice, do not overwrite.** Keys the document holds that are not on screen belong to a
  host that is offline right now, and a multi-daemon layout has to survive being viewed
  from a machine that sees half of it.
- **Adopt only into the target list.** A key the document already files under another
  group is known, just not here; adopting it would put one project in two groups. The row
  the drag is carrying is the single exception, and it is lifted out of its old group as
  it is adopted.

**`after` is required, everywhere it is passed.** A position is a row plus a side. An
absent side reads as "above", so forgetting it does not fail — it silently makes one drag
direction a no-op, which is exactly how it shipped once for projects while the workspace
handlers beside them were correct. `useGroupActions` takes `after: boolean`, not
`after?: boolean`. Anything positional you add here, make it required for the same reason.

## Testing

- `sidebar-flat-rows.test.ts` — the projection and `buildDragRows`, including the
  property test that the active row's index never moves.
- `sidebar-flat-drop-policy.test.ts` — `interpretSidebarDrop` and the per-kind
  `validSlots` tables. Cases are named for the **symptom**, not the function. Add to it
  before fixing a drag bug.
- `sidebar-flat-drop-apply.test.ts` — intent → edit, the missing-target guard, and the
  legacy fallback gate.
- `sidebar-layout-edits.test.ts` — the document edits, including both directions. A test
  that leaves the side unstated is asserting on "above".
- `e2e/browser/sidebar-group-drag.spec.ts` — the drags themselves in a real browser,
  asserting on the rendered order. Cover **both** container levels: a workspace inside a
  project and a project inside a project group are different code paths that look
  identical on screen, and a direction bug once survived in one while the other was green.
  Rows are not nested inside their group in the DOM, so assert membership positionally
  against the group headers.

Two things the browser suite cannot reach, so they are device QA on every change here:
lift/scroll/close-swipe gesture arbitration on a phone, and whether collapse-on-lift is
stable enough to keep on native (`COLLAPSE_ON_LIFT_NATIVE` in `sidebar-workspace-list.tsx`
turns it off; drop semantics are identical either way, because the policy resolves at
block granularity regardless).

One known rough edge, unexplained: on web, clicking a group header immediately after
dropping a row on it does not toggle the header. Moving the pointer away and waiting for
the drop to settle makes the next click ordinary. The e2e reloads between the two.
