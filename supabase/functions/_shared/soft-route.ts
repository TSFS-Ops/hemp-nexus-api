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
