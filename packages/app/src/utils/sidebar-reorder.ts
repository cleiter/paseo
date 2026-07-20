export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

// Reorder a subset *in place*: the subset keeps the slots it already occupies in
// the stored order, and only permutes which member sits in which slot.
//
// mergeWithRemainder is wrong for a group's drag list because it hoists the
// reordered keys to the front — dragging one row inside "In review" would drag the
// whole group to the top of the project. Groups are ordered by where their first
// member sits, so their members' slots have to survive an internal reorder.
export function mergeWithinSlots(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  let cursor = 0;
  const merged = input.currentOrder.map((key) => {
    if (!reorderedSet.has(key)) {
      return key;
    }
    const next = input.reorderedVisibleKeys[cursor];
    cursor += 1;
    return next ?? key;
  });

  // Members the stored order has never seen (a freshly created workspace) have no
  // slot to keep, so they land at the end rather than being dropped.
  const placed = new Set(merged);
  for (const key of input.reorderedVisibleKeys) {
    if (!placed.has(key)) {
      merged.push(key);
    }
  }
  return merged;
}

// Move one key to sit where another key currently sits. This is what a cross-group
// drop needs and what neither merge above models: mergeWithinSlots only permutes a
// subset inside its own slots, and mergeWithRemainder hoists to the front.
//
// Grouping is a view over this flat order, so landing the moved key next to the row
// it was dropped on is what makes it appear inside the target group, adjacent to
// that row, instead of snapping back to where it came from.
export function moveKeyToPosition(input: {
  currentOrder: string[];
  movedKey: string;
  overKey: string;
}): string[] {
  const { currentOrder, movedKey, overKey } = input;
  if (movedKey === overKey) {
    return currentOrder;
  }

  const withoutMoved = currentOrder.filter((key) => key !== movedKey);
  const overIndex = withoutMoved.indexOf(overKey);
  if (overIndex < 0) {
    // The drop target isn't in the stored order yet (a freshly created workspace).
    // Appending keeps the move rather than dropping it on the floor.
    return [...withoutMoved, movedKey];
  }

  // Insert after the row when dragging downward, before it when dragging upward, so
  // the landing position matches where the cursor actually released.
  const movedIndex = currentOrder.indexOf(movedKey);
  const originalOverIndex = currentOrder.indexOf(overKey);
  const insertAt = movedIndex < originalOverIndex ? overIndex + 1 : overIndex;

  const next = [...withoutMoved];
  next.splice(insertAt, 0, movedKey);
  return next;
}

export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}
