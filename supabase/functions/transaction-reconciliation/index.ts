import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";

/**
 * Transaction Reconciliation Job — Batch V REC-004 / AUD-019 hardened.
 *
 * Handles edge-case failures where both Paystack webhooks AND client-side
 * verification fail simultaneously. Scans for:
 *
 * 1. Token purchases with 'pending' status older than 30 minutes
 * 2. Transactional emails stuck in 'queued' state for > 1 hour
 *
 * Hardening (Batch V):
 *   - Accepts body { dry_run: true } → no mutations, return planned changes
 *   - Per-record before/after snapshots in admin_audit_logs.details.records
 *   - Registered in cron_heartbeats as 'transaction-reconciliation-job'
 *
 * Auth: x-internal-key (cron) OR service_role bearer.
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const cronKey = Deno.env.get("INTERNAL_CRON_KEY");
    const providedKey = req.headers.get("x-internal-key");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const isInternalCron = !!cronKey && providedKey === cronKey;
    const isServiceRole = serviceRole.length > 0 && authHeader === `Bearer ${serviceRole}`;
    if (!isInternalCron && !isServiceRole) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let body: { dry_run?: boolean } = {};
    try {
      const txt = await req.text();
      if (txt.trim().length > 0) body = JSON.parse(txt);
    } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const dryRun = body.dry_run === true;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY");
    const adminClient = createClient(supabaseUrl, serviceRole);

    const results = {
      dry_run: dryRun,
      payments_checked: 0,
      payments_reconciled: 0,
      payments_failed: 0,
      emails_checked: 0,
      emails_marked_failed: 0,
      records: [] as Array<Record<string, unknown>>,
      errors: [] as string[],
    };

    // --- 1. Stale Paystack payments ---
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
        const before = {
          id: purchase.id,
          status: purchase.status,
          org_id: purchase.org_id,
          token_amount: purchase.token_amount,
          paystack_reference: purchase.paystack_reference,
        };
        try {
          const verifyResp = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(purchase.paystack_reference)}`,
            { headers: { Authorization: `Bearer ${paystackKey}` } },
          );
          if (!verifyResp.ok) {
            results.errors.push(`Paystack verify failed for ${purchase.id}: HTTP ${verifyResp.status}`);
            results.records.push({
              record_type: "token_purchase",
              before,
              after: before,
              action: "no_change",
              reason: `paystack_verify_http_${verifyResp.status}`,
              dry_run: dryRun,
            });
            continue;
          }
          const verifyData = await verifyResp.json();
          const txStatus = verifyData?.data?.status;

          if (txStatus === "success") {
            const plannedAfter = { ...before, status: "completed" };
            if (dryRun) {
              results.records.push({
                record_type: "token_purchase",
                before,
                after: plannedAfter,
                action: "would_credit_and_complete",
                dry_run: true,
              });
              results.payments_reconciled++;
              continue;
            }
            const creditResult = await adminClient.rpc("atomic_token_credit", {
              p_org_id: purchase.org_id,
              p_amount: purchase.token_amount,
              p_reason: "reconciliation_credit",
              p_reference_id: purchase.id,
            });
            if (creditResult.error) {
              results.errors.push(`Token credit failed for ${purchase.id}: ${creditResult.error.message}`);
              results.records.push({
                record_type: "token_purchase",
                before,
                after: before,
                action: "credit_failed",
                error: creditResult.error.message,
                dry_run: false,
              });
            } else {
              await adminClient
                .from("token_purchases")
                .update({ status: "completed", updated_at: new Date().toISOString() })
                .eq("id", purchase.id);
              results.payments_reconciled++;
              results.records.push({
                record_type: "token_purchase",
                before,
                after: plannedAfter,
                action: "credited_and_completed",
                dry_run: false,
              });
            }
          } else if (txStatus === "failed" || txStatus === "abandoned") {
            const plannedAfter = { ...before, status: "failed" };
            if (dryRun) {
              results.records.push({
                record_type: "token_purchase",
                before,
                after: plannedAfter,
                action: "would_mark_failed",
                dry_run: true,
              });
              results.payments_failed++;
              continue;
            }
            await adminClient
              .from("token_purchases")
              .update({ status: "failed", updated_at: new Date().toISOString() })
              .eq("id", purchase.id);
            results.payments_failed++;
            results.records.push({
              record_type: "token_purchase",
              before,
              after: plannedAfter,
              action: "marked_failed",
              dry_run: false,
            });
          } else {
            results.records.push({
              record_type: "token_purchase",
              before,
              after: before,
              action: "left_pending",
              paystack_status: txStatus,
              dry_run: dryRun,
            });
          }
        } catch (err) {
          results.errors.push(`Reconcile ${purchase.id}: ${(err as Error).message}`);
        }
      }
    } else if (!paystackKey) {
      results.errors.push("PAYSTACK_SECRET_KEY not configured - skipping payment reconciliation");
    }

    // --- 2. Stale email queue entries ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: staleEmails, error: emailError } = await adminClient
      .from("email_send_log")
      .select("id, template_name, recipient_email, status")
      .eq("status", "queued")
      .lt("created_at", oneHourAgo)
      .limit(100);

    if (emailError) {
      results.errors.push(`Fetch stale emails: ${emailError.message}`);
    } else if (staleEmails && staleEmails.length > 0) {
      results.emails_checked = staleEmails.length;
      for (const em of staleEmails) {
        const before = { id: em.id, status: em.status, template_name: em.template_name };
        const after = { ...before, status: "failed" };
        results.records.push({
          record_type: "email_send_log",
          before,
          after,
          action: dryRun ? "would_mark_failed" : "marked_failed",
          dry_run: dryRun,
        });
      }
      if (!dryRun) {
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
      } else {
        results.emails_marked_failed = staleEmails.length;
      }
    }

    // --- 3. Audit log (per-record snapshots + summary) ---
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
