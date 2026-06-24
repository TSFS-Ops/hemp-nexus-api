/**
 * P-5 Batch 2 — Stage 6: Notification / task derivation engine.
 *
 * Pure function. Given an evidence-item snapshot + record context, return the
 * set of notifications / tasks that must be created. Each result carries an
 * `idempotency_key` so repeated cron runs are safe: the SLA monitor / edge
 * caller uses this key as a uniqueness constraint when inserting rows into
 * `p5_batch2_tasks` (Stage 6 migration).
 *
 * Safety rails (enforced here, not optional):
 *   - customer / funder / api-customer audiences ONLY receive `safe_message`
 *     wording. `internal_message` is admin-only and must never be sent to
 *     external surfaces.
 *   - "Suspected fraud / tampering" is rewritten to "Manual review required"
 *     for any non-admin audience.
 *   - Provider-dependent triggers MUST NOT use any forbidden provider wording
 *     (verified / passed / cleared / sanctions clear / bank verified /
 *     provider approved / no adverse result). Each emitted message is
 *     re-validated via `checkP5B2ProviderWording` before being returned.
 *
 * No DB calls, no IO, no implicit clock reads — caller passes `now`.
 */
import { checkP5B2ProviderWording } from "./provider-wording-guard";
import type { P5B2EvidenceStatus, P5B2RejectionReason } from "./constants";

export type P5B2NotificationTrigger =
  | "evidence_requested"
  | "evidence_uploaded"
  | "evidence_accepted"
  | "evidence_accepted_with_warning"
  | "evidence_rejected"
  | "mandatory_evidence_missing"
  | "evidence_expired"
  | "evidence_expiring"
  | "bank_details_changed"
  | "high_risk_ubo_evidence"
  | "provider_dependent_evidence"
  | "suspected_fraud_or_tampering"
  | "replacement_uploaded";

export type P5B2NotificationAudience =
  | "admin"
  | "compliance_owner"
  | "operator"
  | "organisation_user"
  | "counterparty"
  | "funder"
  | "api_user";

export type P5B2NotificationSeverity = "info" | "warning" | "blocker" | "critical_internal";

export interface P5B2NotificationInput {
  trigger: P5B2NotificationTrigger;
  evidence_item_id?: string | null;
  record_id?: string | null;
  organization_id?: string | null;
  /** Used for idempotency bucketing (e.g. ISO date for daily reminders). */
  bucket_token?: string | null;
  /** Days to expiry, supplied for the `evidence_expiring` trigger. */
  days_to_expiry?: number | null;
  /** Rejection reason — internal raw value; mapped to safe wording. */
  rejection_reason?: P5B2RejectionReason | null;
  /** Internal note (admin-only, never sent to non-admin audiences). */
  internal_note?: string | null;
  /** Customer-safe note from the reviewer (already sanitised at source). */
  customer_safe_note?: string | null;
  /** Provider-live flag for the related evidence item. */
  provider_live?: boolean;
  /** Caller "now" — used purely for audit / version stamping. */
  now: string;
}

export interface P5B2NotificationOutput {
  trigger: P5B2NotificationTrigger;
  audience: P5B2NotificationAudience;
  severity: P5B2NotificationSeverity;
  /** Stable idempotency key — used as the unique constraint on insert. */
  idempotency_key: string;
  /** Always safe to render externally. */
  safe_message: string;
  /** Admin-only message; may include internal reasoning. Never sent to
   *  customer / funder / api_user audiences. */
  internal_message: string;
  evidence_item_id: string | null;
  record_id: string | null;
  organization_id: string | null;
  /** Audit reference (`p5b2.notif.<trigger>`) for the immutable audit row. */
  audit_action: string;
  emitted_at: string;
}

/* -------------------------------------------------------------------------- */
/* Safe wording catalogues.                                                   */
/* -------------------------------------------------------------------------- */

const SAFE_REJECTION_WORDING: Record<P5B2RejectionReason, string> = {
  illegible_document: "Document was unclear and needs to be re-supplied.",
  expired_document: "Document has expired and a current copy is required.",
  wrong_document_type: "A different document type is required.",
  missing_page_or_incomplete_file: "Document was incomplete — please re-supply the full file.",
  name_mismatch: "Name on the document does not match our records.",
  company_number_registration_mismatch: "Company/registration number does not match our records.",
  address_mismatch: "Address on the document does not match our records.",
  not_signed_not_dated: "Document is not signed and/or dated.",
  authority_insufficient: "Authority shown is not sufficient for this action.",
  ownership_unclear: "Ownership chain is unclear and needs clarification.",
  bank_account_holder_mismatch: "Bank account holder does not match the party.",
  bank_evidence_stale_or_unofficial: "Bank evidence is out of date or not from an official source.",
  tax_vat_mismatch: "Tax/VAT information does not match our records.",
  unsupported_jurisdiction_or_format: "Jurisdiction or format is not currently supported.",
  translation_or_notarisation_required: "Certified translation or notarisation is required.",
  provider_check_required: "Provider check required before this can be accepted.",
  provider_failed_or_unavailable: "Provider attempt did not complete — manual review will continue.",
  // Externally safe rewrite of suspected_fraud_or_tampering.
  suspected_fraud_or_tampering: "Manual review required.",
  duplicate_document: "Duplicate document — please supply the latest version.",
  other: "Document requires resubmission. See guidance.",
};

const TRIGGER_TO_AUDIT_ACTION: Record<P5B2NotificationTrigger, string> = {
  evidence_requested: "p5b2.notif.evidence_requested",
  evidence_uploaded: "p5b2.notif.evidence_uploaded",
  evidence_accepted: "p5b2.notif.evidence_accepted",
  evidence_accepted_with_warning: "p5b2.notif.evidence_accepted_with_warning",
  evidence_rejected: "p5b2.notif.evidence_rejected",
  mandatory_evidence_missing: "p5b2.notif.mandatory_evidence_missing",
  evidence_expired: "p5b2.notif.evidence_expired",
  evidence_expiring: "p5b2.notif.evidence_expiring",
  bank_details_changed: "p5b2.notif.bank_details_changed",
  high_risk_ubo_evidence: "p5b2.notif.high_risk_ubo_evidence",
  provider_dependent_evidence: "p5b2.notif.provider_dependent_evidence",
  suspected_fraud_or_tampering: "p5b2.notif.suspected_fraud_or_tampering",
  replacement_uploaded: "p5b2.notif.replacement_uploaded",
};

/** Triggers whose primary audience is *internal only*. External notification
 *  for these triggers must be suppressed or rewritten to safe wording. */
const INTERNAL_ONLY_TRIGGERS = new Set<P5B2NotificationTrigger>([
  "high_risk_ubo_evidence",
  "suspected_fraud_or_tampering",
]);

function safeNoteFor(reason: P5B2RejectionReason | null | undefined): string {
  if (!reason) return "Document requires resubmission.";
  return SAFE_REJECTION_WORDING[reason] ?? SAFE_REJECTION_WORDING.other;
}

function bucketTokenOrDefault(input: P5B2NotificationInput): string {
  if (input.bucket_token) return input.bucket_token;
  // Daily bucket by default — keeps reminders idempotent within a day.
  return input.now.slice(0, 10);
}

function makeIdempotencyKey(
  input: P5B2NotificationInput,
  audience: P5B2NotificationAudience,
): string {
  const parts = [
    "p5b2",
    input.trigger,
    audience,
    input.evidence_item_id ?? "no-evi",
    input.record_id ?? "no-rec",
    bucketTokenOrDefault(input),
  ];
  if (input.trigger === "evidence_expiring" && input.days_to_expiry != null) {
    parts.push(`d${input.days_to_expiry}`);
  }
  return parts.join(":");
}

function assertWordingSafe(message: string, providerLive: boolean) {
  const guard = checkP5B2ProviderWording({
    text: message,
    provider_live: providerLive,
    viewer: "counterparty",
  });
  if (!guard.safe) {
    throw new Error(
      `[p5b2 notifications] forbidden provider wording in emitted message: ${guard.matched.join(",")}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Engine.                                                                    */
/* -------------------------------------------------------------------------- */

interface SafeContent {
  safe_message: string;
  internal_message: string;
  severity: P5B2NotificationSeverity;
}

function contentFor(input: P5B2NotificationInput): SafeContent {
  switch (input.trigger) {
    case "evidence_requested":
      return {
        safe_message: "A document is required for your account. Please upload it when ready.",
        internal_message: "Evidence requested from counterparty / subject.",
        severity: "info",
      };
    case "evidence_uploaded":
      return {
        safe_message: "Your document was received and is in review.",
        internal_message: "New evidence uploaded — awaiting review.",
        severity: "info",
      };
    case "evidence_accepted":
      return {
        safe_message: "Your document has been accepted.",
        internal_message: "Evidence accepted by reviewer.",
        severity: "info",
      };
    case "evidence_accepted_with_warning":
      return {
        safe_message:
          input.customer_safe_note?.trim()
            ? `Accepted with notes: ${input.customer_safe_note.trim()}`
            : "Accepted with notes. Please review the guidance.",
        internal_message: "Evidence accepted with warning — note recorded.",
        severity: "warning",
      };
    case "evidence_rejected": {
      const safe = safeNoteFor(input.rejection_reason);
      return {
        safe_message: `Document not accepted: ${safe}`,
        internal_message: `Evidence rejected (${input.rejection_reason ?? "other"}). ${input.internal_note ?? ""}`.trim(),
        severity: "warning",
      };
    }
    case "mandatory_evidence_missing":
      return {
        safe_message: "A required document is still missing. Please upload it to continue.",
        internal_message: "Mandatory evidence missing — finality blocked.",
        severity: "blocker",
      };
    case "evidence_expired":
      return {
        safe_message: "A document on file has expired. Please upload a current copy.",
        internal_message: "Evidence expired — finality blocked if mandatory.",
        severity: "blocker",
      };
    case "evidence_expiring": {
      const d = input.days_to_expiry ?? 0;
      return {
        safe_message: `A document on file will expire in ${d} day${d === 1 ? "" : "s"}. Please upload a current copy soon.`,
        internal_message: `Evidence expiring in ${d}d — reminder bucket.`,
        severity: "info",
      };
    }
    case "bank_details_changed":
      return {
        safe_message:
          "Bank details have been updated. They will be re-checked before any payment.",
        internal_message:
          "Bank details changed — second review required before payment / finality.",
        severity: "blocker",
      };
    case "high_risk_ubo_evidence":
      return {
        // Internal-only; safe message stays neutral if ever surfaced.
        safe_message: "Additional review of ownership information is in progress.",
        internal_message:
          "High-risk / complex UBO chain detected — escalate to compliance owner.",
        severity: "critical_internal",
      };
    case "provider_dependent_evidence":
      return {
        // MUST avoid forbidden provider wording.
        safe_message:
          "An external check is pending for this document. We will continue review manually in the meantime.",
        internal_message:
          "Provider-dependent — provider not live; manual review continues. Do not represent as live/verified.",
        severity: "warning",
      };
    case "suspected_fraud_or_tampering":
      return {
        safe_message: "Manual review required.",
        internal_message:
          "Suspected fraud / tampering — escalate immediately. Do not externalise raw reason.",
        severity: "critical_internal",
      };
    case "replacement_uploaded":
      return {
        safe_message: "A replacement document was received and is in review.",
        internal_message: "Replacement version uploaded — previous version archived.",
        severity: "info",
      };
  }
}

function defaultAudiencesFor(
  trigger: P5B2NotificationTrigger,
): P5B2NotificationAudience[] {
  if (INTERNAL_ONLY_TRIGGERS.has(trigger)) return ["admin", "compliance_owner"];
  switch (trigger) {
    case "evidence_requested":
    case "evidence_uploaded":
    case "evidence_accepted":
    case "evidence_accepted_with_warning":
    case "evidence_rejected":
    case "evidence_expired":
    case "evidence_expiring":
    case "replacement_uploaded":
      return ["organisation_user", "counterparty", "admin"];
    case "mandatory_evidence_missing":
      return ["organisation_user", "counterparty", "admin", "compliance_owner"];
    case "bank_details_changed":
      return ["organisation_user", "admin", "compliance_owner"];
    case "provider_dependent_evidence":
      return ["admin", "operator"];
  }
}

/**
 * Derive notifications for a single trigger event. The caller is responsible
 * for restricting the returned set to viewers it actually wants to deliver
 * to; the engine never strips audiences silently. Each result is fully
 * idempotent — re-running with the same input produces the same keys.
 */
export function deriveP5B2Notifications(
  input: P5B2NotificationInput,
): P5B2NotificationOutput[] {
  const content = contentFor(input);
  const providerLive = input.provider_live ?? false;
  // Re-validate safe wording for provider-dependent and rejection cases.
  assertWordingSafe(content.safe_message, providerLive);
  if (input.trigger === "suspected_fraud_or_tampering") {
    if (content.safe_message !== "Manual review required.") {
      throw new Error("[p5b2 notifications] suspected fraud safe message drift");
    }
  }
  const audiences = defaultAudiencesFor(input.trigger);
  return audiences.map((audience): P5B2NotificationOutput => {
    const internalOnlyAudience = audience === "admin" || audience === "compliance_owner" || audience === "operator";
    return {
      trigger: input.trigger,
      audience,
      severity: content.severity,
      idempotency_key: makeIdempotencyKey(input, audience),
      safe_message: content.safe_message,
      internal_message: internalOnlyAudience
        ? content.internal_message
        : content.safe_message, // external audiences never receive internal text.
      evidence_item_id: input.evidence_item_id ?? null,
      record_id: input.record_id ?? null,
      organization_id: input.organization_id ?? null,
      audit_action: TRIGGER_TO_AUDIT_ACTION[input.trigger],
      emitted_at: input.now,
    };
  });
}

/** Strict external-audience filter — useful for callers wiring this into
 *  the existing `notifications` table or an external delivery channel. */
export function filterExternalP5B2Notifications(
  outputs: P5B2NotificationOutput[],
): P5B2NotificationOutput[] {
  return outputs.filter(
    (o) =>
      o.audience === "organisation_user" ||
      o.audience === "counterparty" ||
      o.audience === "funder" ||
      o.audience === "api_user",
  );
}
