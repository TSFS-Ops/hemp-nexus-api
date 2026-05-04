/**
 * Soft-route helper for POI mint
 * ──────────────────────────────
 * When the eligibility evaluator rejects a POI mint with `ELIGIBILITY_FAILED`
 * because — and ONLY because — the counterparty is named but does not yet
 * have a verified platform identifier (`buyer_id` / `seller_id` is null),
 * the match endpoint creates an off-platform engagement record instead of
 * returning 422.
 *
 * This file isolates the policy decision ("is this failure soft-routable?")
 * and the binding-resolution ("does the supplied email match a registered
 * org?") so the match function stays readable and the rules are testable
 * in one place.
 *
 * Invariant: ANY failure outside the id-only set must remain a hard 422.
 * Missing price, missing commodity, same buyer/seller, etc. are not soft
 * routable — they would leave a half-formed engagement on the books with
 * no commercial truth behind it.
 */

import type { EligibilityResult } from "./eligibility.ts";

export type BindingHint =
  | { status: "bound"; org_id: string; email: string }
  | { status: "no_match"; email: string; message: string }
  | { status: "lookup_error"; email: string; message: string }
  | { status: "no_email"; message: string };

/**
 * The exact set of `failedFields` values that — on their own — qualify
 * a bilateral match for soft routing. If `failedFields` contains anything
 * outside this set, the failure is NOT soft-routable.
 */
const SOFT_ROUTABLE_FIELDS = new Set(["buyer_id", "seller_id"]);

export interface SoftRouteEligibility {
  eligible: boolean;
  /** Which named-but-unregistered sides triggered the soft route. */
  missingBuyerId: boolean;
  missingSellerId: boolean;
  /** The exact `failedFields` array we evaluated, for audit. */
  failedFields: string[];
  /** Set when `eligible === false` so the caller knows why. */
  reason?: string;
}

/**
 * Decide whether an `ELIGIBILITY_FAILED` outcome should be soft-routed
 * into a Pending Engagement instead of returned as 422.
 *
 * Returns `eligible: false` (i.e. NOT soft-routable) when:
 *   - the match is unilateral (different shape, different rules)
 *   - any failed field is outside the id-only set
 *   - the corresponding name is missing (we won't invent counterparty rows
 *     for matches that have no party named at all — that's a draft, not
 *     an engagement)
 */
export function evaluateSoftRoute(
  match: Record<string, unknown>,
  result: EligibilityResult,
): SoftRouteEligibility {
  const failedFields = result.failedFields ?? [];
  const isUnilateral = match.match_type === "unilateral";

  if (isUnilateral) {
    return {
      eligible: false,
      missingBuyerId: false,
      missingSellerId: false,
      failedFields,
      reason: "soft_route_not_supported_for_unilateral",
    };
  }

  if (failedFields.length === 0) {
    return {
      eligible: false,
      missingBuyerId: false,
      missingSellerId: false,
      failedFields,
      reason: "no_failed_fields",
    };
  }

  // Reason-code gate (runs BEFORE field-name gate). The eligibility
  // evaluator can record `SAME_COUNTERPARTY` against the buyer_id /
  // seller_id field names — those names are inside the soft-routable
  // set, but the underlying failure is a hard semantic conflict
  // (the same entity on both sides). Inspect codes, not just names,
  // so we never soft-route a same-counterparty match.
  const errorCodes = new Set(
    (result.reasons ?? [])
      .filter((r) => r.severity === "error")
      .map((r) => r.code),
  );
  const HARD_FAIL_CODES = new Set([
    "SAME_COUNTERPARTY",
    "INVALID_NUMBER",
    "INVALID_VALUE",
    "INVALID_CURRENCY",
  ]);
  for (const code of errorCodes) {
    if (HARD_FAIL_CODES.has(code)) {
      return {
        eligible: false,
        missingBuyerId: false,
        missingSellerId: false,
        failedFields,
        reason: `non_soft_routable_code:${code}`,
      };
    }
  }

  // Hard-fail: any failure outside the id-only set means the match is
  // commercially incomplete. Soft routing here would create misleading
  // engagement rows. The caller MUST re-throw the 422.
  for (const field of failedFields) {
    if (!SOFT_ROUTABLE_FIELDS.has(field)) {
      return {
        eligible: false,
        missingBuyerId: false,
        missingSellerId: false,
        failedFields,
        reason: `non_soft_routable_field:${field}`,
      };
    }
  }

  // The failures are exclusively buyer_id / seller_id. Confirm the
  // corresponding NAMES are present — we only soft-route when the user
  // has actually identified a counterparty (just not a registered one).
  const missingBuyerId = failedFields.includes("buyer_id");
  const missingSellerId = failedFields.includes("seller_id");

  const buyerName = typeof match.buyer_name === "string" ? match.buyer_name.trim() : "";
  const sellerName = typeof match.seller_name === "string" ? match.seller_name.trim() : "";

  if (missingBuyerId && buyerName.length === 0) {
    return {
      eligible: false,
      missingBuyerId,
      missingSellerId,
      failedFields,
      reason: "buyer_id_missing_and_no_buyer_name",
    };
  }
  if (missingSellerId && sellerName.length === 0) {
    return {
      eligible: false,
      missingBuyerId,
      missingSellerId,
      failedFields,
      reason: "seller_id_missing_and_no_seller_name",
    };
  }

  return {
    eligible: true,
    missingBuyerId,
    missingSellerId,
    failedFields,
  };
}

/**
 * Resolve a counterparty email to a registered organisation, returning
 * the same shape `BindingHint` that `poi-engagements` PATCH returns. Kept
 * in sync with `docs/poi-engagements-binding-contract.md`.
 *
 * `supabase` is intentionally typed loosely so this helper works under
 * both the service-role client (match function) and the user-scoped
 * client (poi-engagements function) without coupling to either.
 */
export async function resolveCounterpartyBinding(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  email: string | null | undefined,
  requestId: string,
): Promise<BindingHint> {
  if (!email || typeof email !== "string" || email.trim().length === 0) {
    return {
      status: "no_email",
      message:
        "No counterparty email supplied. The engagement is queued in the admin Pending Engagements panel; a reviewer must reach out manually.",
    };
  }

  const normalised = email.trim().toLowerCase();

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("org_id")
      .ilike("email", normalised)
      .not("org_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(
        `[${requestId}] soft-route binding lookup failed (non-fatal): ${error.message}`,
      );
      return {
        status: "lookup_error",
        email: normalised,
        message:
          "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
      };
    }

    if (data?.org_id) {
      return { status: "bound", org_id: data.org_id, email: normalised };
    }

    return {
      status: "no_match",
      email: normalised,
      message:
        "Email saved, but no registered organisation matches this address yet. The engagement will remain unbound until the recipient signs up or the email is corrected.",
    };
  } catch (e) {
    console.warn(
      `[${requestId}] soft-route binding lookup threw (non-fatal):`,
      e,
    );
    return {
      status: "lookup_error",
      email: normalised,
      message:
        "Email saved, but the platform could not check whether it matches a registered organisation. Please retry shortly.",
    };
  }
}

/**
 * Counterparty registration gate (post-2026-04-27 policy).
 *
 * Eligibility no longer requires `buyer_id` / `seller_id`, so a match with a
 * named-but-unregistered counterparty now PASSES `evaluateEligibility` and
 * would otherwise drop straight into `atomic_generate_poi_v2` — which would
 * try to seal a binding POI against a non-platform entity. That is exactly
 * the failure mode the soft-route was built to prevent.
 *
 * This helper runs BEFORE the eligibility branch and decides what to do
 * when one side has no `*_org_id` on file:
 *
 *   - `soft_route`     — name present, org_id missing → create Pending
 *                        Engagement, return 202 ENGAGEMENT_PENDING.
 *   - `missing_details` — both name AND org_id missing on a side that the
 *                        caller is not on → return 422 COUNTERPARTY_REQUIRED.
 *   - `proceed`        — both sides have org_ids (registered bilateral) OR
 *                        the match is unilateral → run normal POI mint.
 *
 * Important: this is independent of `evaluateEligibility`'s commercial-terms
 * checks. Commercial gaps still hard-fail through the existing 422 path.
 */
export type CounterpartyGateOutcome =
  | {
      decision: "proceed";
    }
  | {
      decision: "soft_route";
      missing_party: "buyer" | "seller";
      counterparty_name: string;
    }
  | {
      decision: "missing_details";
      missing_party: "buyer" | "seller";
      missing: ("name" | "org")[];
    };

export function evaluateCounterpartyGate(
  match: Record<string, unknown>,
  callerOrgId: string,
): CounterpartyGateOutcome {
  // Unilateral matches have their own rules; the existing path handles them.
  if (match.match_type === "unilateral") {
    return { decision: "proceed" };
  }

  const buyerOrgId = (match.buyer_org_id as string | null) ?? null;
  const sellerOrgId = (match.seller_org_id as string | null) ?? null;
  const buyerName =
    typeof match.buyer_name === "string" ? match.buyer_name.trim() : "";
  const sellerName =
    typeof match.seller_name === "string" ? match.seller_name.trim() : "";

  // Both sides registered → normal mint.
  if (buyerOrgId && sellerOrgId) {
    return { decision: "proceed" };
  }

  // Identify which side is the *counterparty* (the one not held by the caller).
  // If the caller is on neither side, treat any unattached side as the
  // counterparty — the legitimacy / participation guard upstream will have
  // already rejected non-parties before we get here.
  let missingParty: "buyer" | "seller";
  let missingName: string;
  let missingOrgId: string | null;

  if (buyerOrgId === callerOrgId && !sellerOrgId) {
    missingParty = "seller";
    missingName = sellerName;
    missingOrgId = sellerOrgId;
  } else if (sellerOrgId === callerOrgId && !buyerOrgId) {
    missingParty = "buyer";
    missingName = buyerName;
    missingOrgId = buyerOrgId;
  } else if (!sellerOrgId) {
    missingParty = "seller";
    missingName = sellerName;
    missingOrgId = sellerOrgId;
  } else {
    missingParty = "buyer";
    missingName = buyerName;
    missingOrgId = buyerOrgId;
  }

  // Name present but org_id missing → soft-route to Pending Engagement.
  if (missingName.length > 0 && !missingOrgId) {
    return {
      decision: "soft_route",
      missing_party: missingParty,
      counterparty_name: missingName,
    };
  }

  // Neither name nor org_id → caller must add details first.
  const missing: ("name" | "org")[] = [];
  if (missingName.length === 0) missing.push("name");
  if (!missingOrgId) missing.push("org");
  return {
    decision: "missing_details",
    missing_party: missingParty,
    missing,
  };
}
