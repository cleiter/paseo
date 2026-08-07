import type { ReactElement, MutableRefObject } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { GestureType } from "react-native-gesture-handler";

export interface DraggableListDragHandleProps {
  /**
   * Web-only drag handle props (from dnd-kit). Spread these onto the element
   * that should initiate the drag. Native uses the `drag()` callback instead.
   */
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  setActivatorNodeRef?: (node: unknown) => void;
}

export interface DraggableRenderItemInfo<T> {
  item: T;
  index: number;
  drag: () => void;
  isActive: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

// Where the drop landed, in the SAME index space on both platforms: `to` is an insertion
// index into the data with the dragged row removed, so `arrayMove(data, from, to)` is the
// new order. dnd-kit's arrayMove and the native list's splice pair agree on this; the
// caller can read the row above `to` to decide what the drop meant.
export interface DraggableListDropMeta {
  from: number;
  to: number;
}

export interface DraggableListProps<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: DraggableRenderItemInfo<T>) => ReactElement;
  onDragEnd: (data: T[], meta: DraggableListDropMeta) => void;
  style?: StyleProp<ViewStyle>;
  /** Outer container style (useful for nested, non-scrolling lists). */
  containerStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  ListFooterComponent?: ReactElement | null;
  ListHeaderComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  showsVerticalScrollIndicator?: boolean;
  /** When false, disables internal scrolling (use outer list to scroll). */
  scrollEnabled?: boolean;
  /**
   * Web-only: when true, the drag can only be initiated from the handle props
   * passed to `renderItem` (prevents nested lists from fighting).
   */
  useDragHandle?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Fill remaining space when content is smaller than container */
  contentContainerFlexGrow?: boolean;
  /** External row state that should invalidate virtualized native cells. */
  extraData?: unknown;
  /** Gesture ref for simultaneous handling with parent gestures (e.g., sidebar close) */
  simultaneousGestureRef?: MutableRefObject<GestureType | undefined>;
  /** Whether the retained native gesture host is currently presented. */
  gestureHostPresented?: boolean;
  /** Gesture ref(s) that the list should wait for before handling scroll */
  waitFor?: MutableRefObject<GestureType | undefined> | MutableRefObject<GestureType | undefined>[];
  /** Called when a drag gesture begins (before items are reordered) */
  onDragBegin?: (index: number) => void;
  /**
   * Called when a drag ends WITHOUT a drop — cancelled, interrupted, or unmounted.
   * Together with `onDragEnd` this is the complete set of drag-state cleanup triggers.
   * `onDragRelease` is not one of them: on native it fires before the settle spring, so
   * cleaning up there tears down the drag while it is still animating into place.
   */
  onDragTerminate?: () => void;
  /**
   * Whether a row may START a drag. A row that answers false still takes part in the
   * layout and can still be dropped past; it just cannot be picked up. Kept separate
   * from where a drop may LAND because dnd-kit's single `disabled` flag turns off both
   * at once, and rows that cannot be dragged are usually the ones you drop next to.
   */
  canDrag?: (item: T, index: number) => boolean;
  /**
   * Where this drag may land, as insertion indices into the data with the dragged row
   * removed — the same space as `DraggableListDropMeta`. Asked once when the drag
   * begins, and answered against the data the drag will actually run on.
   *
   * The list makes every other slot UNREACHABLE rather than rejecting a drop on it: the
   * native spacer snaps to the nearest valid slot, and web disables the other rows as
   * drop targets. Nothing else can express "the gap only opens where the drop lands",
   * and on native a rejected drop leaves the rows it displaced holding their translate.
   *
   * An empty result means no restriction.
   */
  getValidSlots?: (data: T[], from: number) => number[];
  /**
   * WEB ONLY. The data to run the drag against, given the row being picked up — the
   * chance to fold a container's children away as it lifts. The drag is frozen against
   * what this returns; `data` changing mid-drag does not disturb it.
   *
   * Native has no equivalent hook, because the underlying list cancels a drag whose data
   * changes: the owner has to reshape the rows BEFORE calling `drag()` instead.
   */
  getDragSnapshot?: (data: T[], from: number) => T[];
  /** Called immediately before invoking row `drag()` to lock outer owners. */
  onDragIntent?: () => void;
  /** Called when drag interaction ends (finger released). */
  onDragRelease?: () => void;
  /**
   * Native-only: use the nestable draggable-flatlist variant for nested drag
   * lists coordinated by a shared NestableScrollContainer.
   */
  nestable?: boolean;
  /**
   * WEB ONLY. When true the list does NOT mount its own DndContext and instead
   * renders a bare SortableContext, expecting an ancestor to own the drag. This is
   * what lets one drag span several lists (e.g. moving a workspace between groups);
   * a per-list DndContext can't do that, because dnd-kit cannot drag across contexts.
   * The ancestor then owns `activeId` and the drag handlers. Native ignores it.
   */
  externalDndContext?: boolean;
  /**
   * WEB ONLY. Attaches a typed payload to each draggable so the ancestor's drag
   * handler can tell which list an item came from and which it was dropped on.
   * Without it `event.active.data` is empty and a cross-list drop is unreadable.
   */
  getItemData?: (item: T, index: number) => Record<string, unknown>;
  /** WEB ONLY. The dragging item's id when an ancestor owns the DndContext. */
  activeId?: string | null;
}
