import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";

/**
 * Transaction Reconciliation Job
 * 
 * Handles edge-case failures where both Paystack webhooks AND client-side
 * verification fail simultaneously. Scans for:
 * 
 * 1. Token purchases with 'pending' status older than 30 minutes
 *    - Re-verifies with Paystack API
 *    - Credits tokens if payment was successful but webhook missed
 *    - Marks as failed if payment was not completed
 * 
 * 2. Transactional emails stuck in 'queued' state for > 1 hour
 *    - Marks as failed for retry or manual review
 * 
 * Designed to run as a scheduled cron job (e.g., every 15 minutes).
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    // ── Auth: internal cron key required ──
    const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    if (!cronKey || providedKey !== cronKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    const adminClient = createClient(supabaseUrl, serviceKey);

    const results = {
      payments_checked: 0,
      payments_reconciled: 0,
      payments_failed: 0,
      emails_checked: 0,
      emails_marked_failed: 0,
      errors: [] as string[],
    };

    // --- 1. Reconcile stale Paystack payments ---
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const { data: stalePurchases, error: purchaseError } = await adminClient
      .from("token_purchases")
      .select("*")
      .eq("status", "pending")
      .lt("created_at", thirtyMinutesAgo)
      .limit(50);

    if (purchaseError) {
      results.errors.push(`Fetch pending purchases: ${purchaseError.message}`);
    } else if (stalePurchases && stalePurchases.length > 0 && paystackKey) {
      for (const purchase of stalePurchases) {
        results.payments_checked++;

        try {
          // Verify payment status with Paystack
          const verifyResp = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(purchase.paystack_reference)}`,
            {
              headers: { Authorization: `Bearer ${paystackKey}` },
            }
          );

          if (!verifyResp.ok) {
            results.errors.push(`Paystack verify failed for ${purchase.id}: HTTP ${verifyResp.status}`);
            continue;
          }

          const verifyData = await verifyResp.json();
          const txStatus = verifyData?.data?.status;

          if (txStatus === "success") {
            // Payment succeeded but webhook missed - credit tokens
            const creditResult = await adminClient.rpc("atomic_token_credit", {
              p_org_id: purchase.org_id,
              p_amount: purchase.token_amount,
              p_reason: "reconciliation_credit",
              p_reference_id: purchase.id,
            });

            if (creditResult.error) {
              results.errors.push(`Token credit failed for ${purchase.id}: ${creditResult.error.message}`);
            } else {
              // Mark purchase as completed
              await adminClient
                .from("token_purchases")
                .update({ status: "completed", updated_at: new Date().toISOString() })
                .eq("id", purchase.id);

              results.payments_reconciled++;
            }
          } else if (txStatus === "failed" || txStatus === "abandoned") {
            // Payment definitively failed
            await adminClient
              .from("token_purchases")
              .update({ status: "failed", updated_at: new Date().toISOString() })
              .eq("id", purchase.id);

            results.payments_failed++;
          }
          // If still "pending" at Paystack, leave it for the next run
        } catch (err) {
          results.errors.push(`Reconcile ${purchase.id}: ${(err as Error).message}`);
        }
      }
    } else if (!paystackKey) {
      results.errors.push("PAYSTACK_SECRET_KEY not configured - skipping payment reconciliation");
    }

    // --- 2. Reconcile stale email queue entries ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: staleEmails, error: emailError } = await adminClient
      .from("email_send_log")
      .select("id, template_name, recipient_email")
      .eq("status", "queued")
      .lt("created_at", oneHourAgo)
      .limit(100);

    if (emailError) {
      results.errors.push(`Fetch stale emails: ${emailError.message}`);
    } else if (staleEmails && staleEmails.length > 0) {
      results.emails_checked = staleEmails.length;

      const staleIds = staleEmails.map((e) => e.id);
      const { error: updateError } = await adminClient
        .from("email_send_log")
        .update({ status: "failed", error_message: "Reconciliation: stuck in queue > 1 hour" })
        .in("id", staleIds);

      if (updateError) {
        results.errors.push(`Mark stale emails failed: ${updateError.message}`);
      } else {
        results.emails_marked_failed = staleIds.length;
      }
    }

    // --- 3. Audit log ---
    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: "00000000-0000-0000-0000-000000000000",
      action: "transaction.reconciliation",
      target_type: "system",
      details: {
        request_id: requestId,
        ...results,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      request_id: requestId,
      ...results,
    }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${requestId}] Reconciliation error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
