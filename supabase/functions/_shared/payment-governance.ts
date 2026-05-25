/**
 * payment-governance — Phase 2 wiring helper for Paystack webhook exception
 * paths (charge.failed, refund.processed, refund.rejected, refund.partial,
 * dispute.create, dispute.resolve, chargeback.won, chargeback.lost).
 *
 * Why a dedicated helper:
 *   - All paths emit the same canonical event name (payment.event_created)
 *     with a stable, provider-id-based idempotency key.
 *   - Webhook safety: Paystack treats non-2xx as failure → retries → the
 *     outer `webhook_replay_guard` will return 200/idempotent on retry,
 *     which means a thrown governance error on the second attempt simply
 *     never re-runs. So we cannot make webhook governance writes
 *     *atomically* fail-closed; instead we record the failure into
 *     `admin_risk_items` and `audit_logs` so HQ can reconcile manually.
 *   - The handler keeps a single shape so the audit footprint is uniform.
 *
 * Idempotency:
 *   Stable key derived from `payment_reference + event_subtype + provider_id`
 *   so retries within the writer's 5-minute window dedupe at the writer
 *   layer. The outer replay guard already dedupes the webhook delivery, so
 *   this is a defence-in-depth.
 */
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "./governance-audit-integration.ts";
import { PAYMENT_POLICY_VERSION } from "./governance-policy-versions.ts";

export type PaymentEventSubtype =
  | "charge.success"
  | "charge.failed"
  | "refund.processed"
  | "refund.rejected"
  | "refund.partial"
  | "dispute.create"
  | "dispute.resolve"
  | "chargeback.won"
  | "chargeback.lost";

export interface RecordPaymentGovernanceInput {
  /** Paystack-provided dotted subtype, e.g. "charge.failed". */
  event_subtype: PaymentEventSubtype;
  /** Stable payment reference. Required. */
  payment_reference: string;
  /** Provider event id (Paystack event id / dispute id / refund id). */
  provider_event_id?: string | number | null;
  /** Provider event timestamp (ISO or unix). Optional fallback for idempotency. */
  provider_event_ts?: string | number | null;

  /** Org the payment is attributed to. May be null if unattributed. */
  org_id?: string | null;
  /** Acting user, when any (almost always null for webhook). */
  actor_user_id?: string | null;
  /** e.g. "paystack-webhook". */
  system_actor?: string | null;
  /** Calling edge function path. */
  source_function: string;
  /** Inbound x-request-id when threaded through. */
  request_id?: string | null;

  /** Optional links. */
  match_id?: string | null;
  poi_id?: string | null;
  engagement_id?: string | null;

  /** Amount in major units (USD), safe to record. */
  amount?: number | null;
  /** ISO currency code, defaults to USD. */
  currency?: string | null;
  /** Payment status as understood by us, e.g. "failed" / "refunded" / "lost". */
  payment_status?: string | null;
  /** Policy version, if known. Pass null explicitly if not known. */
  policy_version?: string | null;
  /** Allowed/blocked summary for the canonical record. */
  allowed_or_blocked?: "allowed" | "blocked" | "neutral";
  /** Free-form reason code, controlled vocabulary. */
  reason_code?: string;
  /** Additional sanitized metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Best-effort canonical write for a Paystack webhook exception path.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, error }` on failure.
 * Callers MUST NOT throw on a failed governance write inside the webhook
 * (would otherwise be silently swallowed by the replay guard on retry).
 * The caller is responsible for opening an `admin_risk_items` row on
 * failure so HQ can reconcile.
 */
// deno-lint-ignore no-explicit-any
export async function recordPaymentGovernanceEventBestEffort(
  admin: any,
  input: RecordPaymentGovernanceInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.payment_reference || !input.event_subtype) {
    return { ok: false, error: "missing payment_reference or event_subtype" };
  }
  const orgId = input.org_id ?? null;
  // event_store.org_id is NOT NULL — we cannot write canonical proof for
  // unattributed events. Caller should log + risk-item these separately.
  if (!orgId) {
    return { ok: false, error: "org_id missing — unattributed payment event cannot be canonicalised" };
  }
  const idemExtra = [
    input.event_subtype,
    input.provider_event_id != null ? String(input.provider_event_id) : "",
    input.provider_event_ts != null ? String(input.provider_event_ts) : "",
  ].filter(Boolean).join(":");
  try {
    await writeCriticalEventWithPosture(admin, {
      event_type: "payment.event_created",
      org_id: orgId,
      aggregate_type: "payment",
      aggregate_id: input.payment_reference,
      actor_user_id: input.actor_user_id ?? null,
      actor_role: input.actor_user_id ? "billing_user" : "system",
      system_actor: input.actor_user_id ? null : (input.system_actor ?? "paystack-webhook"),
      source_function: input.source_function,
      request_id: input.request_id ?? null,
      payment_reference: input.payment_reference,
      match_id: input.match_id ?? null,
      poi_id: input.poi_id ?? null,
      engagement_id: input.engagement_id ?? null,
      allowed_or_blocked: input.allowed_or_blocked ?? "neutral",
      reason_code: input.reason_code ?? input.event_subtype,
      posture: buildPostureSnapshot("Standard", {
        policy_version: input.policy_version ?? null,
        check_status: {
          paystack_event: input.event_subtype,
          payment_status: input.payment_status ?? null,
        },
      }),
      metadata: {
        event_subtype: input.event_subtype,
        payment_status: input.payment_status ?? null,
        amount: input.amount ?? null,
        currency: input.currency ?? "USD",
        policy_version: input.policy_version ?? null,
        provider_event_id: input.provider_event_id ?? null,
        provider_event_ts: input.provider_event_ts ?? null,
        ...(input.metadata ?? {}),
      },
      idempotency_extra: idemExtra,
    });
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Convenience: best-effort write + automatic admin_risk_items escalation
 * on failure. Never throws.
 */
// deno-lint-ignore no-explicit-any
export async function recordPaymentGovernanceOrEscalate(
  admin: any,
  input: RecordPaymentGovernanceInput,
): Promise<void> {
  const res = await recordPaymentGovernanceEventBestEffort(admin, input);
  if (res.ok) return;
  try {
    await admin.from("admin_risk_items").insert({
      title: `Governance proof missing for ${input.event_subtype}: ${input.payment_reference}`,
      description:
        `Canonical payment.event_created could not be written for ${input.event_subtype} ` +
        `(payment_reference=${input.payment_reference}, provider_event_id=${input.provider_event_id ?? "—"}). ` +
        `Reason: ${res.error}. Business action was already applied by the webhook handler ` +
        `(see ${input.source_function}). HQ must reconcile via event_store backfill before WaD/finality on any ` +
        `match linked to this payment.`,
      severity: "high",
      status: "open",
    });
    await admin.from("audit_logs").insert({
      org_id: input.org_id ?? null,
      action: "billing.governance_write_failed",
      entity_type: "payment",
      metadata: {
        event_subtype: input.event_subtype,
        payment_reference: input.payment_reference,
        provider_event_id: input.provider_event_id ?? null,
        source_function: input.source_function,
        error: res.error,
      },
    });
  } catch (escalateErr) {
    console.error("[payment-governance] escalation failed (best-effort):", escalateErr);
  }
}
