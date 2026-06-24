/**
 * P-5 Batch 1 — Stage 2 wording guard.
 *
 * Rejects forbidden customer/funder/non-admin-API wording unless the caller
 * explicitly passes the supporting approval conditions. The forbidden /
 * allowed word lists live in `./constants.ts` (Stage 1 SSOT).
 *
 * Usage:
 *   assertCustomerSafeWording("Verified counterparty"); // throws
 *   assertCustomerSafeWording("Internally Ready");      // ok
 *
 * For surfaces that legitimately need a forbidden phrase (admin operator
 * console, internal audit export), pass `{ surface: "admin_internal" }`.
 */
import {
  P5_ALLOWED_WORDS,
  P5_FORBIDDEN_WORDS,
} from "./constants";

export type P5WordingSurface =
  | "customer"
  | "funder"
  | "public_api"
  | "admin_internal";

export interface WordingGuardOptions {
  surface?: P5WordingSurface;
  /**
   * Strict bypass tokens. ALL of the listed conditions must be true to
   * allow specific forbidden phrases — currently:
   *   - "approved_evidence_pack"      (e.g. "Approved evidence pack")
   *   - "provider_result_received"    (real, in-date provider pass result)
   *   - "human_approval_recorded"     (authorised human approval logged)
   *
   * Even with all three present, finality / payment / WaD wording stays
   * forbidden on customer + funder + public_api surfaces.
   */
  supportingConditions?: {
    approved_evidence_pack?: boolean;
    provider_result_received?: boolean;
    human_approval_recorded?: boolean;
  };
}

export interface WordingGuardViolation {
  phrase: string;
  index: number;
}

/** Finality / payment / WaD wording — always forbidden on external surfaces,
 * regardless of supporting conditions. */
const ABSOLUTE_FORBIDDEN_ON_EXTERNAL = [
  "Final settlement",
  "Payment confirmed",
  "Refund complete",
  "Without a Doubt",
  "WaD finality",
  "Guaranteed",
  "Guaranteed Bankable",
  "Risk-free",
  "No risk",
  "Audit-proof",
] as const;

function findOccurrences(
  text: string,
  phrases: readonly string[],
): WordingGuardViolation[] {
  const haystack = text.toLowerCase();
  const out: WordingGuardViolation[] = [];
  for (const phrase of phrases) {
    const needle = phrase.toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      out.push({ phrase, index: idx });
      from = idx + needle.length;
    }
  }
  return out;
}

/** Returns all forbidden-phrase hits (case-insensitive substring match). */
export function findForbiddenWording(text: string): WordingGuardViolation[] {
  return findOccurrences(text, P5_FORBIDDEN_WORDS);
}

/** True when the text contains only allowed wording / nothing forbidden. */
export function isCustomerSafeWording(
  text: string,
  options?: WordingGuardOptions,
): boolean {
  try {
    assertCustomerSafeWording(text, options);
    return true;
  } catch {
    return false;
  }
}

export class P5WordingGuardError extends Error {
  constructor(
    message: string,
    readonly violations: WordingGuardViolation[],
    readonly surface: P5WordingSurface,
  ) {
    super(message);
    this.name = "P5WordingGuardError";
  }
}

/**
 * Throws if the supplied text contains forbidden wording on the chosen
 * surface. Admin/internal surfaces are not gated, but external surfaces
 * (customer / funder / public_api) require the supporting conditions
 * before any forbidden phrase is permitted — and finality / payment / WaD
 * wording stays forbidden regardless.
 */
export function assertCustomerSafeWording(
  text: string,
  options: WordingGuardOptions = {},
): void {
  const surface = options.surface ?? "customer";

  if (surface === "admin_internal") return;

  const violations = findForbiddenWording(text);
  if (violations.length === 0) return;

  const absolute = findOccurrences(text, ABSOLUTE_FORBIDDEN_ON_EXTERNAL);
  if (absolute.length > 0) {
    throw new P5WordingGuardError(
      `Forbidden finality/payment/WaD wording on ${surface} surface: ${absolute
        .map((v) => v.phrase)
        .join(", ")}`,
      absolute,
      surface,
    );
  }

  const c = options.supportingConditions;
  const allConditions = Boolean(
    c?.approved_evidence_pack &&
      c?.provider_result_received &&
      c?.human_approval_recorded,
  );

  if (!allConditions) {
    throw new P5WordingGuardError(
      `Forbidden wording on ${surface} surface without supporting conditions: ${violations
        .map((v) => v.phrase)
        .join(", ")}`,
      violations,
      surface,
    );
  }
}

export { P5_ALLOWED_WORDS, P5_FORBIDDEN_WORDS };
