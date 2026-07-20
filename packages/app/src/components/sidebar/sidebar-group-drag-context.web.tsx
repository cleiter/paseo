import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  SidebarGroupDragActiveIdProvider,
  SidebarGroupDragActiveItemProvider,
  sidebarGroupSectionId,
  type SidebarGroupDragContextProps,
  type SidebarGroupDragData,
  type SidebarGroupItemDragData,
} from "./sidebar-group-drag-shared";
import { decideDragEnd, decideDragOver } from "./sidebar-group-drag-policy";
import { SidebarDragOverlaySurface } from "./sidebar-group-sortable";

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const DND_MODIFIERS = [restrictToVerticalAxis];

// Droppables are measured on every move, not once at drag start. The ungrouped
// remainder's label only appears WHILE a row is in flight, and a droppable that shows up
// after the drag began would never be measured under the default strategy — so it would
// look like a drop target and quietly refuse every drop.
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

function readDragData(data: unknown): SidebarGroupDragData | null {
  const candidate = data as SidebarGroupDragData | undefined;
  switch (candidate?.kind) {
    case "sidebar-group-item":
    case "sidebar-group-section":
    case "sidebar-group-header":
      return candidate;
    default:
      return null;
  }
}

function asRow(data: SidebarGroupDragData | null): SidebarGroupItemDragData | null {
  return data?.kind === "sidebar-group-item" ? data : null;
}

// A group section's rectangle spans every row inside it, so if it were left in the
// candidate set while a ROW is being dragged it would compete with those very rows for
// the drop — and win, whenever the cursor sat near the group's middle. Rows drop onto
// rows or onto a group HEADER (a small, separate target); groups drop onto groups.
//
// Pointer-first, because the sidebar is a vertical stack that RESHAPES under the cursor:
// a cross-group preview shrinks one group and grows another, moving everything below.
// closestCenter picks whatever centre is nearest, which after a shift can be a row in the
// group we just left — and then it shifts back, and the target oscillates away from the
// cursor. pointerWithin targets strictly what is under the pointer, so the answer only
// changes when the pointer does. It falls back to closestCenter when the pointer is over
// nothing, which is what keeps a drag past the end of a list from dying.
const collisionDetection: CollisionDetection = (args) => {
  const activeKind = readDragData(args.active.data.current)?.kind;
  const isGroupDrag = activeKind === "sidebar-group-section";

  const droppableContainers = args.droppableContainers.filter((container) => {
    const kind = readDragData(container.data.current)?.kind;
    if (isGroupDrag) {
      return kind === "sidebar-group-section";
    }
    return kind === "sidebar-group-item" || kind === "sidebar-group-header";
  });

  const underPointer = pointerWithin({ ...args, droppableContainers });
  if (underPointer.length > 0 || !isGroupDrag) {
    // No fallback for a ROW. Falling back to the nearest centre means that whenever the
    // pointer sits in dead space — the padding between rows, the rail, the gap the drag
    // itself opened — the answer becomes "the closest row", which is usually one back in
    // the group we came from. The preview then yanks the row home under a cursor that has
    // not moved. Pointer over nothing must mean NOTHING CHANGES, not "guess".
    return underPointer;
  }
  // A group section is a large target and cannot flicker the way a row can, so it keeps
  // the fallback and stays grabbable past the ends of the list.
  return closestCenter({ ...args, droppableContainers });
};

// ONE DndContext for the whole project, spanning every one of its group lists AND the
// group sections themselves. dnd-kit cannot move an item between two DndContexts, and
// DraggableList mounts one per list by default — which is exactly what made
// drag-between-groups impossible. Hoisting the context to here is what lets the drop be
// seen at all.
//
// Two kinds of thing sort in here: rows (within a group, or across groups) and group
// sections (against each other). A group's header is additionally a drop target for
// rows, which is how you move a row into a group that is empty — it has no rows to drop
// onto.
export function SidebarGroupDragContext({
  children,
  groupIds,
  onDrop,
  onReorderGroups,
  renderDragOverlay,
  onDragPreview,
  onDragPreviewCancel,
}: SidebarGroupDragContextProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Mirrors DraggableList's own handle activation, so grabbing a row inside a group
  // feels identical to grabbing one in an ungrouped project.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groupSortableIds = useMemo(() => groupIds.map(sidebarGroupSectionId), [groupIds]);

  const [activeItemKey, setActiveItemKey] = useState<string | null>(null);

  // Guarded rather than read at module scope: this file is only bundled for web, but the
  // body is not there during a server render.
  const dragOverlayHost = typeof document === "undefined" ? null : document.body;

  // Whether this drag has already moved the row into another group's list. An abandoned
  // drag has to put it back, and a self-drop still has to COMMIT it — the row is not where
  // it started any more.
  const previewedRef = useRef(false);

  // The pointer delta at the last preview.
  //
  // dnd-kit re-fires dragOver whenever the measured layout changes, not only when the
  // pointer moves — and MeasuringStrategy.Always guarantees it will. A preview CHANGES the
  // layout, so without this a preview can trigger the dragOver that undoes it: the row
  // moves, everything below shifts, the cursor is suddenly over the group it just left,
  // and it bounces back and forth under a hand that is holding still.
  //
  // So: only a POINTER MOVEMENT may change the preview. A re-layout may not.
  const previewDeltaRef = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    previewedRef.current = false;
    previewDeltaRef.current = null;
    setActiveId(String(event.active.id));
    const row = asRow(readDragData(event.active.data.current));
    setActiveItemKey(row?.itemKey ?? null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveItemKey(null);
    if (previewedRef.current) {
      onDragPreviewCancel();
    }
  }, [onDragPreviewCancel]);

  // Both handlers do the same thing: translate dnd-kit's event into the drag's inputs, ask
  // the policy what that means, and carry it out. The DECISIONS live in
  // sidebar-group-drag-policy, where they can be tested — every drag bug in this feature
  // has been a policy bug, and none of them were visible from in here.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const last = previewDeltaRef.current;
      if (last && last.x === event.delta.x && last.y === event.delta.y) {
        // The layout moved, the pointer did not. Acting here is what makes a preview
        // undo itself.
        return;
      }

      const action = decideDragOver({
        active: readDragData(event.active.data.current),
        over: readDragData(event.over?.data.current),
      });
      if (action.kind === "preview") {
        previewedRef.current = true;
        previewDeltaRef.current = { x: event.delta.x, y: event.delta.y };
        onDragPreview(action.event);
      }
    },
    [onDragPreview],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      setActiveItemKey(null);

      const action = decideDragEnd({
        active: readDragData(event.active.data.current),
        over: readDragData(event.over?.data.current),
        hasPreview: previewedRef.current,
        groupIds,
      });

      switch (action.kind) {
        case "preview":
        case "none":
          return;
        case "commit":
          onDrop(action.event);
          return;
        case "reorder-groups":
          onReorderGroups(action.orderedGroupIds);
          return;
        case "cancel-preview":
          onDragPreviewCancel();
          return;
      }
    },
    [groupIds, onDrop, onReorderGroups, onDragPreviewCancel],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={DND_MODIFIERS}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      measuring={MEASURING}
    >
      <SortableContext items={groupSortableIds} strategy={verticalListSortingStrategy}>
        <SidebarGroupDragActiveIdProvider value={activeId}>
          <SidebarGroupDragActiveItemProvider value={activeItemKey !== null}>
            {children}
          </SidebarGroupDragActiveItemProvider>
        </SidebarGroupDragActiveIdProvider>
      </SortableContext>
      {/* Only rows need the overlay. A group section is dragged against the OTHER group
          sections, which all live in the one SortableContext above, so its overIndex is
          always valid and the strategy transform works. A row's is not: it hovers targets
          outside its own group's context, where the strategy gives up and returns no
          transform at all.

          Portalled to the body because DragOverlay is position: fixed, and a fixed element
          is positioned against the nearest TRANSFORMED ancestor rather than the viewport.
          The sidebar is one: left-sidebar animates its width with Reanimated, which on web
          is a CSS transform. Left inside it, the dragged row hangs about a sidebar's-worth
          of offset below the cursor. */}
      {dragOverlayHost
        ? createPortal(
            <DragOverlay dropAnimation={null} modifiers={DND_MODIFIERS}>
              {activeItemKey ? (
                <SidebarDragOverlaySurface>
                  {renderDragOverlay(activeItemKey)}
                </SidebarDragOverlaySurface>
              ) : null}
            </DragOverlay>,
            dragOverlayHost,
          )
        : null}
    </DndContext>
  );
}

export const SIDEBAR_GROUP_DRAG_ENABLED = true;
