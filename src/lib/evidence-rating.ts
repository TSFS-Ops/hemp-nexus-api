/**
 * P011 — Counterparty Rating Methodology Visibility (browser SSOT).
 *
 * Mirrored at `supabase/functions/_shared/evidence-rating.ts`.
 * `scripts/check-evidence-rating-parity.mjs` enforces byte-aligned pins.
 *
 * Bands (in display order):
 *   limited_information → public_source_supported → admin_reviewed
 *                       → verification_complete | flagged
 *
 * This is an EVIDENCE-CONFIDENCE signal, not a trust / safety / credit /
 * compliance / bank-verification label.
 */

export const COUNTERPARTY_RATING_METHODOLOGY_VERSION = "1.0";

export type EvidenceRatingBand =
  | "limited_information"
  | "public_source_supported"
  | "admin_reviewed"
  | "verification_complete"
  | "flagged";

export type EvidenceRatingFreshness =
  | "fresh"
  | "stale"
  | "error"
  | "never_calculated";

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

export const EVIDENCE_RATING_BAND_USER_MEANING: Record<EvidenceRatingBand, string> = {
  limited_information:
    "There is not enough current evidence to support a higher confidence label.",
  public_source_supported:
    "Public sources support the counterparty identity, but formal verification is not complete.",
  admin_reviewed:
    "Izenzo has reviewed the available evidence and recorded an internal review outcome.",
  verification_complete:
    "The required live checks for this workflow have completed and are current.",
  flagged:
    "One or more checks, records or reviews require admin attention before progression.",
};

export const EVIDENCE_RATING_DISCLAIMER =
  "This counterparty rating is an informational signal based only on the checks and data shown below. It is not a guarantee, compliance clearance, bank verification, credit assessment, or confirmation that a trade will complete. Formal Izenzo workflow gates still apply.";

/** Words that must NEVER appear in user-facing rating UI / drawer / export. */
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

export const EVIDENCE_RATING_OVERRIDE_REASON_LABELS: Record<
  EvidenceRatingOverrideReason,
  string
> = {
  evidence_corrected: "Evidence corrected",
  false_positive: "False positive",
  new_document_reviewed: "New document reviewed",
  expired_check_reviewed: "Expired check reviewed",
  dispute_resolved: "Dispute resolved",
  admin_block: "Admin block",
  methodology_exception: "Methodology exception",
  data_error: "Data error",
};

export const EVIDENCE_RATING_OVERRIDE_MIN_REASON_LENGTH = 30;
export const EVIDENCE_RATING_OVERRIDE_MAX_DAYS_DEFAULT = 90;

/** Freshness windows (days). */
export const EVIDENCE_RATING_FRESHNESS_DAYS = {
  public_source: 30,
  sanctions_pep: 7,
  kyb_registry: 365,
  ubo_authority: 365,
  uploaded_evidence: 365,
  admin_review: 90,
} as const;

/** Canonical audit event names. */
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

/** Stub providers cannot support verification_complete (mirrors P010 SSOT). */
export const EVIDENCE_RATING_NON_LIVE_PROVIDERS = [
  "cipc",
  "onfido",
  "dow_jones",
  "refinitiv",
] as const;

/** Inputs the engine accepts when computing the rating. */
export interface EvidenceRatingCheck {
  key: string;
  label: string;
  status: EvidenceRatingCheckStatus;
  provider?: string | null;
  is_live_provider?: boolean;
  /** ISO timestamp of when the result was produced. */
  completed_at?: string | null;
  /** Optional matched identifier label (registration number, jurisdiction, ...). */
  matched_identifier?: string | null;
}

export interface EvidenceRatingInputs {
  /** Approved public-source matches (each must name the matched identifier). */
  public_source_signals: EvidenceRatingCheck[];
  kyb_registry: EvidenceRatingCheck | null;
  sanctions_pep: EvidenceRatingCheck | null;
  ubo_authority: EvidenceRatingCheck | null;
  documents: EvidenceRatingCheck[];
  /** True when a platform_admin/compliance_owner recorded a review. */
  admin_review_active: boolean;
  /** True when active sanctions/PEP/adverse-media/admin-block/identifier-mismatch present. */
  active_negative_signal: boolean;
  /** Override row (if any) — drives display only, never used to bypass live-check rules. */
  has_admin_override: boolean;
  /** Now for deterministic tests. */
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

/**
 * Pure, deterministic compute. Used by both the edge function and the test suite.
 * Never throws. Missing data → limited_information unless a negative signal forces flagged.
 */
export function computeEvidenceRating(input: EvidenceRatingInputs): EvidenceRatingResult {
  const now = input.now ?? new Date();
  const supporting: string[] = [];
  const missing: string[] = [];
  const stale: string[] = [];

  // Flagged trumps all.
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

  // Public-source: ≥2 approved matches + ≥1 matched identifier beyond name.
  const publicFresh = input.public_source_signals.filter(
    (s) => s.status === "completed" && !isStale(s, EVIDENCE_RATING_FRESHNESS_DAYS.public_source, now),
  );
  const publicStale = input.public_source_signals.filter((s) =>
    isStale(s, EVIDENCE_RATING_FRESHNESS_DAYS.public_source, now),
  );
  for (const p of publicStale) stale.push(`public_source:${p.key}`);
  const identifierMatches = publicFresh.filter((s) => !!s.matched_identifier).length;
  const publicSupported = publicFresh.length >= 2 && identifierMatches >= 1;

  // Live verification readiness (must be complete + fresh + live-provider).
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

/** True if `text` contains any forbidden word as a whole-word match. */
export function containsForbiddenRatingWord(text: string): string | null {
  const lc = text.toLowerCase();
  for (const word of EVIDENCE_RATING_FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lc)) return word;
  }
  return null;
}
