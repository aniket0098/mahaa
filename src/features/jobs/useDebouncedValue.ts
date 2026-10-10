import { useEffect, useState } from 'react';

/**
 * A value delayed by `delayMs`, for debouncing the search box against the real
 * `q` query parameter so a fast typist does not fire a request per keystroke.
 * The input itself stays responsive because only this debounced copy feeds the
 * query key.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
