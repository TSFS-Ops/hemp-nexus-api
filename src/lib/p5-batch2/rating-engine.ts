/**
 * P-5 Batch 2 — Stage 2: Six-band evidence pre-rating engine.
 *
 * Pure. Returns a pre-rating plus a `human_review_required` flag. The engine
 * MUST never be treated as final approval for material evidence: only a
 * human reviewer can accept mandatory evidence.
 */
import type { P5B2EvidenceRating, P5B2EvidenceStatus } from "./constants";

export interface P5B2RatingInput {
  status: P5B2EvidenceStatus;
  /** 0..1 — fraction of expected metadata fields present. */
  completeness: number;
  /** True if expiry_date is in the past relative to caller-provided `now`. */
  expired: boolean;
  /** True if the document's named party matches the parent record. */
  party_match: boolean;
  /** Optional metadata quality score (0..1). */
  metadata_quality?: number;
  provider_dependency: boolean;
  /** True when the provider produced a real referenced result. */
  provider_live: boolean;
  /** True if this evidence is mandatory for the parent record. */
  is_mandatory: boolean;
}

export interface P5B2RatingResult {
  rating: P5B2EvidenceRating;
  human_review_required: boolean;
  reasons: string[];
}

export function rateP5B2Evidence(input: P5B2RatingInput): P5B2RatingResult {
  const reasons: string[] = [];

  // Rejected, expired and unusable shortcuts.
  if (input.status === "rejected") {
    return { rating: "unusable", human_review_required: true, reasons: ["status_rejected"] };
  }
  if (input.expired || input.status === "expired") {
    return { rating: "unusable", human_review_required: true, reasons: ["expired"] };
  }
  if (input.status === "revoked" || input.status === "replaced") {
    return { rating: "unusable", human_review_required: false, reasons: ["terminal_status"] };
  }
  if (input.status === "suspended_hold") {
    return { rating: "unusable", human_review_required: true, reasons: ["suspended_hold"] };
  }

  // Provider-dependent items without a live result must be quarantined under
  // the provider_dependent rating band, regardless of metadata quality.
  if (input.provider_dependency && !input.provider_live) {
    return {
      rating: "provider_dependent",
      human_review_required: true,
      reasons: ["provider_not_live"],
    };
  }

  if (!input.party_match) reasons.push("party_mismatch");
  if (input.completeness < 0.5) reasons.push("low_completeness");
  if ((input.metadata_quality ?? 1) < 0.5) reasons.push("low_metadata_quality");

  let rating: P5B2EvidenceRating;
  const meta = input.metadata_quality ?? 1;

  if (!input.party_match) {
    rating = "weak";
  } else if (input.completeness >= 0.95 && meta >= 0.9) {
    rating = "strong";
  } else if (input.completeness >= 0.8 && meta >= 0.75) {
    rating = "good";
  } else if (input.completeness >= 0.6) {
    rating = "acceptable";
  } else if (input.completeness >= 0.3) {
    rating = "weak";
  } else {
    rating = "unusable";
  }

  // Any mandatory evidence — even if the auto-pre-rating is strong — must be
  // signed off by a human reviewer before it is treated as accepted.
  const human_review_required =
    input.is_mandatory ||
    rating === "weak" ||
    rating === "unusable" ||
    input.status === "uploaded" ||
    input.status === "under_review" ||
    input.status === "accepted_with_warning";

  return { rating, human_review_required, reasons };
}
