import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ApiException } from "./errors.ts";

/**
 * Licence Enforcement Module
 * 
 * Enforces annual licence requirements for all billable actions.
 * Per Work Program p.2: "An active paid annual licence is required for all chargeable actions"
 * 
 * Licence Tiers (from Price List p.9):
 * - Professional: USD $5,000/year
 * - Corporate: USD $15,000/year
 * - Institutional: USD $50,000/year
 * - Sovereign: Custom pricing
 */

export interface Licence {
  id: string;
  org_id: string;
  tier: 'professional' | 'corporate' | 'institutional' | 'sovereign';
  starts_at: string;
  expires_at: string;
  payment_reference: string | null;
  amount_usd: number;
  status: 'active' | 'expired' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface LicenceCheckResult {
  valid: boolean;
  licence: Licence | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  tier: string | null;
  reason?: string;
}

// Endpoints exempt from licence checks (free tier access)
const LICENCE_EXEMPT_ENDPOINTS = [
  '/healthz',
  '/health',
  '/docs',
  '/openapi',
  '/auth',
  '/demo',
  '/_shared',
  '/search', // Discovery is free per Work Program
];

// Grace period in days before expiry to warn
const EXPIRY_WARNING_DAYS = 30;

/**
 * Check if an endpoint requires a valid licence
 */
export function requiresLicence(endpoint: string): boolean {
  const normalizedEndpoint = endpoint.toLowerCase();
  
  for (const exempt of LICENCE_EXEMPT_ENDPOINTS) {
    if (normalizedEndpoint.startsWith(exempt.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if an organization has a valid active licence
 */
export async function checkLicenceValidity(
  supabase: SupabaseClient,
  orgId: string
): Promise<LicenceCheckResult> {
  const now = new Date().toISOString();
  
  // Fetch active licence for the organization
  const { data: licence, error } = await supabase
    .from("licences")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "active")
    .gt("expires_at", now)
    .order("expires_at", { ascending: false })
    .maybeSingle();
  
  if (error) {
    console.error("Error checking licence:", error);
    throw new ApiException(
      "LICENCE_CHECK_FAILED",
      "Failed to verify licence status",
      500
    );
  }
  
  if (!licence) {
    return {
      valid: false,
      licence: null,
      expiresAt: null,
      daysRemaining: null,
      tier: null,
      reason: "No active licence found. Please purchase a licence to access billable features.",
    };
  }
  
  // Calculate days remaining
  const expiresAt = new Date(licence.expires_at);
  const nowDate = new Date();
  const daysRemaining = Math.ceil((expiresAt.getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24));
  
  return {
    valid: true,
    licence: licence as Licence,
    expiresAt: licence.expires_at,
    daysRemaining,
    tier: licence.tier,
  };
}

/**
 * Check if licence is approaching expiry
 */
export function isLicenceNearExpiry(checkResult: LicenceCheckResult): boolean {
  if (!checkResult.valid || checkResult.daysRemaining === null) {
    return false;
  }
  return checkResult.daysRemaining <= EXPIRY_WARNING_DAYS;
}

/**
 * Enforce licence requirement for billable endpoints
 * Throws 403 if no valid licence exists
 */
export async function enforceLicence(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string
): Promise<LicenceCheckResult> {
  // Check if endpoint requires licence
  if (!requiresLicence(endpoint)) {
    return {
      valid: true,
      licence: null,
      expiresAt: null,
      daysRemaining: null,
      tier: null,
    };
  }
  
  const checkResult = await checkLicenceValidity(supabase, orgId);
  
  if (!checkResult.valid) {
    throw new ApiException(
      "LICENCE_REQUIRED",
      checkResult.reason || "An active licence is required to access this feature. Please purchase or renew your licence.",
      403,
      {
        code: "LICENCE_REQUIRED",
        purchaseUrl: "/dashboard/licence",
      }
    );
  }
  
  // Log warning if licence is near expiry
  if (isLicenceNearExpiry(checkResult)) {
    console.warn(
      `[Licence Warning] Org ${orgId} licence expires in ${checkResult.daysRemaining} days`
    );
  }
  
  return checkResult;
}

/**
 * Get licence usage stats for an organization
 */
export async function getLicenceStats(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  hasLicence: boolean;
  currentLicence: Licence | null;
  licenceHistory: Licence[];
  expiresAt: string | null;
  daysRemaining: number | null;
}> {
  // Get current active licence
  const checkResult = await checkLicenceValidity(supabase, orgId);
  
  // Get licence history
  const { data: history, error } = await supabase
    .from("licences")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);
  
  if (error) {
    console.error("Error fetching licence history:", error);
  }
  
  return {
    hasLicence: checkResult.valid,
    currentLicence: checkResult.licence,
    licenceHistory: (history || []) as Licence[],
    expiresAt: checkResult.expiresAt,
    daysRemaining: checkResult.daysRemaining,
  };
}

/**
 * Tier-based features/limits (for future use)
 */
export const TIER_LIMITS = {
  professional: {
    maxTransactionsPerMonth: 100,
    maxUsersPerOrg: 5,
    supportLevel: 'email',
  },
  corporate: {
    maxTransactionsPerMonth: 500,
    maxUsersPerOrg: 25,
    supportLevel: 'priority',
  },
  institutional: {
    maxTransactionsPerMonth: -1, // Unlimited
    maxUsersPerOrg: -1, // Unlimited
    supportLevel: 'dedicated',
  },
  sovereign: {
    maxTransactionsPerMonth: -1,
    maxUsersPerOrg: -1,
    supportLevel: 'dedicated',
  },
} as const;
