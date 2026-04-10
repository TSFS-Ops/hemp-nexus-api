/**
 * Jurisdiction Module - Persistence (save/fetch selections)
 */

import { supabase } from "@/integrations/supabase/client";
import type { JurisdictionSignal, SelectionMethod, JurisdictionSelection } from "./types";

/**
 * Check if documentary rules exist for a jurisdiction in the governance registry.
 */
export async function hasGovernanceRules(jurisdictionCode: string, orgId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("governance_doc_registry")
    .select("id", { count: "exact", head: true })
    .eq("jurisdiction_code", jurisdictionCode)
    .eq("org_id", orgId)
    .eq("active", true);

  if (error) {
    console.error("Error checking governance rules:", error);
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Fetch the existing jurisdiction selection for a match+org.
 */
export async function fetchJurisdictionSelection(
  matchId: string,
  orgId: string,
): Promise<JurisdictionSelection | null> {
  const { data, error } = await (supabase as any)
    .from("jurisdiction_selections")
    .select("*")
    .eq("match_id", matchId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching jurisdiction selection:", error);
    return null;
  }

  return (data as unknown as JurisdictionSelection) ?? null;
}

/**
 * Save a jurisdiction selection. Handles auto, user_choice, and escalated.
 */
export async function saveJurisdictionSelection(params: {
  matchId: string;
  orgId: string;
  selectedJurisdiction: string;
  surfacedJurisdictions: JurisdictionSignal[];
  selectionMethod: SelectionMethod;
  escalationReason?: string | null;
  selectedBy?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const { error } = await (supabase as any)
    .from("jurisdiction_selections")
    .upsert(
      {
        match_id: params.matchId,
        org_id: params.orgId,
        selected_jurisdiction: params.selectedJurisdiction,
        surfaced_jurisdictions: params.surfacedJurisdictions,
        selection_method: params.selectionMethod,
        escalation_reason: params.escalationReason ?? null,
        selected_by: params.selectedBy ?? null,
      },
      { onConflict: "match_id,org_id" },
    );

  if (error) {
    console.error("Error saving jurisdiction selection:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}
