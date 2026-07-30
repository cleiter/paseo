import { memo, useCallback, useMemo, useRef, type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
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

interface SortableItemProps<T> {
  id: string;
  item: T;
  index: number;
  renderItem: (info: DraggableRenderItemInfo<T>) => ReactElement;
  activeId: string | null;
  useDragHandle: boolean;
  itemData?: Record<string, unknown>;
  externallyControlled: boolean;
}

// When an ancestor owns the drag, the new order arrives as DATA — the row is already in
// its new place by the time dnd-kit would animate it there. Leaving the layout animation
// on makes the two fight: dnd-kit measures the row's old rect, the data moves it, and the
// row visibly flies in from where it used to be. A list that owns its own drag reorders
// itself synchronously, so there is nothing to fight and the animation is worth keeping.
const NO_LAYOUT_ANIMATION = () => false;

function getDraggedOpacity(isDragging: boolean, externallyControlled: boolean): number {
  if (!isDragging) {
    return 1;
  }
  return externallyControlled ? 0.35 : 0.9;
}

function SortableItemInner<T>({
  id,
  item,
  index,
  renderItem,
  activeId,
  useDragHandle,
  itemData,
  externallyControlled,
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
    data: itemData,
    ...(externallyControlled ? { animateLayoutChanges: NO_LAYOUT_ANIMATION } : {}),
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
  const draggedOpacity = getDraggedOpacity(isDragging, externallyControlled);
  const style = useMemo(
    () => ({
      transform: combinedTransform || undefined,
      // No transition on the settle either: with the order arriving as data, a transition
      // animates the row FROM the position it no longer occupies. And a placeholder has
      // nothing to transition to.
      transition: externallyControlled ? undefined : transition,
      // An externally-driven list renders the dragged row in an overlay that follows the
      // cursor, so the row left behind is a placeholder marking the gap — not a second
      // copy of the same row sitting there at nearly full strength.
      opacity: draggedOpacity,
      zIndex: isDragging ? 1000 : 1,
    }),
    [combinedTransform, transition, isDragging, externallyControlled, draggedOpacity],
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
  nestable: _nestable = false,
  externalDndContext = false,
  getItemData,
  activeId: externalActiveId = null,
}: DraggableListProps<T>) {
  const internal = useDragReorderState({
    data,
    keyExtractor,
    onDragEnd,
    onDragBegin,
  });
  const activationConstraints = getDragActivationConstraints(
    useDragHandle,
    DEFAULT_DRAG_ACTIVATION_CONFIG,
  );
  // When an ancestor owns the drag, its handlers fire — not ours — so our internal
  // reorder state would never update. Read the live data and the ancestor's activeId
  // instead of the stale internal copy.
  const items = externalDndContext ? data : internal.items;
  const activeId = externalDndContext ? externalActiveId : internal.activeId;
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
            itemData={getItemData?.(item, index)}
            externallyControlled={externalDndContext}
          />
        );
      })}
    </SortableContext>
  );

  // An ancestor already owns the DndContext, so mounting another here would trap the
  // drag inside this one list and make a cross-list drop impossible.
  const sortableBody = externalDndContext ? (
    sortableItems
  ) : (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={DND_MODIFIERS}
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
