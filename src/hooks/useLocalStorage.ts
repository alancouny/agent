/**
 * useLocalStorage — persist any serializable value to localStorage.
 * Reads on mount with a initializer function to avoid re-parsing on every render.
 */
import { useState, useCallback } from 'react';

export function useLocalStorage<T>(key: string, defaults: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaults;
    } catch {
      return defaults;
    }
  });

  const setStoredValue = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = v instanceof Function ? v(prev) : v;
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* localStorage unavailable */ }
      return next;
    });
  }, [key]);

  return [value, setStoredValue];
}
