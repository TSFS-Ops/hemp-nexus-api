/**
 * useUserOrg - Returns the current user's org_id from their profile.
 * Cached per session to avoid repeated queries.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useUserOrg() {
  const { session } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.user?.id) {
      setOrgId(null);
      return;
    }

    supabase
      .from("profiles")
      .select("org_id")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.org_id) setOrgId(data.org_id);
      });
  }, [session?.user?.id]);

  return orgId;
}

/** Determine the user's role in a match */
export function getMatchRole(
  orgId: string | null,
  match: { org_id: string; buyer_org_id?: string | null; seller_org_id?: string | null }
): "buyer" | "seller" | "creator" | null {
  if (!orgId) return null;
  // Check canonical buyer/seller slots first — the creator IS the buyer or seller
  if (match.buyer_org_id === orgId) return "buyer";
  if (match.seller_org_id === orgId) return "seller";
  // Fallback: creator without a buyer/seller slot (e.g. unilateral with no org in either slot)
  if (match.org_id === orgId) return "creator";
  return null;
}
