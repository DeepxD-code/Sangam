import { useState, useEffect } from 'react';

/**
 * useSearchState  (Day 45)
 *
 * Persists a filter/search object in sessionStorage so that
 * navigating away and back restores the user's last filter.
 *
 * @param {string} key          - unique key per page (e.g. 'transfers-filter')
 * @param {object} defaultState - initial state if nothing stored
 * @returns [state, setState]   - same API as useState
 *
 * Usage:
 *   const [filters, setFilters] = useSearchState('transfers', { status: 'ALL' });
 */
export function useSearchState(key, defaultState) {
  const storageKey = `sangam:search:${key}`;

  function readStored() {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const [state, setStateRaw] = useState(() => {
    const stored = readStored();
    return stored !== null ? { ...defaultState, ...stored } : defaultState;
  });

  // Persist on every change
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // sessionStorage not available (private browsing edge case)
    }
  }, [storageKey, state]);

  return [state, setStateRaw];
}

/**
 * clearSearchState(key)
 * Call this when the user explicitly resets filters to clear storage.
 */
export function clearSearchState(key) {
  try {
    sessionStorage.removeItem(`sangam:search:${key}`);
  } catch { /* noop */ }
}
