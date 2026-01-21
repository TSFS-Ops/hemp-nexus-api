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

// Low balance warning thresholds
const LOW_BALANCE_THRESHOLDS = [6000, 5500, 5001];

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
  
  // SECURITY: Do not auto-create token balances.
  // Token balances should only be created via the handle_new_user trigger
  // or admin actions. Auto-creation could allow free token exploits.
  if (!balance) {
    console.error("No token balance found for org:", orgId);
    throw new ApiException(
      "TOKEN_NOT_FOUND",
      "Token balance not initialized. Contact support.",
      500
    );
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
  let previousBalance = 0;
  
  if (tokensToBurn > 0) {
    // Fetch current balance
    const { data: currentBalance } = await supabase
      .from("token_balances")
      .select("balance")
      .eq("org_id", orgId)
      .single();
    
    if (currentBalance) {
      previousBalance = currentBalance.balance;
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
      
      // Check if we crossed any low balance thresholds
      await checkAndTriggerLowBalanceWebhooks(supabase, orgId, previousBalance, newBalance);
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
  // Ensure null for empty/invalid apiKeyId to avoid UUID validation errors
  const validApiKeyId = apiKeyId && apiKeyId.length > 0 ? apiKeyId : null;
  
  const { data: ledgerEntry, error: ledgerError } = await supabase
    .from("token_ledger")
    .insert({
      org_id: orgId,
      api_key_id: validApiKeyId,
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
 * Check if balance crossed low thresholds and trigger webhooks
 */
async function checkAndTriggerLowBalanceWebhooks(
  supabase: SupabaseClient,
  orgId: string,
  previousBalance: number,
  newBalance: number
): Promise<void> {
  for (const threshold of LOW_BALANCE_THRESHOLDS) {
    // Check if we just crossed this threshold
    if (previousBalance > threshold && newBalance <= threshold) {
      console.log(`[Token Metering] Balance crossed ${threshold} threshold for org ${orgId}`);
      
      // Trigger low balance webhook
      try {
        // Fetch active webhook endpoints subscribed to token.low_balance event
        const { data: endpoints, error } = await supabase
          .from("webhook_endpoints")
          .select("*")
          .eq("org_id", orgId)
          .eq("status", "active")
          .contains("events", ["token.low_balance"]);
        
        if (error) {
          console.error("Error fetching webhook endpoints for low balance:", error);
          return;
        }
        
        if (!endpoints || endpoints.length === 0) {
          console.log(`No webhooks registered for token.low_balance event`);
          return;
        }
        
        const payload = {
          event: "token.low_balance",
          data: {
            orgId,
            currentBalance: newBalance,
            threshold,
            minimumRequired: MINIMUM_TOKEN_BALANCE,
            warning: getWarningMessage(threshold, newBalance),
            urgency: getUrgencyLevel(newBalance),
          },
          timestamp: new Date().toISOString(),
          orgId,
        };
        
        // Deliver webhooks in background
        for (const endpoint of endpoints) {
          deliverLowBalanceWebhook(supabase, endpoint, payload).catch(err =>
            console.error(`Low balance webhook delivery error:`, err)
          );
        }
      } catch (err) {
        console.error("Error triggering low balance webhooks:", err);
      }
      
      // Only trigger once per crossing (don't trigger for multiple thresholds in same call)
      break;
    }
  }
}

function getWarningMessage(threshold: number, balance: number): string {
  if (balance <= 5001) {
    return "CRITICAL: Token balance is at minimum. API calls will be blocked if balance drops below 5000.";
  }
  if (balance <= 5500) {
    return "WARNING: Token balance is very low. Please top up soon to avoid service interruption.";
  }
  return "NOTICE: Token balance is approaching minimum threshold. Consider topping up.";
}

function getUrgencyLevel(balance: number): "critical" | "warning" | "notice" {
  if (balance <= 5001) return "critical";
  if (balance <= 5500) return "warning";
  return "notice";
}

async function deliverLowBalanceWebhook(
  supabase: SupabaseClient,
  endpoint: { id: string; url: string; secret_hash: string },
  payload: { event: string; data: Record<string, unknown>; timestamp: string; orgId: string }
): Promise<void> {
  const body = JSON.stringify(payload);
  
  // Generate signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(endpoint.secret_hash);
  const messageData = encoder.encode(body);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signatureHex,
        "X-Webhook-Event": payload.event,
        "X-Webhook-Timestamp": payload.timestamp,
      },
      body,
    });
    
    // Log delivery
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: endpoint.id,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: response.status,
      response_body: (await response.text()).substring(0, 1000),
      delivery_attempt: 1,
    });
    
    console.log(`Low balance webhook delivered to ${endpoint.url}: ${response.status}`);
  } catch (err) {
    console.error(`Failed to deliver low balance webhook to ${endpoint.url}:`, err);
    
    // Log failed delivery
    await supabase.from("webhook_deliveries").insert({
      webhook_endpoint_id: endpoint.id,
      org_id: payload.orgId,
      event_type: payload.event,
      payload: payload.data,
      response_status_code: 0,
      error_message: err instanceof Error ? err.message : "Unknown error",
      delivery_attempt: 1,
    });
  }
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
