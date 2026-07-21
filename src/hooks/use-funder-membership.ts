/**
 * useFunderMembership — detects whether the current user has an active
 * row in p5_batch3_funder_users (any funder role). Used by shared chrome
 * (PublicHeader) to route funder users to /funder/workspace instead of
 * the ordinary Dashboard/Trade Desk.
 *
 * Read-only, best-effort. Does NOT gate data access — RLS remains the
 * authority.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useFunderMembership(): { isFunderUser: boolean; loaded: boolean } {
  const { user, isAuthenticated } = useAuth();
  const [state, setState] = useState<{ isFunderUser: boolean; loaded: boolean }>({
    isFunderUser: false,
    loaded: !isAuthenticated,
  });

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !user) {
      setState({ isFunderUser: false, loaded: true });
      return;
    }
    setState((s) => ({ ...s, loaded: false }));
    (async () => {
      try {
        // SECURITY DEFINER RPC — bypasses missing table GRANT on p5_batch3_funder_users.
        const { data } = await (supabase as unknown as {
          rpc: (name: string) => Promise<{ data: string | null; error: unknown }>;
        }).rpc("fw_current_funder_org_v1");
        if (cancelled) return;
        setState({ isFunderUser: !!data, loaded: true });
      } catch {
        if (cancelled) return;
        setState({ isFunderUser: false, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isAuthenticated]);

  return state;
}
