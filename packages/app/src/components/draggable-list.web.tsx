import { memo, useCallback, useMemo, useRef, type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  type Modifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DraggableListProps, DraggableRenderItemInfo } from "./draggable-list.types";
import {
  DEFAULT_DRAG_ACTIVATION_CONFIG,
  getDragActivationConstraints,
  useDragReorderState,
} from "./drag-reorder";

export type { DraggableListProps, DraggableRenderItemInfo };

const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const DND_MODIFIERS = [restrictToVerticalAxis];

// The rows a drag runs against are not the ones it started from — picking up a group folds
// its children away. dnd-kit measures droppables once at drag start by default, so it would
// keep aiming at rects for rows that are no longer on screen.
const REMEASURE_ALWAYS = {
  droppable: { strategy: MeasuringStrategy.Always },
};

interface SortableItemProps<T> {
  id: string;
  item: T;
  index: number;
  renderItem: (info: DraggableRenderItemInfo<T>) => ReactElement;
  activeId: string | null;
  useDragHandle: boolean;
  canDrag: boolean;
  canDrop: boolean;
}

function SortableItemInner<T>({
  id,
  item,
  index,
  renderItem,
  activeId,
  useDragHandle,
  canDrag,
  canDrop,
}: SortableItemProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    // Granular on purpose. `disabled: true` turns off the drop target as well as the drag
    // source, and the rows you cannot pick up — section headers, the "show more" toggle —
    // are exactly the ones a drop needs to be able to land next to.
    disabled: { draggable: !canDrag, droppable: !canDrop },
  });

  const dragRef = useRef<(() => void) | null>(null);

  const drag = useCallback(() => {
    // dnd-kit handles drag initiation via listeners
    // This is a no-op but matches the mobile API
  }, []);

  // Store listeners in ref so drag handle can access them
  dragRef.current = () => {
    // Trigger drag - handled by dnd-kit's listeners
  };

  // dnd-kit can set `scaleX/scaleY` on the active item when dragging over a
  // differently-sized droppable. For variable-height rows this can look like
  // the "ghost" stretches. Keep the dragged item's size stable by zeroing
  // out the dnd-kit scaling component.
  const baseTransform = CSS.Transform.toString(
    transform && isDragging ? { ...transform, scaleX: 1, scaleY: 1 } : transform,
  );
  const scaleTransform = isDragging ? "scale(1.02)" : "";
  const combinedTransform = [baseTransform, scaleTransform].filter(Boolean).join(" ");

  // The active item KEEPS its transform, even though an overlay is also carrying it.
  //
  // Suppressing it looked right — the overlay follows the cursor, so why should the
  // placeholder move too? — and it was wrong. The sorting strategy makes room by shifting
  // the OTHER items into the dragged item's slot, on the assumption that the dragged item
  // vacates it by taking its own transform. Hold it still and the row above slides
  // straight on top of it: two titles printed in one place.
  //
  // The placeholder slides to where the item will land. That is the point of it.
  const style = useMemo(
    () => ({
      transform: combinedTransform || undefined,
      transition,
      opacity: isDragging ? 0.9 : 1,
      zIndex: isDragging ? 1000 : 1,
    }),
    [combinedTransform, transition, isDragging],
  );

  const info: DraggableRenderItemInfo<T> = {
    item,
    index,
    drag,
    isActive: activeId === id,
    dragHandleProps: useDragHandle
      ? {
          attributes: attributes as unknown as Record<string, unknown>,
          listeners: listeners as unknown as Record<string, unknown>,
          setActivatorNodeRef: setActivatorNodeRef as unknown as (node: unknown) => void,
        }
      : undefined,
  };

  const wrapperProps = useDragHandle
    ? { ref: setNodeRef }
    : { ref: setNodeRef, ...attributes, ...listeners };

  return (
    <div {...wrapperProps} style={style}>
      {renderItem(info)}
    </div>
  );
}

const SortableItem = memo(SortableItemInner) as typeof SortableItemInner;

export function DraggableList<T>({
  data,
  keyExtractor,
  renderItem,
  onDragEnd,
  style,
  containerStyle,
  contentContainerStyle,
  testID,
  ListFooterComponent,
  ListHeaderComponent,
  ListEmptyComponent,
  showsVerticalScrollIndicator = true,
  scrollEnabled = true,
  extraData: _extraData,
  useDragHandle = false,
  // simultaneousGestureRef is native-only, ignored on web
  onDragBegin,
  onDragTerminate,
  canDrag,
  getValidSlots,
  getDragSnapshot,
}: DraggableListProps<T>) {
  const internal = useDragReorderState({
    data,
    keyExtractor,
    onDragEnd,
    onDragBegin,
    onDragTerminate,
    snapshotForDrag: getDragSnapshot,
  });
  const activationConstraints = getDragActivationConstraints(
    useDragHandle,
    DEFAULT_DRAG_ACTIVATION_CONFIG,
  );
  const items = internal.items;
  const activeId = internal.activeId;
  const handlers = internal.handlers;

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: activationConstraints.mouse,
    }),
    useSensor(TouchSensor, {
      activationConstraint: activationConstraints.touch,
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ids = useMemo(
    () => items.map((item, index) => keyExtractor(item, index)),
    [items, keyExtractor],
  );

  // Asked once per drag, against the rows the drag is running on. Null means "not
  // dragging, or no restriction" — every row stays droppable.
  const validSlots = useMemo(() => {
    if (!getValidSlots || internal.activeIndex < 0) {
      return null;
    }
    const slots = getValidSlots(items, internal.activeIndex);
    return slots.length > 0 ? new Set(slots) : null;
  }, [getValidSlots, items, internal.activeIndex]);
  const wrapperStyle = useMemo(
    () => [
      { position: "relative" as const },
      scrollEnabled ? { flex: 1, minHeight: 0 } : null,
      containerStyle,
    ],
    [scrollEnabled, containerStyle],
  );

  const sortableItems = (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {items.map((item, index) => {
        const id = keyExtractor(item, index);
        return (
          <SortableItem
            key={id}
            id={id}
            item={item}
            index={index}
            renderItem={renderItem}
            activeId={activeId}
            useDragHandle={useDragHandle}
            canDrag={canDrag ? canDrag(item, index) : true}
            canDrop={validSlots ? validSlots.has(index) : true}
          />
        );
      })}
    </SortableContext>
  );

  const sortableBody = (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={DND_MODIFIERS}
      measuring={getDragSnapshot ? REMEASURE_ALWAYS : undefined}
      onDragStart={handlers.onDragStart}
      onDragCancel={handlers.onDragCancel}
      onDragEnd={handlers.onDragEnd}
    >
      {sortableItems}
    </DndContext>
  );

  return (
    <View style={wrapperStyle}>
      {scrollEnabled ? (
        <ScrollView
          testID={testID}
          style={style}
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        >
          {ListHeaderComponent}
          {items.length === 0 && ListEmptyComponent}
          {sortableBody}
          {ListFooterComponent}
        </ScrollView>
      ) : (
        <>
          {ListHeaderComponent}
          {items.length === 0 && ListEmptyComponent}
          {sortableBody}
          {ListFooterComponent}
        </>
      )}
    </View>
  );
}
