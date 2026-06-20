/**
 * P011 — Counterparty Rating Methodology Visibility (edge SSOT mirror).
 * Mirror of `src/lib/evidence-rating.ts`; kept in sync by
 * `scripts/check-evidence-rating-parity.mjs`.
 */

export const COUNTERPARTY_RATING_METHODOLOGY_VERSION = "1.0";

export type EvidenceRatingBand =
  | "limited_information"
  | "public_source_supported"
  | "admin_reviewed"
  | "verification_complete"
  | "flagged";

export type EvidenceRatingCheckStatus =
  | "completed"
  | "not_run"
  | "pending"
  | "failed"
  | "expired"
  | "stale"
  | "not_applicable";

export const EVIDENCE_RATING_BAND_LABELS: Record<EvidenceRatingBand, string> = {
  limited_information: "Limited Information",
  public_source_supported: "Public-Source Supported",
  admin_reviewed: "Admin-Reviewed",
  verification_complete: "Verification Complete",
  flagged: "Flagged",
};

export const EVIDENCE_RATING_DISCLAIMER =
  "This counterparty rating is an informational signal based only on the checks and data shown below. It is not a guarantee, compliance clearance, bank verification, credit assessment, or confirmation that a trade will complete. Formal Izenzo workflow gates still apply.";

export const EVIDENCE_RATING_FORBIDDEN_WORDS = [
  "safe",
  "trusted",
  "approved",
  "compliant",
  "low risk",
  "high risk",
  "guaranteed",
  "cleared",
  "bank verified",
] as const;

export const EVIDENCE_RATING_OVERRIDE_REASONS = [
  "evidence_corrected",
  "false_positive",
  "new_document_reviewed",
  "expired_check_reviewed",
  "dispute_resolved",
  "admin_block",
  "methodology_exception",
  "data_error",
] as const;
export type EvidenceRatingOverrideReason =
  (typeof EVIDENCE_RATING_OVERRIDE_REASONS)[number];

export const EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH = 30;
export const EVIDENCE_RATING_OVERRIDE_MAX_DAYS_DEFAULT = 90;

export const EVIDENCE_RATING_FRESHNESS_DAYS = {
  public_source: 30,
  sanctions_pep: 7,
  kyb_registry: 365,
  ubo_authority: 365,
  uploaded_evidence: 365,
  admin_review: 90,
} as const;

export const EVIDENCE_RATING_AUDIT_NAMES = [
  "counterparty_rating.rating_calculated",
  "counterparty_rating.rating_refreshed",
  "counterparty_rating.rating_changed",
  "counterparty_rating.rating_marked_stale",
  "counterparty_rating.rating_flag_added",
  "counterparty_rating.rating_flag_removed",
  "counterparty_rating.rating_viewed_by_admin",
  "counterparty_rating.rating_override_applied",
  "counterparty_rating.rating_override_changed",
  "counterparty_rating.rating_override_removed",
  "counterparty_rating.rating_recalculation_failed",
  "counterparty_rating.methodology_version_changed",
] as const;

export const EVIDENCE_RATING_NON_LIVE_PROVIDERS = [
  "cipc",
  "onfido",
  "dow_jones",
  "refinitiv",
] as const;

export interface EvidenceRatingCheck {
  key: string;
  label: string;
  status: EvidenceRatingCheckStatus;
  provider?: string | null;
  is_live_provider?: boolean;
  completed_at?: string | null;
  matched_identifier?: string | null;
}

export interface EvidenceRatingInputs {
  public_source_signals: EvidenceRatingCheck[];
  kyb_registry: EvidenceRatingCheck | null;
  sanctions_pep: EvidenceRatingCheck | null;
  ubo_authority: EvidenceRatingCheck | null;
  documents: EvidenceRatingCheck[];
  admin_review_active: boolean;
  active_negative_signal: boolean;
  has_admin_override: boolean;
  now?: Date;
}

export interface EvidenceRatingResult {
  band: EvidenceRatingBand;
  methodology_version: string;
  supporting_factors: string[];
  missing_inputs: string[];
  stale_inputs: string[];
  workflow_effect: {
    blocks_wad_progression: boolean;
    requires_admin_review: boolean;
  };
}

const DAY_MS = 86_400_000;

function isStale(check: EvidenceRatingCheck | null, days: number, now: Date): boolean {
  if (!check || !check.completed_at) return false;
  const ts = new Date(check.completed_at).getTime();
  return now.getTime() - ts > days * DAY_MS;
}

function isLiveCompleted(
  check: EvidenceRatingCheck | null,
  days: number,
  now: Date,
): boolean {
  if (!check) return false;
  if (check.status !== "completed") return false;
  if (check.is_live_provider !== true) return false;
  if (
    check.provider &&
    EVIDENCE_RATING_NON_LIVE_PROVIDERS.includes(
      check.provider.toLowerCase() as (typeof EVIDENCE_RATING_NON_LIVE_PROVIDERS)[number],
    )
  ) {
    return false;
  }
  return !isStale(check, days, now);
}

export function computeEvidenceRating(input: EvidenceRatingInputs): EvidenceRatingResult {
  const now = input.now ?? new Date();
  const supporting: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  if (input.active_negative_signal) {
    return {
      band: "flagged",
      methodology_version: COUNTERPARTY_RATING_METHODOLOGY_VERSION,
      supporting_factors: ["Active integrity flag requires admin or compliance review"],
      missing_inputs: [],
      stale_inputs: [],
      workflow_effect: { blocks_wad_progression: true, requires_admin_review: true },
    };
  }

  const publicFresh = input.public_source_signals.filter(
    (s) =>
      s.status === "completed" &&
      !isStale(s, EVIDENCE_RATING_FRESHNESS_DAYS.public_source, now),
  );
  const publicStale = input.public_source_signals.filter((s) =>
    isStale(s, EVIDENCE_RATING_FRESHNESS_DAYS.public_source, now),
  );
  for (const p of publicStale) stale.push(`public_source:${p.key}`);
  const identifierMatches = publicFresh.filter((s) => !!s.matched_identifier).length;
  const publicSupported = publicFresh.length >= 2 && identifierMatches >= 1;

  const kybOk = isLiveCompleted(
    input.kyb_registry,
    EVIDENCE_RATING_FRESHNESS_DAYS.kyb_registry,
    now,
  );
  const sancOk = isLiveCompleted(
    input.sanctions_pep,
    EVIDENCE_RATING_FRESHNESS_DAYS.sanctions_pep,
    now,
  );
  const uboOk = isLiveCompleted(
    input.ubo_authority,
    EVIDENCE_RATING_FRESHNESS_DAYS.ubo_authority,
    now,
  );
  const docsOk = input.documents.some(
    (d) =>
      d.status === "completed" &&
      !isStale(d, EVIDENCE_RATING_FRESHNESS_DAYS.uploaded_evidence, now),
  );

  if (!kybOk) missing.push("live_kyb_registry_completed_and_fresh");
  if (!sancOk) missing.push("live_sanctions_pep_completed_and_fresh");
  if (!uboOk) missing.push("ubo_or_authority_completed_and_fresh");
  if (!docsOk) missing.push("approved_evidence_document");

  if (kybOk && sancOk && uboOk && docsOk) {
    supporting.push("Live KYB / company registry check complete and current");
    supporting.push("Live sanctions / PEP screening complete and current");
    supporting.push("UBO / authority check complete and current");
    return {
      band: "verification_complete",
      methodology_version: COUNTERPARTY_RATING_METHODOLOGY_VERSION,
      supporting_factors: supporting.slice(0, 3),
      missing_inputs: [],
      stale_inputs: stale,
      workflow_effect: { blocks_wad_progression: false, requires_admin_review: false },
    };
  }

  if (input.admin_review_active) {
    supporting.push("Internal review outcome recorded by admin / compliance");
    if (publicSupported) supporting.push("At least two approved public-source signals");
    return {
      band: "admin_reviewed",
      methodology_version: COUNTERPARTY_RATING_METHODOLOGY_VERSION,
      supporting_factors: supporting.slice(0, 3),
      missing_inputs: missing,
      stale_inputs: stale,
      workflow_effect: { blocks_wad_progression: false, requires_admin_review: false },
    };
  }

  if (publicSupported) {
    supporting.push(`${publicFresh.length} approved public-source signals support the identity`);
    supporting.push("At least one identifier matched beyond the name");
    return {
      band: "public_source_supported",
      methodology_version: COUNTERPARTY_RATING_METHODOLOGY_VERSION,
      supporting_factors: supporting.slice(0, 3),
      missing_inputs: missing,
      stale_inputs: stale,
      workflow_effect: { blocks_wad_progression: false, requires_admin_review: false },
    };
  }

  missing.unshift("at_least_two_approved_public_source_signals");
  return {
    band: "limited_information",
    methodology_version: COUNTERPARTY_RATING_METHODOLOGY_VERSION,
    supporting_factors: ["Not enough current evidence to support a higher confidence label"],
    missing_inputs: missing,
    stale_inputs: stale,
    workflow_effect: { blocks_wad_progression: false, requires_admin_review: false },
  };
}
