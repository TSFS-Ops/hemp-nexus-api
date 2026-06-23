import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse } from "../_shared/errors.ts";
import {
  providerFetch,
  ProviderFetchTimeoutError,
  ProviderFetchNetworkError,
} from "../_shared/provider-fetch.ts";
import { emitRevenueNotification } from "../_shared/revenue-notify.ts";

// --- Inconclusive-failure tracking ---------------------------------
// Opens a deduped admin_risk_items row only after the SAME provider
// reference has produced 3 repeated reconciliation failures (network,
// timeout, non-OK, invalid JSON). Until the threshold is reached the
// row is kept in a "monitoring" phase (status='resolved' so it does
// not light up the admin queue). Auto-resolves when the purchase is
// later credited, definitively failed, or no longer pending.
//
// Provider-agnostic by design: dedup_key namespacing is
// `payment_inconclusive:<provider_reference>` so PayFast can reuse
// the same surface unchanged.
const INCONCLUSIVE_OPEN_THRESHOLD = 3;
const INCONCLUSIVE_KIND = "payment_provider_inconclusive";

// deno-lint-ignore no-explicit-any
async function trackInconclusiveFailure(adminClient: any, params: {
  providerReference: string;
  purchaseId: string;
  orgId: string | null;
  reason: string;
}): Promise<{ failure_count: number; opened: boolean }> {
  const dedup = `payment_inconclusive:${params.providerReference}`;
  const { data: existing } = await adminClient
    .from("admin_risk_items")
    .select("id, metadata, status, severity")
    .eq("dedup_key", dedup)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (!existing) {
    await adminClient.from("admin_risk_items").insert({
      kind: INCONCLUSIVE_KIND,
      dedup_key: dedup,
      title: `Payment provider verify inconclusive: ${params.providerReference}`,
      description:
        `Reconciliation observed an inconclusive provider response (${params.reason}) for purchase ${params.purchaseId}. ` +
        `Tracking; will escalate to status='open' after ${INCONCLUSIVE_OPEN_THRESHOLD} repeated failures.`,
      severity: "low",
      status: "resolved", // monitoring phase, NOT yet escalated
      org_id: params.orgId,
      metadata: {
        phase: "monitoring",
        failure_count: 1,
        provider_reference: params.providerReference,
        purchase_id: params.purchaseId,
        last_reason: params.reason,
        first_failure_at: nowIso,
        last_failure_at: nowIso,
      },
    });
    return { failure_count: 1, opened: false };
  }

  const prevMeta = (existing.metadata ?? {}) as Record<string, unknown>;
  const prevCount = Number(prevMeta.failure_count ?? 0);
  const failure_count = prevCount + 1;
  const opened = failure_count >= INCONCLUSIVE_OPEN_THRESHOLD;
  const phase = opened ? "active" : "monitoring";
  await adminClient
    .from("admin_risk_items")
    .update({
      status: opened ? "open" : existing.status,
      severity: opened ? "medium" : existing.severity,
      title: opened
        ? `Payment provider verify repeatedly inconclusive: ${params.providerReference}`
        : `Payment provider verify inconclusive: ${params.providerReference}`,
      metadata: {
        ...prevMeta,
        phase,
        failure_count,
        last_reason: params.reason,
        last_failure_at: nowIso,
        ...(opened && !prevMeta.escalated_at ? { escalated_at: nowIso } : {}),
      },
      updated_at: nowIso,
    })
    .eq("id", existing.id);
  return { failure_count, opened };
}

// deno-lint-ignore no-explicit-any
async function resolveInconclusive(adminClient: any, params: {
  providerReference: string;
  resolutionReason: string;
}): Promise<boolean> {
  const dedup = `payment_inconclusive:${params.providerReference}`;
  const { data: existing } = await adminClient
    .from("admin_risk_items")
    .select("id, metadata, status")
    .eq("dedup_key", dedup)
    .maybeSingle();
  if (!existing) return false;
  const prevMeta = (existing.metadata ?? {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  await adminClient
    .from("admin_risk_items")
    .update({
      status: "resolved",
      resolved_at: nowIso,
      metadata: {
        ...prevMeta,
        phase: "resolved",
        resolution_reason: params.resolutionReason,
        resolved_at: nowIso,
      },
      updated_at: nowIso,
    })
    .eq("id", existing.id);
  return true;
}


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
      payments_left_pending_inconclusive: 0,
      inconclusive_risk_items_opened: 0,
      inconclusive_risk_items_resolved: 0,
      emails_checked: 0,
      emails_marked_failed: 0,
      skeletal_paid_credit_promoted: 0,
      skeletal_paid_credit_error: null as string | null,
      refund_settlement_pending_opened: 0,
      refund_settlement_pending_resolved: 0,
      refund_settlement_error: null as string | null,
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
          // Provider-agnostic, bounded-timeout fetch. A timeout / network
          // failure / non-OK / invalid JSON is inconclusive — the purchase
          // stays pending and a deduped admin_risk_items row is tracked.
          let verifyResp: Response;
          try {
            verifyResp = await providerFetch(
              `https://api.paystack.co/transaction/verify/${encodeURIComponent(purchase.paystack_reference)}`,
              { headers: { Authorization: `Bearer ${paystackKey}` } },
              { providerName: "paystack", timeoutMs: 8000 },
            );
          } catch (netErr) {
            const isTimeout = netErr instanceof ProviderFetchTimeoutError;
            const reason = isTimeout
              ? "paystack_verify_timeout"
              : netErr instanceof ProviderFetchNetworkError
                ? "paystack_verify_network_error"
                : "paystack_verify_transport_error";
            results.errors.push(`Paystack verify ${isTimeout ? "timeout" : "network"} for ${purchase.id}: ${(netErr as Error).message}`);
            results.payments_left_pending_inconclusive++;
            if (!dryRun) {
              const track = await trackInconclusiveFailure(adminClient, {
                providerReference: purchase.paystack_reference,
                purchaseId: purchase.id,
                orgId: purchase.org_id ?? null,
                reason,
              });
              if (track.opened) results.inconclusive_risk_items_opened++;
            }
            results.records.push({
              record_type: "token_purchase",
              before,
              after: before,
              action: "left_pending_inconclusive",
              reason,
              dry_run: dryRun,
            });
            continue;
          }
          if (!verifyResp.ok) {
            const reason = `paystack_verify_http_${verifyResp.status}`;
            results.errors.push(`Paystack verify failed for ${purchase.id}: HTTP ${verifyResp.status}`);
            results.payments_left_pending_inconclusive++;
            if (!dryRun) {
              const track = await trackInconclusiveFailure(adminClient, {
                providerReference: purchase.paystack_reference,
                purchaseId: purchase.id,
                orgId: purchase.org_id ?? null,
                reason,
              });
              if (track.opened) results.inconclusive_risk_items_opened++;
            }
            // Consume response body to avoid resource leak in Deno.
            try { await verifyResp.text(); } catch { /* ignore */ }
            results.records.push({
              record_type: "token_purchase",
              before,
              after: before,
              action: "left_pending_inconclusive",
              reason,
              dry_run: dryRun,
            });
            continue;
          }
          let verifyData: {
            data?: {
              status?: string;
              amount?: number;
              currency?: string;
              paid_at?: string;
              customer?: { email?: string };
              metadata?: Record<string, unknown>;
            };
          };
          try {
            verifyData = await verifyResp.json();
          } catch (parseErr) {
            const reason = "paystack_verify_invalid_json";
            results.errors.push(`Paystack verify invalid JSON for ${purchase.id}: ${(parseErr as Error).message}`);
            results.payments_left_pending_inconclusive++;
            if (!dryRun) {
              const track = await trackInconclusiveFailure(adminClient, {
                providerReference: purchase.paystack_reference,
                purchaseId: purchase.id,
                orgId: purchase.org_id ?? null,
                reason,
              });
              if (track.opened) results.inconclusive_risk_items_opened++;
            }
            results.records.push({
              record_type: "token_purchase",
              before,
              after: before,
              action: "left_pending_inconclusive",
              reason,
              dry_run: dryRun,
            });
            continue;
          }
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
            // Canonical paid-credit settlement. Uses the provider reference
            // as `p_reference_id` so it is idempotent against the webhook
            // path (both routes target the same partial UNIQUE index on
            // token_ledger.request_id). Produces a canonical
            // `credit_purchase` ledger row — never an ambient `credit` row.
            const creditResult = await adminClient.rpc("atomic_paid_credit_purchase", {
              p_org_id: purchase.org_id,
              p_amount: purchase.token_amount,
              p_reference_id: purchase.paystack_reference,
              p_endpoint: "payment:paystack:reconciliation",
              p_metadata: {
                payment_reference: purchase.paystack_reference,
                provider_reference: purchase.paystack_reference,
                purchase_id: purchase.id,
                reconciled_at: new Date().toISOString(),
                source: "transaction-reconciliation",
              },
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
              // Auto-resolve any inconclusive risk item for this reference.
              const resolved = await resolveInconclusive(adminClient, {
                providerReference: purchase.paystack_reference,
                resolutionReason: "purchase_completed",
              });
              if (resolved) results.inconclusive_risk_items_resolved++;
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
            // Auto-resolve any inconclusive risk item — provider has now
            // definitively declared failure.
            const resolved = await resolveInconclusive(adminClient, {
              providerReference: purchase.paystack_reference,
              resolutionReason: "provider_definitive_failure",
            });
            if (resolved) results.inconclusive_risk_items_resolved++;
            results.records.push({
              record_type: "token_purchase",
              before,
              after: plannedAfter,
              action: "marked_failed",
              dry_run: false,
            });
          } else {
            // Non-definitive provider status (pending/ongoing/processing/queued/unknown).
            // Leave purchase pending; do NOT count as inconclusive transport
            // failure (provider answered, just not finally).
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

    // --- 3. Skeletal paid-credit ledger row repair (bounded, idempotent) ---
    // Calls public.repair_skeletal_paid_credit which promotes any
    // token_ledger row left at action_type='credit' whose request_id
    // matches a real token_purchases.paystack_reference and is older
    // than 15 minutes. Balance is NOT touched. Safe to run every tick.
    if (!dryRun) {
      const { data: repaired, error: repairErr } = await adminClient.rpc(
        "repair_skeletal_paid_credit",
        { p_min_age_minutes: 15, p_limit: 100 },
      );
      if (repairErr) {
        results.skeletal_paid_credit_error = repairErr.message;
        results.errors.push(`Skeletal paid-credit repair: ${repairErr.message}`);
      } else if (Array.isArray(repaired)) {
        results.skeletal_paid_credit_promoted = repaired.length;
        for (const r of repaired) {
          results.records.push({
            record_type: "token_ledger_skeletal_paid_credit",
            action: "promoted",
            ledger_id: (r as { ledger_id?: string }).ledger_id,
            reference: (r as { reference?: string }).reference,
            dry_run: false,
          });
        }
      }
    }

    // --- 4. Approved refunds awaiting provider settlement (>24h) ---------
    // Calls public.surface_unsettled_refunds which opens one deduped
    // admin_risk_items row per stale refund and auto-resolves items whose
    // refund is no longer not_submitted. Does not move money, does not
    // call Paystack/PayFast, does not touch balances or ledger rows.
    if (!dryRun) {
      const { data: refundSettle, error: refundSettleErr } = await adminClient.rpc(
        "surface_unsettled_refunds",
        { p_min_age_minutes: 1440, p_limit: 100 },
      );
      if (refundSettleErr) {
        results.refund_settlement_error = refundSettleErr.message;
        results.errors.push(`Refund settlement sweep: ${refundSettleErr.message}`);
      } else if (refundSettle && typeof refundSettle === "object") {
        const r = refundSettle as { opened?: number; resolved?: number };
        results.refund_settlement_pending_opened = Number(r.opened ?? 0);
        results.refund_settlement_pending_resolved = Number(r.resolved ?? 0);
      }
    }

    // --- 5. Audit log (per-record snapshots + summary) ---
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
