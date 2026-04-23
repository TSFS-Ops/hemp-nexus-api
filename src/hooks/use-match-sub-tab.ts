import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const ALLOWED = ["terms", "documents", "notes"] as const;
type SubTab = (typeof ALLOWED)[number];
const DEFAULT: SubTab = "terms";

const isAllowed = (v: string | null | undefined): v is SubTab =>
  !!v && (ALLOWED as readonly string[]).includes(v);

/**
 * Persist the active Match sub-tab (Terms / Documents / Notes) per user+match
 * to the backend so it restores after refresh or navigation.
 *
 * - Reads the saved value on mount.
 * - Writes optimistically on change with upsert.
 * - Falls back silently to "terms" on any error (zero swallowed errors policy:
 *   we still log via console.warn so issues surface in observability).
 */
export function useMatchSubTab(matchId: string | undefined) {
  const { user } = useAuth();
  const [subTab, setSubTabState] = useState<SubTab>(DEFAULT);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from backend once we have user + match
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !matchId) {
      setHydrated(true);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase
          .from("match_ui_prefs")
          .select("sub_tab")
          .eq("user_id", user.id)
          .eq("match_id", matchId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.warn("[useMatchSubTab] load failed", error);
        } else if (isAllowed(data?.sub_tab)) {
          setSubTabState(data!.sub_tab as SubTab);
        }
      } catch (err) {
        console.warn("[useMatchSubTab] load threw", err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, matchId]);

  const setSubTab = useCallback(
    (next: string) => {
      const value: SubTab = isAllowed(next) ? next : DEFAULT;
      setSubTabState(value);
      if (!user?.id || !matchId) return;
      // Fire-and-forget upsert. Errors are logged but never block UI.
      void (async () => {
        try {
          const { error } = await supabase
            .from("match_ui_prefs")
            .upsert(
              { user_id: user.id, match_id: matchId, sub_tab: value },
              { onConflict: "user_id,match_id" },
            );
          if (error) console.warn("[useMatchSubTab] save failed", error);
        } catch (err) {
          console.warn("[useMatchSubTab] save threw", err);
        }
      })();
    },
    [user?.id, matchId],
  );

  return { subTab, setSubTab, hydrated } as const;
}
