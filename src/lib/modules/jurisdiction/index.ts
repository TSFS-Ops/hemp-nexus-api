/**
 * Jurisdiction Module — Three-Branch Deterministic Rule
 *
 * Implements the confirmed jurisdiction selection logic for the WaD documentary path:
 *   Branch 1: One clear signal → auto-select
 *   Branch 2: Multiple signals → user chooses from surfaced set
 *   Branch 3: Material conflict → escalate to manual governance review
 *
 * "Material conflict" is defined as:
 *   - The chosen jurisdiction does not match any jurisdiction surfaced by the system, OR
 *   - No documentary rules exist for the chosen jurisdiction in governance_doc_registry
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ────────────────────────────────────────────────────────────

export interface JurisdictionSignal {
  code: string;
  source: string;
  label: string;
}

export type SelectionMethod = "auto" | "user_choice" | "escalated";

export interface JurisdictionResult {
  /** Deduplicated jurisdiction codes surfaced from all signals */
  surfacedJurisdictions: JurisdictionSignal[];
  /** Which branch of the three-branch rule applies */
  branch: 1 | 2 | 3;
  /** Auto-selected jurisdiction (branch 1 only) */
  autoSelected: string | null;
}

export interface JurisdictionSelection {
  id: string;
  match_id: string;
  org_id: string;
  selected_jurisdiction: string;
  surfaced_jurisdictions: JurisdictionSignal[];
  selection_method: SelectionMethod;
  escalation_reason: string | null;
  selected_by: string | null;
  created_at: string;
}

// ── Signal Derivation ────────────────────────────────────────────────

/**
 * Derive jurisdiction signals from all available pre-POI data for a match.
 * Sources: buyer entity, seller entity, match metadata, trade order location.
 */
export async function deriveJurisdictionSignals(matchId: string): Promise<JurisdictionSignal[]> {
  const signals: JurisdictionSignal[] = [];

  // 1. Fetch match to get org references
  const { data: match } = await supabase
    .from("matches")
    .select("buyer_org_id, seller_org_id, metadata, org_id")
    .eq("id", matchId)
    .maybeSingle();

  if (!match) return signals;

  // 2. Fetch entities for both orgs
  const orgIds = [match.org_id, match.buyer_org_id, match.seller_org_id].filter(Boolean) as string[];
  if (orgIds.length > 0) {
    const { data: entities } = await supabase
      .from("entities")
      .select("jurisdiction_code, legal_name, org_id")
      .in("org_id", orgIds)
      .eq("status", "active");

    if (entities) {
      for (const entity of entities) {
        if (entity.jurisdiction_code) {
          const isBuyer = entity.org_id === match.buyer_org_id;
          const isSeller = entity.org_id === match.seller_org_id;
          const role = isBuyer ? "Buyer entity" : isSeller ? "Seller entity" : "Entity";
          signals.push({
            code: entity.jurisdiction_code.toUpperCase(),
            source: "entity",
            label: `${role}: ${entity.legal_name}`,
          });
        }
      }
    }
  }

  // 3. Check match metadata for origin/destination
  const meta = match.metadata as Record<string, unknown> | null;
  if (meta) {
    if (typeof meta.origin_jurisdiction === "string" && meta.origin_jurisdiction) {
      signals.push({
        code: meta.origin_jurisdiction.toUpperCase() as string,
        source: "origin",
        label: "Origin jurisdiction",
      });
    }
    if (typeof meta.destination_jurisdiction === "string" && meta.destination_jurisdiction) {
      signals.push({
        code: meta.destination_jurisdiction.toUpperCase() as string,
        source: "destination",
        label: "Destination jurisdiction",
      });
    }
    if (typeof meta.jurisdiction === "string" && meta.jurisdiction) {
      signals.push({
        code: meta.jurisdiction.toUpperCase() as string,
        source: "bid_offer",
        label: "Stated in bid/offer",
      });
    }
  }

  // 4. Check trade_orders for location-derived jurisdiction
  const { data: orders } = await supabase
    .from("trade_orders")
    .select("location, metadata")
    .eq("org_id", match.org_id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (orders) {
    for (const order of orders) {
      const orderMeta = order.metadata as Record<string, unknown> | null;
      if (orderMeta && typeof orderMeta.jurisdiction === "string") {
        signals.push({
          code: (orderMeta.jurisdiction as string).toUpperCase(),
          source: "trade_order",
          label: `Trade order: ${order.location || "Unknown location"}`,
        });
      }
      // Attempt location-based derivation (South Africa locations)
      if (order.location && !orderMeta?.jurisdiction) {
        const loc = order.location.toLowerCase();
        if (
          loc.includes("south africa") || loc.includes("free state") ||
          loc.includes("gauteng") || loc.includes("cape") ||
          loc.includes("kwazulu") || loc.includes("limpopo") ||
          loc.includes("mpumalanga") || loc.includes("north west") ||
          loc.includes("eastern cape") || loc.includes("northern cape")
        ) {
          signals.push({
            code: "ZA",
            source: "trade_order_location",
            label: `Location: ${order.location}`,
          });
        }
      }
    }
  }

  return signals;
}

/**
 * Deduplicate signals by jurisdiction code, keeping all source labels.
 */
export function deduplicateSignals(signals: JurisdictionSignal[]): JurisdictionSignal[] {
  const map = new Map<string, JurisdictionSignal>();
  for (const signal of signals) {
    const existing = map.get(signal.code);
    if (existing) {
      // Merge labels
      existing.label = `${existing.label}; ${signal.label}`;
    } else {
      map.set(signal.code, { ...signal });
    }
  }
  return Array.from(map.values());
}

/**
 * Get unique jurisdiction codes from signals.
 */
export function getUniqueCodes(signals: JurisdictionSignal[]): string[] {
  return [...new Set(signals.map((s) => s.code))];
}

// ── Three-Branch Rule ────────────────────────────────────────────────

/**
 * Apply the three-branch deterministic rule to surfaced signals.
 */
export function applyThreeBranchRule(signals: JurisdictionSignal[]): JurisdictionResult {
  const deduped = deduplicateSignals(signals);
  const uniqueCodes = getUniqueCodes(signals);

  if (uniqueCodes.length === 0) {
    // No signals at all — escalate
    return {
      surfacedJurisdictions: deduped,
      branch: 3,
      autoSelected: null,
    };
  }

  if (uniqueCodes.length === 1) {
    // Branch 1: One clear signal → auto-select
    return {
      surfacedJurisdictions: deduped,
      branch: 1,
      autoSelected: uniqueCodes[0],
    };
  }

  // Branch 2: Multiple signals → user chooses
  return {
    surfacedJurisdictions: deduped,
    branch: 2,
    autoSelected: null,
  };
}

// ── Validation ───────────────────────────────────────────────────────

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
 * Validate a user's jurisdiction choice against the three-branch rules.
 * Returns null if valid, or an escalation reason string if invalid.
 */
export function validateSelection(
  chosenCode: string,
  surfacedCodes: string[],
): string | null {
  // Material conflict: chosen jurisdiction not in surfaced set
  if (surfacedCodes.length > 0 && !surfacedCodes.includes(chosenCode)) {
    return `Selected jurisdiction '${chosenCode}' does not match any jurisdiction surfaced from the transaction data (${surfacedCodes.join(", ")}). Escalated to manual governance review.`;
  }

  return null;
}

// ── Persistence ──────────────────────────────────────────────────────

/**
 * Fetch the existing jurisdiction selection for a match+org.
 */
export async function fetchJurisdictionSelection(
  matchId: string,
  orgId: string,
): Promise<JurisdictionSelection | null> {
  const { data, error } = await supabase
    .from("jurisdiction_selections")
    .select("*")
    .eq("match_id", matchId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching jurisdiction selection:", error);
    return null;
  }

  return data as JurisdictionSelection | null;
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
  const { error } = await supabase
    .from("jurisdiction_selections")
    .upsert(
      {
        match_id: params.matchId,
        org_id: params.orgId,
        selected_jurisdiction: params.selectedJurisdiction,
        surfaced_jurisdictions: params.surfacedJurisdictions as unknown as Record<string, unknown>,
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
