import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that settles `delayMs` after the most recent
 * change. The initial value is returned immediately (no first-render flicker), and
 * the pending timer is cleared on every change and on unmount.
 *
 * Prior art: the inline debounce in `use-agent-autocomplete.ts`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
