/**
 * Jurisdiction Signal Derivation
 *
 * Derives jurisdiction signals from all available pre-POI data for a match.
 * Sources:
 *   - Seller entity jurisdiction_code
 *   - Buyer entity jurisdiction_code
 *   - Organization jurisdictions arrays (both parties)
 *   - Origin/destination country (from match columns)
 *   - Jurisdiction stated in bid/offer (match metadata)
 *   - KYC documents (issuing country)
 *   - Match documents (document jurisdiction metadata)
 *   - Trade order location (ISO country code lookup)
 */

import { supabase } from "@/integrations/supabase/client";
import type { JurisdictionSignal } from "./types";

/**
 * Common location string → ISO 3166-1 alpha-2 mapping.
 * Covers major trading jurisdictions; extend as needed.
 */
const LOCATION_TO_ISO: Record<string, string> = {
  // Africa
  "south africa": "ZA", "free state": "ZA", "gauteng": "ZA", "cape": "ZA",
  "kwazulu": "ZA", "limpopo": "ZA", "mpumalanga": "ZA", "north west": "ZA",
  "eastern cape": "ZA", "northern cape": "ZA", "western cape": "ZA",
  "nigeria": "NG", "lagos": "NG", "abuja": "NG",
  "kenya": "KE", "nairobi": "KE", "mombasa": "KE",
  "ghana": "GH", "accra": "GH",
  "tanzania": "TZ", "dar es salaam": "TZ",
  "mozambique": "MZ", "maputo": "MZ",
  "zambia": "ZM", "lusaka": "ZM",
  "zimbabwe": "ZW", "harare": "ZW",
  "botswana": "BW", "gaborone": "BW",
  "namibia": "NA", "windhoek": "NA",
  "ethiopia": "ET", "addis ababa": "ET",
  "uganda": "UG", "kampala": "UG",
  "rwanda": "RW", "kigali": "RW",
  "egypt": "EG", "cairo": "EG",
  "morocco": "MA", "casablanca": "MA",
  // Americas
  "united states": "US", "new york": "US", "california": "US", "texas": "US", "chicago": "US",
  "brazil": "BR", "sao paulo": "BR", "são paulo": "BR",
  "canada": "CA", "toronto": "CA", "vancouver": "CA",
  "argentina": "AR", "buenos aires": "AR",
  "mexico": "MX", "mexico city": "MX",
  // Europe
  "united kingdom": "GB", "london": "GB", "england": "GB", "scotland": "GB",
  "germany": "DE", "berlin": "DE", "frankfurt": "DE", "hamburg": "DE",
  "france": "FR", "paris": "FR",
  "netherlands": "NL", "amsterdam": "NL", "rotterdam": "NL",
  "switzerland": "CH", "zurich": "CH", "geneva": "CH",
  "spain": "ES", "madrid": "ES", "barcelona": "ES",
  "italy": "IT", "rome": "IT", "milan": "IT",
  "belgium": "BE", "brussels": "BE",
  "portugal": "PT", "lisbon": "PT",
  "ireland": "IE", "dublin": "IE",
  // Asia-Pacific
  "china": "CN", "shanghai": "CN", "beijing": "CN", "shenzhen": "CN",
  "india": "IN", "mumbai": "IN", "delhi": "IN", "bangalore": "IN",
  "japan": "JP", "tokyo": "JP",
  "singapore": "SG",
  "hong kong": "HK",
  "australia": "AU", "sydney": "AU", "melbourne": "AU",
  "south korea": "KR", "seoul": "KR",
  "malaysia": "MY", "kuala lumpur": "MY",
  "thailand": "TH", "bangkok": "TH",
  "indonesia": "ID", "jakarta": "ID",
  "vietnam": "VN", "ho chi minh": "VN",
  "philippines": "PH", "manila": "PH",
  // Middle East
  "united arab emirates": "AE", "dubai": "AE", "abu dhabi": "AE",
  "saudi arabia": "SA", "riyadh": "SA",
  "turkey": "TR", "istanbul": "TR",
  "israel": "IL", "tel aviv": "IL",
};

function resolveLocationToISO(location: string): string | null {
  const loc = location.toLowerCase().trim();
  // Direct match
  for (const [key, code] of Object.entries(LOCATION_TO_ISO)) {
    if (loc.includes(key)) return code;
  }
  // If the string itself looks like an ISO code (2 uppercase letters)
  if (/^[A-Z]{2}$/.test(location.trim())) return location.trim();
  return null;
}

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

  // 6. KYC documents: issuing_country from documents linked to match parties
  if (orgIds.length > 0) {
    const { data: kycDocs } = await supabase
      .from("kyc_documents")
      .select("issuing_country, document_type, org_id")
      .in("org_id", orgIds)
      .not("issuing_country", "is", null)
      .limit(20);

    if (kycDocs) {
      for (const doc of kycDocs) {
        if (doc.issuing_country) {
          const isBuyer = doc.org_id === match.buyer_org_id;
          const isSeller = doc.org_id === match.seller_org_id;
          const role = isBuyer ? "Buyer" : isSeller ? "Seller" : "Party";
          signals.push({
            code: doc.issuing_country.toUpperCase(),
            source: "kyc_document",
            label: `${role} KYC doc (${doc.document_type})`,
          });
        }
      }
    }
  }

  // 7. Match documents: jurisdiction from document metadata
  const { data: matchDocs } = await supabase
    .from("match_documents")
    .select("metadata, document_type")
    .eq("match_id", matchId)
    .limit(20);

  if (matchDocs) {
    for (const doc of matchDocs) {
      const docMeta = doc.metadata as Record<string, unknown> | null;
      if (docMeta) {
        const jCode = docMeta.jurisdiction || docMeta.jurisdiction_code || docMeta.country;
        if (typeof jCode === "string" && jCode.trim()) {
          signals.push({
            code: jCode.toUpperCase(),
            source: "match_document",
            label: `Document: ${doc.document_type}`,
          });
        }
      }
    }
  }

  // 8. Trade orders: location-derived jurisdiction (broad country lookup, not ZA-only)
  const { data: orders } = await supabase
    .from("trade_orders")
    .select("location")
    .eq("org_id", match.org_id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (orders) {
    for (const order of orders) {
      if (order.location) {
        const isoCode = resolveLocationToISO(order.location);
        if (isoCode) {
          signals.push({
            code: isoCode,
            source: "trade_order_location",
            label: `Location: ${order.location}`,
          });
        }
      }
    }
  }

  return signals;
}
