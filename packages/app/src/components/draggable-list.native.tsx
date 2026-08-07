import { RefreshControl } from "react-native";
import { useCallback, useMemo, useState } from "react";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { useSharedValue } from "react-native-reanimated";
import { useUnistyles } from "react-native-unistyles";
import type { DraggableListProps, DraggableRenderItemInfo } from "./draggable-list.types";

export type { DraggableListProps, DraggableRenderItemInfo };

const SCROLL_ENABLED_FLEX_STYLE = { flex: 1 };

const noop = () => {};

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
  useDragHandle: _useDragHandle = false,
  refreshing,
  onRefresh,
  extraData,
  initialNumToRender,
  simultaneousGestureRef,
  gestureHostPresented,
  waitFor,
  onDragBegin: onDragBeginProp,
  onDragTerminate,
  canDrag,
  getValidSlots,
  // Web-only: native reshapes its rows before calling drag() instead, because this list
  // cancels any drag whose data changes underneath it.
  getDragSnapshot: _getDragSnapshot,
}: DraggableListProps<T>) {
  const { theme } = useUnistyles();
  const [isDragging, setIsDragging] = useState(false);
  // Read from the spacer worklet on every frame, so it has to be a shared value rather
  // than a prop the JS thread owns.
  const validSlots = useSharedValue<number[]>([]);

  const simultaneousHandlers = useMemo(
    () => (simultaneousGestureRef ? [simultaneousGestureRef] : undefined),
    [simultaneousGestureRef],
  );

  const refreshColors = useMemo(
    () => [theme.colors.foregroundMuted],
    [theme.colors.foregroundMuted],
  );

  const handleRenderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<T>) => {
      const index = getIndex() ?? 0;
      const info: DraggableRenderItemInfo<T> = {
        item,
        index,
        // A row that cannot be dragged simply never starts one. There is no "disabled"
        // to set: the list hands each row the callback and lets the row decide.
        drag: canDrag && !canDrag(item, index) ? noop : drag,
        isActive,
      };
      return renderItem(info);
    },
    [renderItem, canDrag],
  );

  const handleDragEnd = useCallback(
    ({ data: newData, from, to }: { data: T[]; from: number; to: number }) => {
      setIsDragging(false);
      validSlots.value = [];
      onDragEnd(newData, { from, to });
    },
    [onDragEnd, validSlots],
  );

  const handleDragBegin = useCallback(
    (index: number) => {
      setIsDragging(true);
      validSlots.value = getValidSlots?.(data, index) ?? [];
      onDragBeginProp?.(index);
    },
    [onDragBeginProp, getValidSlots, data, validSlots],
  );

  const handleDragTerminate = useCallback(() => {
    setIsDragging(false);
    validSlots.value = [];
    onDragTerminate?.();
  }, [onDragTerminate, validSlots]);

  // Release is NOT the end of the drag: it fires before the settle spring, and the drop
  // itself lands after it. Only the drag-active flag — which just gates the refresh
  // control — is safe to clear here.
  const handleRelease = useCallback(() => {
    setIsDragging(false);
  }, []);

  const showRefreshControl = Boolean(onRefresh) && (!isDragging || Boolean(refreshing));
  const resolvedContainerStyle =
    containerStyle ?? (scrollEnabled ? SCROLL_ENABLED_FLEX_STYLE : undefined);

  const refreshControl = useMemo(
    () =>
      showRefreshControl ? (
        <RefreshControl
          refreshing={refreshing ?? false}
          onRefresh={onRefresh}
          tintColor={theme.colors.foregroundMuted}
          colors={refreshColors}
        />
      ) : undefined,
    [showRefreshControl, refreshing, onRefresh, theme.colors.foregroundMuted, refreshColors],
  );

  return (
    <DraggableFlatList
      testID={testID}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={handleRenderItem}
      onDragEnd={handleDragEnd}
      style={style}
      containerStyle={resolvedContainerStyle}
      contentContainerStyle={contentContainerStyle}
      ListFooterComponent={ListFooterComponent}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      scrollEnabled={scrollEnabled}
      extraData={extraData}
      initialNumToRender={initialNumToRender}
      simultaneousHandlers={simultaneousHandlers}
      dragGestureHostPresented={gestureHostPresented}
      // The list is its own scroll container, so a lift has to be told apart from a
      // flick. Requiring travel before the drag takes over is what does that.
      activationDistance={20}
      onDragBegin={handleDragBegin}
      onDragTerminate={handleDragTerminate}
      onRelease={handleRelease}
      validSlots={validSlots}
      // @ts-ignore - waitFor is supported by RNGH FlatList but missing from DraggableFlatList types
      waitFor={waitFor}
      refreshControl={refreshControl}
    />
  );
}
