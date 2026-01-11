import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { ApiException } from "./errors.ts";

// Endpoints that are NOT billable (free)
const NON_BILLABLE_ENDPOINTS = [
  '/healthz',
  '/health',
  '/docs',
  '/openapi',
  '/auth',
  '/demo',
  '/_shared',
];

// Minimum token balance required to make API calls
const MINIMUM_TOKEN_BALANCE = 5000;

// Tokens consumed per API call
const TOKENS_PER_CALL = 1;

export interface TokenCheckResult {
  allowed: boolean;
  currentBalance: number;
  minimumRequired: number;
  tokensToCharge: number;
  isBillable: boolean;
}

export interface TokenBurnResult {
  success: boolean;
  newBalance: number;
  ledgerEntryId: string;
}

/**
 * Check if an endpoint is billable
 */
export function isBillableEndpoint(endpoint: string): boolean {
  const normalizedEndpoint = endpoint.toLowerCase();
  
  // Check if endpoint starts with any non-billable prefix
  for (const nonBillable of NON_BILLABLE_ENDPOINTS) {
    if (normalizedEndpoint.startsWith(nonBillable.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if an organization has sufficient token balance
 */
export async function checkTokenBalance(
  supabase: SupabaseClient,
  orgId: string,
  endpoint: string
): Promise<TokenCheckResult> {
  const billable = isBillableEndpoint(endpoint);
  
  if (!billable) {
    return {
      allowed: true,
      currentBalance: 0,
      minimumRequired: 0,
      tokensToCharge: 0,
      isBillable: false,
    };
  }
  
  // Get current token balance
  const { data: balance, error } = await supabase
    .from("token_balances")
    .select("balance, minimum_required")
    .eq("org_id", orgId)
    .maybeSingle();
  
  if (error) {
    console.error("Error checking token balance:", error);
    throw new ApiException(
      "TOKEN_CHECK_FAILED",
      "Failed to check token balance",
      500
    );
  }
  
  // If no balance record exists, create one with default values
  if (!balance) {
    const { data: newBalance, error: insertError } = await supabase
      .from("token_balances")
      .insert({
        org_id: orgId,
        balance: 10000,
        minimum_required: MINIMUM_TOKEN_BALANCE,
      })
      .select("balance, minimum_required")
      .single();
    
    if (insertError) {
      console.error("Error creating token balance:", insertError);
      throw new ApiException(
        "TOKEN_INIT_FAILED",
        "Failed to initialize token balance",
        500
      );
    }
    
    return {
      allowed: true,
      currentBalance: newBalance.balance,
      minimumRequired: newBalance.minimum_required,
      tokensToCharge: TOKENS_PER_CALL,
      isBillable: true,
    };
  }
  
  const currentBalance = balance.balance;
  const minimumRequired = balance.minimum_required || MINIMUM_TOKEN_BALANCE;
  
  // Check if balance is sufficient
  const allowed = currentBalance >= minimumRequired;
  
  return {
    allowed,
    currentBalance,
    minimumRequired,
    tokensToCharge: TOKENS_PER_CALL,
    isBillable: true,
  };
}

/**
 * Burn tokens for an API call and record in ledger
 */
export async function burnTokens(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  requestId: string,
  outcome: "allowed" | "blocked",
  metadata?: Record<string, unknown>
): Promise<TokenBurnResult> {
  const billable = isBillableEndpoint(endpoint);
  
  if (!billable) {
    return {
      success: true,
      newBalance: 0,
      ledgerEntryId: "",
    };
  }
  
  const tokensToBurn = outcome === "allowed" ? TOKENS_PER_CALL : 0;
  
  // Start a transaction-like operation
  // First, get and update the balance
  let newBalance = 0;
  
  if (tokensToBurn > 0) {
    // Fetch current balance
    const { data: currentBalance } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    
    if (currentBalance) {
      newBalance = Math.max(0, currentBalance.balance - tokensToBurn);
      
      // Update balance
      const { error: updateError } = await supabase
        .from("token_balances")
        .update({ balance: newBalance })
        .eq("org_id", orgId);
      
      if (updateError) {
        console.error("Error burning tokens:", updateError);
        throw new ApiException(
          "TOKEN_BURN_FAILED",
          "Failed to burn tokens",
          500
        );
      }
    }
  } else {
    // Just get the current balance for the ledger entry
    const { data: currentBalance } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    
    newBalance = currentBalance?.balance || 0;
  }
  
  // Record in ledger (append-only)
  const { data: ledgerEntry, error: ledgerError } = await supabase
    .from("token_ledger")
    .insert({
      org_id: orgId,
      api_key_id: apiKeyId,
      endpoint,
      tokens_burned: tokensToBurn,
      outcome,
      remaining_balance: newBalance,
      request_id: requestId,
      metadata: metadata || {},
    })
    .select("id")
    .single();
  
  if (ledgerError) {
    console.error("Error recording token ledger entry:", ledgerError);
    // Don't fail the request if ledger write fails, but log it
  }
  
  return {
    success: true,
    newBalance,
    ledgerEntryId: ledgerEntry?.id || "",
  };
}

/**
 * Middleware function to check and burn tokens
 * Returns true if the request should proceed, throws if blocked
 */
export async function enforceTokenMetering(
  supabase: SupabaseClient,
  orgId: string,
  apiKeyId: string | null,
  endpoint: string,
  requestId: string
): Promise<void> {
  // Check if endpoint is billable
  if (!isBillableEndpoint(endpoint)) {
    return; // Non-billable endpoints pass through
  }
  
  // Check token balance
  const checkResult = await checkTokenBalance(supabase, orgId, endpoint);
  
  if (!checkResult.allowed) {
    // Record blocked attempt in ledger
    await burnTokens(supabase, orgId, apiKeyId, endpoint, requestId, "blocked", {
      reason: "insufficient_balance",
      required: checkResult.minimumRequired,
      current: checkResult.currentBalance,
    });
    
    throw new ApiException(
      "INSUFFICIENT_TOKEN_BALANCE",
      `Token balance below minimum required threshold (${checkResult.currentBalance}/${checkResult.minimumRequired}). Top up to continue.`,
      402,
      {
        currentBalance: checkResult.currentBalance,
        minimumRequired: checkResult.minimumRequired,
        topUpRequired: checkResult.minimumRequired - checkResult.currentBalance,
      }
    );
  }
  
  // Burn tokens for allowed request
  await burnTokens(supabase, orgId, apiKeyId, endpoint, requestId, "allowed");
}

/**
 * Get token usage statistics for an organization
 */
export async function getTokenUsageStats(
  supabase: SupabaseClient,
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<{
  currentBalance: number;
  minimumRequired: number;
  totalBurnedThisMonth: number;
  callsThisMonth: number;
  blockedCallsThisMonth: number;
}> {
  // Get current balance
  const { data: balance } = await supabase
    .from("token_balances")
    .select("balance, minimum_required")
    .eq("org_id", orgId)
    .maybeSingle();
  
  // Calculate date range for this month if not provided
  const now = new Date();
  const monthStart = startDate || new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  // Get usage stats from ledger
  const { data: ledgerStats, error } = await supabase
    .from("token_ledger")
    .select("tokens_burned, outcome")
    .eq("org_id", orgId)
    .gte("created_at", monthStart.toISOString())
    .lte("created_at", monthEnd.toISOString());
  
  if (error) {
    console.error("Error fetching token usage stats:", error);
  }
  
  const stats = ledgerStats || [];
  const totalBurned = stats.reduce((sum, entry) => sum + (entry.tokens_burned || 0), 0);
  const allowedCalls = stats.filter(entry => entry.outcome === "allowed").length;
  const blockedCalls = stats.filter(entry => entry.outcome === "blocked").length;
  
  return {
    currentBalance: balance?.balance || 0,
    minimumRequired: balance?.minimum_required || MINIMUM_TOKEN_BALANCE,
    totalBurnedThisMonth: totalBurned,
    callsThisMonth: allowedCalls,
    blockedCallsThisMonth: blockedCalls,
  };
}
