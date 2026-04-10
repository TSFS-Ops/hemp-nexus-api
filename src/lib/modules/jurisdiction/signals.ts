/**
 * Jurisdiction Signal Derivation
 *
 * Derives jurisdiction signals from all available pre-POI data for a match.
 * Sources (per David's confirmed list in j8):
 *   - Seller entity jurisdiction_code
 *   - Buyer entity jurisdiction_code
 *   - Organization jurisdictions arrays (both parties)
 *   - Origin/destination country (from match columns)
 *   - Jurisdiction stated in bid/offer (match metadata)
 *   - Trade order location (heuristic)
 */

import { supabase } from "@/integrations/supabase/client";
import type { JurisdictionSignal } from "./types";

/**
 * Derive jurisdiction signals from all available pre-POI data for a match.
 */
export async function deriveJurisdictionSignals(matchId: string): Promise<JurisdictionSignal[]> {
  const signals: JurisdictionSignal[] = [];

  // 1. Fetch match to get org references and new country fields
  const { data: match } = await supabase
    .from("matches")
    .select("buyer_org_id, seller_org_id, metadata, org_id, origin_country, destination_country")
    .eq("id", matchId)
    .maybeSingle();

  if (!match) return signals;

  // 2. Fetch entities for both orgs (entity jurisdiction_code)
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

  // 3. Fetch organization jurisdictions arrays (both parties)
  if (orgIds.length > 0) {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name, jurisdictions")
      .in("id", orgIds);

    if (orgs) {
      for (const org of orgs) {
        if (org.jurisdictions && Array.isArray(org.jurisdictions)) {
          const isBuyer = org.id === match.buyer_org_id;
          const isSeller = org.id === match.seller_org_id;
          const role = isBuyer ? "Buyer org" : isSeller ? "Seller org" : "Org";
          for (const jCode of org.jurisdictions) {
            if (typeof jCode === "string" && jCode.trim()) {
              signals.push({
                code: jCode.toUpperCase(),
                source: "org_jurisdictions",
                label: `${role}: ${org.name}`,
              });
            }
          }
        }
      }
    }
  }

  // 4. Origin and destination country (first-class match columns)
  if (match.origin_country) {
    signals.push({
      code: match.origin_country.toUpperCase(),
      source: "origin",
      label: "Origin country",
    });
  }
  if (match.destination_country) {
    signals.push({
      code: match.destination_country.toUpperCase(),
      source: "destination",
      label: "Destination country",
    });
  }

  // 5. Check match metadata for jurisdiction fields (legacy / bid-offer stated)
  const meta = match.metadata as Record<string, unknown> | null;
  if (meta) {
    if (typeof meta.origin_jurisdiction === "string" && meta.origin_jurisdiction) {
      signals.push({
        code: meta.origin_jurisdiction.toUpperCase(),
        source: "origin",
        label: "Origin jurisdiction (metadata)",
      });
    }
    if (typeof meta.destination_jurisdiction === "string" && meta.destination_jurisdiction) {
      signals.push({
        code: meta.destination_jurisdiction.toUpperCase(),
        source: "destination",
        label: "Destination jurisdiction (metadata)",
      });
    }
    if (typeof meta.jurisdiction === "string" && meta.jurisdiction) {
      signals.push({
        code: meta.jurisdiction.toUpperCase(),
        source: "bid_offer",
        label: "Stated in bid/offer",
      });
    }
  }

  // 6. Check trade_orders for location-derived jurisdiction
  const { data: orders } = await supabase
    .from("trade_orders")
    .select("location")
    .eq("org_id", match.org_id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (orders) {
    for (const order of orders) {
      if (order.location) {
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
