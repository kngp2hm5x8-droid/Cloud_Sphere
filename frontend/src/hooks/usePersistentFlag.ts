import { useCallback, useState } from 'react';

// UI-preference only (e.g. sidebar collapsed). Storage may be unavailable, so every access is guarded.
export function usePersistentFlag(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try {
          window.localStorage.setItem(key, resolved ? '1' : '0');
        } catch {
          /* ignore */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}
