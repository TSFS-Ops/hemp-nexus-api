/**
 * useDraftPersistence — saves and restores form drafts to sessionStorage.
 *
 * - Data is saved on every change (debounced by caller)
 * - Data persists for the browser session (survives refresh, not tab close)
 * - `clearDraft` should be called on successful submission
 *
 * Usage:
 *   const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<MyForm>("bid-offer");
 */

import { useState, useCallback, useEffect, useRef } from "react";

const DRAFT_PREFIX = "izenzo_draft_";

export function useDraftPersistence<T>(key: string) {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const initialised = useRef(false);

  const restoreDraft = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { data: T; savedAt: number };
      // Expire drafts older than 30 minutes
      if (Date.now() - parsed.savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }, [storageKey]);

  const saveDraft = useCallback(
    (data: T) => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ data, savedAt: Date.now() })
        );
      } catch {
        // Storage full — silently ignore
      }
    },
    [storageKey]
  );

  const clearDraft = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setHasRestoredDraft(false);
  }, [storageKey]);

  // Check on mount if a draft exists
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    const draft = restoreDraft();
    if (draft) setHasRestoredDraft(true);
  }, [restoreDraft]);

  return { restoreDraft, saveDraft, clearDraft, hasRestoredDraft };
}
