/**
 * useDraftPersistence - saves and restores form drafts to sessionStorage.
 *
 * - Data is saved on every change (debounced by caller)
 * - Data persists for the browser session (survives refresh, not tab close)
 * - `clearDraft` should be called on successful submission
 * - Drafts are scoped per-authenticated-user. If the user signs out and a
 *   different user signs in on the same device, the previous user's draft
 *   is NOT restored or visible. Anonymous drafts (saved while logged out)
 *   are scoped to "anon" and never bleed into a signed-in user's view.
 *
 * Usage:
 *   const { restoreDraft, saveDraft, clearDraft, hasRestoredDraft } = useDraftPersistence<MyForm>("bid-offer");
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const DRAFT_PREFIX = "izenzo_draft_";
const ANON_OWNER = "anon";

interface StoredDraft<T> {
  data: T;
  savedAt: number;
  ownerId: string;
}

export function useDraftPersistence<T>(key: string, getCurrentData?: () => T | null) {
  const storageKey = `${DRAFT_PREFIX}${key}`;
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
  const initialised = useRef(false);
  const getCurrentDataRef = useRef(getCurrentData);
  getCurrentDataRef.current = getCurrentData;

  // Synchronous best-effort owner read. supabase.auth.getSession() can be
  // async in cold-start, but the cached session is available synchronously
  // via getSession() in practice - fall back to "anon" if absent.
  const ownerIdRef = useRef<string>(ANON_OWNER);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      ownerIdRef.current = data.session?.user?.id || ANON_OWNER;
    }).catch(() => {
      // leave as anon
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      ownerIdRef.current = session?.user?.id || ANON_OWNER;
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const restoreDraft = useCallback((): T | null => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredDraft<T>>;
      // Expire drafts older than 30 minutes
      if (!parsed.savedAt || Date.now() - parsed.savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      // Owner mismatch: a different user is now signed in (or the previous
      // owner was anon and we're now signed in, or vice versa). Discard
      // silently so account boundaries are respected on shared devices.
      const storedOwner = parsed.ownerId || ANON_OWNER;
      if (storedOwner !== ownerIdRef.current) {
        sessionStorage.removeItem(storageKey);
        return null;
      }
      return (parsed.data ?? null) as T | null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const saveDraft = useCallback(
    (data: T) => {
      try {
        const payload: StoredDraft<T> = {
          data,
          savedAt: Date.now(),
          ownerId: ownerIdRef.current,
        };
        sessionStorage.setItem(storageKey, JSON.stringify(payload));
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
    // Defer one tick so the auth-state listener above has a chance to populate
    // ownerIdRef from the cached session before we evaluate ownership.
    const t = setTimeout(() => {
      const draft = restoreDraft();
      if (draft) setHasRestoredDraft(true);
    }, 0);
    return () => clearTimeout(t);
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
