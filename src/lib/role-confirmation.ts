/**
 * D-03 Role inversion auto-fill: explicit user confirmation of trade side.
 *
 * Single source of truth for:
 *   - the production feature flag
 *   - inferring the user's side from a parsedQuery.role
 *   - detecting a conflict between selected and inferred side
 *   - writing the canonical audit row via record_role_confirmation RPC
 */
import { supabase } from "@/integrations/supabase/client";

export type TradeSide = "buyer" | "seller";

/**
 * Production-default feature flag. Allows emergency rollback only.
 * Default MUST be safe (true). Override with VITE_ROLE_CONFIRMATION_REQUIRED=false
 * for explicit emergency disable.
 */
export const ROLE_CONFIRMATION_REQUIRED: boolean =
  (import.meta as any)?.env?.VITE_ROLE_CONFIRMATION_REQUIRED !== "false";

/**
 * The search edge function (`supabase/functions/search/index.ts`) returns
 * `parsedQuery.role` already normalised to the **user's own side**:
 *   - explicit `role` param from the "I am a Buyer/Seller" toggle is passed
 *     through unchanged ("buyer" → user is a buyer);
 *   - free-text heuristics ("looking for buyers" → user is seller) are
 *     applied server-side BEFORE the value is returned.
 * The downstream "Searching: … as Buyer" chip in CounterpartySearch.tsx
 * already renders this value as the user's own side, so this helper must
 * return it as-is (no inversion). Inverting it caused a false "Confirm
 * your side" prompt every time the explicit toggle and the parsed role
 * agreed.
 */
export function inferUserSideFromParsedRole(
  parsedRole: TradeSide | null | undefined,
): TradeSide | null {
  if (parsedRole === "buyer") return "buyer";
  if (parsedRole === "seller") return "seller";
  return null;
}

export function detectSideConflict(
  selectedSide: TradeSide | null | undefined,
  inferredSide: TradeSide | null | undefined,
): boolean {
  if (!selectedSide || !inferredSide) return false;
  return selectedSide !== inferredSide;
}

export interface RecordRoleConfirmationArgs {
  originalSelectedSide: TradeSide | null;
  inferredSide: TradeSide | null;
  confirmedSide: TradeSide;
  matchId?: string | null;
  draftId?: string | null;
  sourceComponent?: string;
}

/**
 * Write the canonical match.counterparty_side.user_confirmed audit row.
 * Throws on failure so callers can stop the flow ("Zero Swallowed Errors").
 */
export async function recordRoleConfirmation(
  args: RecordRoleConfirmationArgs,
): Promise<string> {
  const { data, error } = await supabase.rpc("record_role_confirmation", {
    p_original_selected_side: args.originalSelectedSide,
    p_inferred_side: args.inferredSide,
    p_confirmed_side: args.confirmedSide,
    p_match_id: args.matchId ?? null,
    p_draft_id: args.draftId ?? null,
    p_source_component: args.sourceComponent ?? "CounterpartySearch",
  } as any);
  if (error) throw error;
  return data as unknown as string;
}
