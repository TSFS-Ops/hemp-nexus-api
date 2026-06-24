/**
 * P-5 Batch 2 — Stage 2: Provider wording guard.
 *
 * Blocks unsafe wording (e.g. "Verified", "Passed", "Cleared") on any
 * surface where `provider_live = false`. The forbidden list is the SSOT from
 * `constants.P5B2_FORBIDDEN_PROVIDER_WORDING`. Safe wording catalogues are
 * provided per viewer type. Pure: no IO.
 */
import { P5B2_FORBIDDEN_PROVIDER_WORDING } from "./constants";
import type { P5B2ProviderStatus } from "./constants";

export type P5B2ViewerType =
  | "admin"
  | "organisation_user"
  | "counterparty"
  | "funder"
  | "api_user";

export interface P5B2WordingGuardInput {
  text: string;
  provider_live: boolean;
  viewer: P5B2ViewerType;
}

export interface P5B2WordingGuardResult {
  safe: boolean;
  matched: string[];
}

const PATTERNS = P5B2_FORBIDDEN_PROVIDER_WORDING.map((phrase) => ({
  phrase,
  // Word-boundary, case-insensitive. Escape spaces in multi-word phrases.
  re: new RegExp(`\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i"),
}));

export function checkP5B2ProviderWording(input: P5B2WordingGuardInput): P5B2WordingGuardResult {
  // Admins can see provider raw status — but the unsafe phrasing is still
  // blocked from being rendered to non-admin surfaces. We keep the same rule
  // for all viewers so a developer cannot accidentally write the phrase into
  // a shared component string.
  if (input.provider_live) {
    return { safe: true, matched: [] };
  }
  const matched: string[] = [];
  for (const { phrase, re } of PATTERNS) {
    if (re.test(input.text)) matched.push(phrase);
  }
  return { safe: matched.length === 0, matched };
}

export interface P5B2SafeWordingEntry {
  status: P5B2ProviderStatus;
  /** Phrase shown to the corresponding viewer. */
  label: string;
}

/** Safe wording catalogues. The same provider status renders different
 * phrasing for admin vs counterparty vs funder vs API user. */
export const P5B2_SAFE_WORDING: Record<P5B2ViewerType, P5B2SafeWordingEntry[]> = {
  admin: [
    { status: "provider_ready_not_live_provider_verified", label: "Provider-ready, not live-provider verified" },
    { status: "provider_credentials_pending", label: "Provider credentials pending" },
    { status: "provider_result_pending", label: "Provider result pending" },
    { status: "provider_unavailable", label: "Provider unavailable" },
    { status: "provider_failed", label: "Provider failed" },
    { status: "manual_review_recorded_not_provider_verified", label: "Manual review recorded — not provider verified" },
  ],
  organisation_user: [
    { status: "provider_ready_not_live_provider_verified", label: "Provider-ready, awaiting live check" },
    { status: "provider_credentials_pending", label: "Provider credentials pending" },
    { status: "provider_result_pending", label: "Provider result pending" },
    { status: "provider_unavailable", label: "Provider unavailable" },
    { status: "provider_failed", label: "Provider attempt did not complete" },
    { status: "manual_review_recorded_not_provider_verified", label: "Manual review recorded — not provider verified" },
  ],
  counterparty: [
    { status: "provider_ready_not_live_provider_verified", label: "Awaiting live provider check" },
    { status: "provider_credentials_pending", label: "Provider setup pending" },
    { status: "provider_result_pending", label: "Provider result pending" },
    { status: "provider_unavailable", label: "Provider unavailable" },
    { status: "provider_failed", label: "Provider attempt did not complete" },
    { status: "manual_review_recorded_not_provider_verified", label: "Manual review recorded — not provider verified" },
  ],
  funder: [
    { status: "provider_ready_not_live_provider_verified", label: "Provider-ready (not provider-verified)" },
    { status: "provider_credentials_pending", label: "Provider credentials pending" },
    { status: "provider_result_pending", label: "Provider result pending" },
    { status: "provider_unavailable", label: "Provider unavailable" },
    { status: "provider_failed", label: "Provider attempt did not complete" },
    { status: "manual_review_recorded_not_provider_verified", label: "Manual review recorded — not provider-verified" },
  ],
  api_user: [
    { status: "provider_ready_not_live_provider_verified", label: "provider_ready_not_live_provider_verified" },
    { status: "provider_credentials_pending", label: "provider_credentials_pending" },
    { status: "provider_result_pending", label: "provider_result_pending" },
    { status: "provider_unavailable", label: "provider_unavailable" },
    { status: "provider_failed", label: "provider_failed" },
    { status: "manual_review_recorded_not_provider_verified", label: "manual_review_recorded_not_provider_verified" },
  ],
};

export function getP5B2SafeProviderLabel(
  viewer: P5B2ViewerType,
  status: P5B2ProviderStatus,
): string {
  const entry = P5B2_SAFE_WORDING[viewer].find((e) => e.status === status);
  return entry?.label ?? status;
}
