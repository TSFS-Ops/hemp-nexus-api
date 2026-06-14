/**
 * Phase 2 Step 4 — small hook resolving the two outreach roles
 * relevant to the Facilitation Outreach UI.
 *
 * UI must NEVER use these flags as security; they only drive
 * visibility of action affordances. All authorisation is enforced
 * server-side by the Step 3 edge functions.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface OutreachRoles {
  isPlatformAdmin: boolean;
  isComplianceAnalyst: boolean;
  loading: boolean;
}

export function useOutreachRoles(): OutreachRoles {
  const { user } = useAuth();
  const [state, setState] = useState<OutreachRoles>({
    isPlatformAdmin: false,
    isComplianceAnalyst: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setState({ isPlatformAdmin: false, isComplianceAnalyst: false, loading: false });
      return;
    }
    (async () => {
      try {
        const [pa, ca] = await Promise.all([
          supabase.rpc("has_role", { _user_id: user.id, _role: "platform_admin" }),
          supabase.rpc("has_role", { _user_id: user.id, _role: "compliance_analyst" }),
        ]);
        if (cancelled) return;
        setState({
          isPlatformAdmin: !!pa.data,
          isComplianceAnalyst: !!ca.data,
          loading: false,
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return state;
}
