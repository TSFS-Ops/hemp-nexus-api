/**
 * useDraftPersistence - saves and restores form drafts to sessionStorage.
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

export function useDraftPersistence<T>(key: string, getCurrentData?: () => T | null) {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const initialised = useRef(false);
  const getCurrentDataRef = useRef(getCurrentData);
  getCurrentDataRef.current = getCurrentData;

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
        // Storage full - silently ignore
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

  // Emergency save on session expiry OR page unload (universal safety net)
  useEffect(() => {
    const handler = () => {
      const data = getCurrentDataRef.current?.();
      if (data) {
        saveDraft(data);
      }
    };
    window.addEventListener("izenzo:session-expiry", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("izenzo:session-expiry", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [saveDraft]);

  return { restoreDraft, saveDraft, clearDraft, hasRestoredDraft };
}
