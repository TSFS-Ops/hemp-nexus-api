/**
 * P-5 Batch 4 — Blocker rules (pure).
 *
 * Hard vs soft, override eligibility, safe external labels.
 * All blocker keys and types come from the Stage 1 SSOT.
 */
import {
  P5B4_BLOCKER_KEYS,
  type P5B4BlockerKey,
  type P5B4BlockerStatus,
  type P5B4BlockerType,
  type P5B4RoleKey,
} from "./constants";

export interface P5B4BlockerSpec {
  key: P5B4BlockerKey;
  type: P5B4BlockerType;
  external_safe_label: string;
  can_override: boolean;
  override_by_role: P5B4RoleKey | null;
  override_reason_required: boolean;
}

const SPECS: Record<P5B4BlockerKey, P5B4BlockerSpec> = {
  missing_authority_to_act: {
    key: "missing_authority_to_act",
    type: "hard",
    external_safe_label: "Authority to act required.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  missing_mandatory_kyc_kyb: {
    key: "missing_mandatory_kyc_kyb",
    type: "hard",
    external_safe_label: "Required evidence missing.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  rejected_or_expired_mandatory_evidence: {
    key: "rejected_or_expired_mandatory_evidence",
    type: "hard",
    external_safe_label: "Evidence must be corrected or renewed.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  unresolved_compliance_hold: {
    key: "unresolved_compliance_hold",
    type: "hard",
    external_safe_label: "Compliance review pending.",
    can_override: true,
    override_by_role: "platform_admin",
    override_reason_required: true,
  },
  bank_account_holder_mismatch: {
    key: "bank_account_holder_mismatch",
    type: "hard",
    external_safe_label: "Bank details require review.",
    can_override: true,
    override_by_role: "platform_admin",
    override_reason_required: true,
  },
  ubo_director_unresolved: {
    key: "ubo_director_unresolved",
    type: "hard",
    external_safe_label: "Ownership/control evidence required.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  provider_failed_result: {
    key: "provider_failed_result",
    type: "hard",
    external_safe_label: "External check requires review.",
    can_override: true,
    override_by_role: "platform_admin",
    override_reason_required: true,
  },
  provider_dependent_finality_item: {
    key: "provider_dependent_finality_item",
    type: "hard",
    external_safe_label: "External provider result pending.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  unauthorised_access: {
    key: "unauthorised_access",
    type: "hard",
    external_safe_label: "You do not have permission for this action.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  final_approval_missing: {
    key: "final_approval_missing",
    type: "hard",
    external_safe_label: "Awaiting final approval.",
    can_override: false,
    override_by_role: null,
    override_reason_required: true,
  },
  optional_evidence_missing: {
    key: "optional_evidence_missing",
    type: "soft_warning",
    external_safe_label: "Optional evidence not supplied.",
    can_override: false,
    override_by_role: null,
    override_reason_required: false,
  },
  document_approaching_expiry: {
    key: "document_approaching_expiry",
    type: "soft_warning",
    external_safe_label: "Renewal will be required soon.",
    can_override: false,
    override_by_role: null,
    override_reason_required: false,
  },
  name_address_variation: {
    key: "name_address_variation",
    type: "soft_warning",
    external_safe_label: "Details require confirmation.",
    can_override: false,
    override_by_role: null,
    override_reason_required: false,
  },
  provider_not_live_internal_review: {
    key: "provider_not_live_internal_review",
    type: "soft_warning",
    external_safe_label: "Provider-ready, not live-provider verified.",
    can_override: false,
    override_by_role: null,
    override_reason_required: false,
  },
  overdue_non_critical_task: {
    key: "overdue_non_critical_task",
    type: "soft_warning",
    external_safe_label: "Task overdue.",
    can_override: false,
    override_by_role: null,
    override_reason_required: false,
  },
};

export function getBlockerSpec(key: P5B4BlockerKey): P5B4BlockerSpec {
  return SPECS[key];
}

export function listBlockerSpecs(): readonly P5B4BlockerSpec[] {
  return P5B4_BLOCKER_KEYS.map((k) => SPECS[k]);
}

export interface P5B4BlockerLike {
  key: P5B4BlockerKey;
  type: P5B4BlockerType;
  status: P5B4BlockerStatus;
}

/** Count *open* hard blockers — anything else does not stop progress. */
export function countOpenHardBlockers(blockers: readonly P5B4BlockerLike[]): number {
  return blockers.filter((b) => b.type === "hard" && b.status === "open").length;
}

export function countOpenSoftWarnings(blockers: readonly P5B4BlockerLike[]): number {
  return blockers.filter((b) => b.type === "soft_warning" && b.status === "open").length;
}

export function canOverrideBlocker(
  key: P5B4BlockerKey,
  actorRole: P5B4RoleKey,
  reason: string | null | undefined,
): { allowed: boolean; reason_required: boolean; error?: string } {
  const spec = SPECS[key];
  if (!spec.can_override) return { allowed: false, reason_required: spec.override_reason_required, error: "blocker_not_overridable" };
  if (spec.override_by_role && spec.override_by_role !== actorRole) {
    return { allowed: false, reason_required: spec.override_reason_required, error: "role_not_permitted" };
  }
  if (spec.override_reason_required && (!reason || reason.trim().length < 4)) {
    return { allowed: false, reason_required: true, error: "reason_required" };
  }
  return { allowed: true, reason_required: spec.override_reason_required };
}
