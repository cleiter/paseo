# Sidebar drag and drop

How dragging works in the sidebar, and the six ways it has actually broken. Every rule
below is load-bearing: each one was a bug that shipped, was reported, and was fixed. None
of them are obvious from the code, which is why they are written down.

Read this before touching `sidebar-group-drag-*`, `draggable-list.web.tsx`, or the
sorting/collision configuration.

## The shape

The machinery is level-agnostic: it speaks **item**, **group** and **header**, and both
levels of the sidebar use the same modules (`sidebar-group-drag-*`). A project is an item
in a project group; a workspace is an item in a workspace group. Fix a drag bug once.

- **One `SidebarGroupDragContext` per level.** dnd-kit cannot move an item between two
  `DndContext`s, and `DraggableList` mounts one per list by default — which is what made
  drag-between-groups impossible, at both levels, until it was hoisted.
  - Project level: one context around the project groups and the ungrouped remainder.
  - Workspace level: one context per project, around its workspace groups.
  - They NEST (a project block contains its workspaces' context). That is fine — dnd-kit's
    inner provider shadows the outer for its descendants, so each drag binds to its own
    level and the two never see each other's droppables.
- **Each group's list is its own `SortableContext`**, plus one for the group sections.
- **The decisions live in `sidebar-group-drag-policy.ts`** — pure, and tested. The context
  translates dnd-kit events into policy inputs and does what it is told.
  **If you are changing how a drag behaves, change it there and add the case to the test.**
  Every drag bug in this feature was a policy bug, and none were visible from inside the
  event handlers.
- Native has no shared context at all: `react-native-draggable-flatlist` cannot drag
  between lists, so moving a row between groups goes through the row menu.

## The rules

### 1. A row dragged between groups needs a `DragOverlay`

`verticalListSortingStrategy` returns **no transform** for the active item when
`overIndex` is `-1`:

```js
if (index === activeIndex) {
  const overIndexRect = rects[overIndex];
  if (!overIndexRect) return null;
```

Each group's list is its own `SortableContext`, so the moment a row hovers anything
outside its own group, `overIndex` is `-1` and the row **snaps back to where it started**
while the cursor is somewhere else. The overlay follows the cursor unconditionally, which
is the only reason a cross-group drag is legible. The row left behind drops to 0.35
opacity — with an overlay it is a placeholder marking the gap, not a second copy of itself.

Group _sections_ do not need an overlay: they sort against each other in one shared
`SortableContext`, so their `overIndex` is always valid.

### 2. The overlay must be portalled to `document.body`

`DragOverlay` is `position: fixed`, and a fixed element is positioned against its nearest
**transformed** ancestor, not the viewport. The sidebar is one — `left-sidebar.tsx`
animates its width with Reanimated, which on web compiles to a CSS `transform`. Left
inside it, the dragged row hangs about a sidebar's-worth of offset below the cursor.

`createPortal` moves the DOM parent, not the React tree, so theme, i18n and session
context still resolve.

### 3. Only a POINTER MOVE may change a preview — a re-layout may not

A cross-group hover moves the item into the target group's data (without saving) so that
group's `SortableContext` really contains it and the sorting strategy opens a gap. A
strategy can only shift rows it knows about.

This oscillated once: hover a group header, the item moves in, the group it left shrinks,
the header slides up out from under the cursor onto the old group, which previews it back,
which pushes the header down again — the header runs away from a hand that is holding
still.

**The first diagnosis was wrong.** It looked like "headers must not preview", and that is
how it was fixed; the cost was that hovering a group did nothing at all, which is the dead
feeling the preview exists to remove. The real cause is that dnd-kit re-fires `dragOver`
whenever the measured layout changes, **not only when the pointer moves** — and
`MeasuringStrategy.Always` guarantees it will. A preview changes the layout, so a preview
can trigger the `dragOver` that undoes it.

So the context ignores any `dragOver` whose pointer `delta` has not changed since the last
preview. A re-layout cannot move the target; only you can. With that in place headers
preview safely, and hovering a group — including an empty one, and including the
"Ungrouped" remainder — opens a gap at the end.

**Which is why there is no drop-zone highlight.** Group headers used to paint themselves
accent-bordered while a row was over them (`isOver` → `containerDropTarget`). That was
built when headers did not preview, and it is the wrong shape now that they do: the
preview already shows the row sitting in the group, at the position it will occupy, which
is a stricter answer than "somewhere in here". Two answers to one question is worse than
one — the highlight says a group, the gap says a slot, and they draw the eye to different
places. `SidebarGroupDropTarget` still registers the droppable (a header is the only way
to fill an empty group); it just renders its children and nothing else. Do not add the
highlight back: if a hover feels dead, the preview is not firing, and that is the bug.

### 4. Collision detection is `pointerWithin`, with no fallback for rows

The sidebar is a vertical stack that **reshapes under the cursor**: a preview shrinks one
group and grows another, moving everything below them. `closestCenter` answers with
whichever centre is nearest, which after a shift is often a row back in the group the drag
came from — so the preview yanks the row home under a cursor that has not moved. Opening a
gap makes it worse, because it _creates_ dead space exactly where you are aiming.

Pointer over nothing must mean **nothing changes**, not "guess". Group sections keep the
`closestCenter` fallback: they are large targets, cannot flicker the same way, and stay
grabbable past the ends of the list.

### 5. Drag-revealed droppables need `MeasuringStrategy.Always`

Droppables are measured once at drag start by default. The empty "Ungrouped" remainder
only appears **while** a row is in flight, and a droppable that mounts after the drag began
is never measured — so it would highlight on hover and then quietly refuse every drop.

### 6. The order arrives as DATA, so turn dnd-kit's animations off

Two separate failures, both from dnd-kit animating a row to a place the data has already
put it:

- **Layout animation.** With an ancestor-owned drag, the new order arrives as data, so the
  row is already in its new place by the time dnd-kit would animate it there. It measures
  the old rect and animates from it, and the row flies in from where it used to be. Hence
  `animateLayoutChanges: () => false` and no settle transition — but **only** for
  externally-driven lists. A list that owns its own drag reorders itself synchronously,
  has nothing to fight, and keeps its animation.
- **A frame of the old order.** `setQueryData` is not synchronous with the drop: React
  Query notifies observers through `notifyManager`, whose default scheduler is
  `systemSetTimeoutZero` — a macrotask, landing _after_ the browser paints. dnd-kit clears
  its transforms synchronously. That is one painted frame of the old order. So an edit
  publishes its result synchronously to `sidebar-layout-pending.ts` first, and React
  batches that with dnd-kit's own reset.

### 7. Hoisting the context moves the SENSORS too

`SidebarGroupDragContext` owns the `DndContext`, so it also owns the sensors —
`DraggableList`'s are never constructed for a list that runs on an external context. Which
means activation is now configured in **two** places for rows that must feel identical, and
a change to one silently does not reach the other.

That has already happened once. `a7cbf4f61` split activation by input device — mouse on
movement, touch on a hold, so a mouse drag no longer inherited the touch delay — and
changed `DraggableList` only. The hoisted context kept a single `PointerSensor` with
`{ delay: 250 }`, so a click-and-drag in the sidebar activated **nothing at all**: no
`onDragEnd`, no write, no reorder. The comment above those sensors said "mirrors
DraggableList's own handle activation," which was true when written and quietly stopped
being true.

Both now read `DEFAULT_DRAG_ACTIVATION_CONFIG` from `drag-reorder/pointer-activation.ts`
and build their sensors from `getDragActivationConstraints`. Do not inline the numbers
again. `e2e/sidebar-reorder.spec.ts` is the guard, and it is upstream's — it drags with a
7px mouse move and no hold, which is precisely the input a hold delay eats.

## Invariants a preview must hold

A preview is shown and not saved, so **every** exit from the drag has to account for it, or
a row is left sitting in a group it was never moved to (and vanishes on reload):

| Exit                                   | What happens                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dropped on a row or header             | Commit                                                                                                                               |
| Dropped on **nothing** after a preview | **Commit where it sits** — that is what is on screen, and a pointer resting in the gap the drag opened is the ordinary way to finish |
| Dropped on nothing with no preview     | Nothing                                                                                                                              |
| Dropped on **itself** after a preview  | **Commit** — the row is not where it started any more                                                                                |
| Dropped on itself with no preview      | Nothing                                                                                                                              |
| Drag cancelled                         | Discard                                                                                                                              |

The optimistic layout only stands while it is genuinely **ahead** of what the hosts
confirmed. The moment the confirmed document catches up — or a newer one arrives from
another device — it wins. That is what stops a failed write from leaving the sidebar
showing an order nobody stored.

### A drop that lands and then un-lands is not a drag bug

The symptom is pure drag: you drop a row, it sits in its new place for a frame, and then the
whole sidebar snaps back to the old order. The cause is not.

`revision: 0` is **overloaded**. It is what a document with nothing in it looks like, and it
is also what `EMPTY_SIDEBAR_LAYOUT` looks like — and the sidebar reads it as _"no device has
ever written a layout,"_ which means "this user does not use grouping": it drops every group
and falls back to the per-device AsyncStorage order.

So anything that makes the layout momentarily resolve to the empty document reverts a
finished drag, and hides every group while it lasts. That happened: `useSidebarLayout` built
its host entries from the live queries of hosts that were **online**, and a host drops to
`connecting` on any reconnect. For that instant there were no entries, `pickWinningLayout`
of no entries is the empty document, and the sidebar threw the layout away and redrew itself
from the stale local order.

**Absence of a connected host is not absence of a document.** The entries are read from the
React Query cache for every known host, so what we last knew survives a host blinking out.
The queries still own fetching and live updates for the hosts that are up; the cache owns
what is rendered.

The same ambiguity is still there on a cold start — before the first `sidebar.layout.get`
resolves, the layout genuinely is revision 0 and the sidebar renders ungrouped for a moment.
If that flash ever needs fixing, fix it by distinguishing "not loaded yet" from "empty",
not by special-casing groups.

## Testing

- `sidebar-group-drag-policy.test.ts` — one case per bug that shipped, each named for the
  **symptom** rather than the function. Add to it before fixing a drag bug.
- `sidebar-layout-edits.test.ts` — the document edits, including the direction cases. A
  drop names the row it landed _on_; within a list that is a **reorder** (move from its
  index to the target's), not an insert. Inserting "before the target" makes a downward
  drag a silent no-op, which is how it shipped the first time.
