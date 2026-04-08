/**
 * Discovery Intelligence Module - Client API
 * 
 * Layer: INTEL (above TRUST, below TRADE)
 * 
 * Provides client-side access to:
 *   - OSINT crawl requests (DISC-002)
 *   - Public presence scoring (DISC-003)  
 *   - Collateral documentation (DISC-004)
 *   - Discovery eligibility evaluation (DISC-006)
 *   - Gate status checks (DISC-007)
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ──

export interface CrawlRequest {
  entity_id: string;
  entity_name: string;
  company_identifiers?: string[];
  domain_names?: string[];
}

export interface CrawlResult {
  crawl_id: string;
  entity_id: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  news_reference_count: number;
  social_reference_count: number;
  web_reference_count: number;
  entity_match_confidence: number;
  public_presence_score: number;
}

export interface EligibilitySignals {
  id_verified?: boolean;
  contact_verified?: boolean;
  company_exists?: boolean;
  email_domain_match?: boolean;
  operating_footprint_score?: number;
  declared_role?: string;
  authority_document_present?: boolean;
  sanctions_status?: "CLEAR" | "POTENTIAL_MATCH" | "CONFIRMED_MATCH";
}

export interface EligibilitySnapshot {
  snapshot_id: string;
  entity_id: string;
  eligibility_score: number;
  eligibility_status: "PASS" | "REVIEW" | "FAIL";
  signals: Record<string, unknown>;
  hard_fail_reasons: string[];
  review_reasons: string[];
  expires_at: string;
  expired?: boolean;
}

export interface VaultDocument {
  id: string;
  entity_id: string;
  document_type: string;
  file_name: string;
  storage_path: string;
  created_at: string;
}

// ── DISC-003 Public Presence Score (client mirror) ──

export function calculatePublicPresenceScore(
  newsCount: number,
  socialCount: number,
  webCount: number,
): number {
  const R = newsCount + socialCount + webCount;
  return Math.min(10, Math.floor(Math.log(R + 1) * 3));
}

// ── API Client ──

export const discoveryIntel = {
  /** DISC-002: Request OSINT crawl */
  async requestCrawl(params: CrawlRequest): Promise<CrawlResult> {
    const { data, error } = await supabase.functions.invoke("intel-crawl", {
      method: "POST",
      body: params,
    });
    if (error) throw new Error(error.message);
    return data.data;
  },

  /** DISC-002: Get crawl results */
  async getCrawl(crawlId: string): Promise<CrawlResult> {
    const { data, error } = await supabase.functions.invoke("intel-crawl", {
      method: "GET",
      body: null,
      headers: {},
    });
    // GET with query params requires manual fetch
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intel-crawl?crawl_id=${crawlId}`;
    const session = await supabase.auth.getSession();
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();
    return result.data;
  },

  /** DISC-002: List crawls for entity */
  async listCrawls(entityId: string): Promise<CrawlResult[]> {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intel-crawl?entity_id=${entityId}`;
    const session = await supabase.auth.getSession();
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();
    return result.data;
  },

  /** DISC-006: Evaluate eligibility */
  async evaluateEligibility(entityId: string, signals?: EligibilitySignals): Promise<EligibilitySnapshot> {
    const { data, error } = await supabase.functions.invoke("discovery-eligibility", {
      method: "POST",
      body: { entity_id: entityId, signals },
    });
    if (error) throw new Error(error.message);
    return data.data;
  },

  /** DISC-006: Get latest eligibility */
  async getEligibility(entityId: string): Promise<EligibilitySnapshot> {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discovery-eligibility?entity_id=${entityId}`;
    const session = await supabase.auth.getSession();
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();
    return result.data;
  },

  /** DISC-004: Upload vault document metadata */
  async uploadCollateral(params: {
    entity_id: string;
    document_type: string;
    file_name: string;
    storage_path: string;
    file_size?: number;
    mime_type?: string;
  }): Promise<VaultDocument> {
    const { data, error } = await supabase.functions.invoke("vault-documents", {
      method: "POST",
      body: params,
    });
    if (error) throw new Error(error.message);
    return data.data;
  },

  /** DISC-004: List vault documents */
  async listCollateral(entityId: string): Promise<VaultDocument[]> {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vault-documents?entity_id=${entityId}`;
    const session = await supabase.auth.getSession();
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();
    return result.data;
  },

  /** DISC-007: Check if entity passes discovery gate */
  async checkGate(entityId: string): Promise<{ passed: boolean; status: string; reason: string }> {
    try {
      const eligibility = await this.getEligibility(entityId);
      const passed = eligibility.eligibility_status === "PASS" && !eligibility.expired;
      return {
        passed,
        status: eligibility.eligibility_status,
        reason: passed
          ? "Discovery gate passed"
          : eligibility.expired
            ? "Eligibility snapshot expired (>30 days)"
            : `Eligibility status: ${eligibility.eligibility_status} (score: ${eligibility.eligibility_score})`,
      };
    } catch {
      return {
        passed: false,
        status: "UNKNOWN",
        reason: "No eligibility snapshot found - run evaluation first",
      };
    }
  },
};
