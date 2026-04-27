import { ApiException } from "./errors.ts";

/**
 * Eligibility Evaluator - "Ambiguity = Automatic Denial" Rule
 * 
 * If any required field is missing, contradictory, or cannot be validated,
 * the system blocks Confirm Intent and returns a clear denial.
 * 
 * Unilateral intents have relaxed requirements: only one party is needed.
 */

// Required fields for bilateral Confirm Intent.
//
// PRODUCT DIRECTIVE (2026-04-27, Daniel Davies):
// "No hard verification before POI. Light public-source checks only."
// → buyer_id / seller_id are NO LONGER required at POI mint. A NAMED
//   counterparty is sufficient. Hard verification (KYB/IDV/UBO) remains
//   mandatory at WaD via the 9-gate engine — not here.
// See admin_settings.poi_pre_verification_policy for the canonical record.
const BILATERAL_REQUIRED_FIELDS = [
  { field: "buyer_name", label: "Buyer Name", type: "string" },
  { field: "seller_name", label: "Seller Name", type: "string" },
  { field: "commodity", label: "Commodity", type: "string" },
  { field: "quantity_amount", label: "Quantity Amount", type: "positive_number" },
  { field: "quantity_unit", label: "Quantity Unit", type: "string" },
  { field: "price_amount", label: "Price Amount", type: "positive_number" },
  { field: "price_currency", label: "Price Currency", type: "currency" },
];

// Unilateral intents only require the declaring party + commodity + commercial terms
const UNILATERAL_REQUIRED_FIELDS = [
  { field: "commodity", label: "Commodity", type: "string" },
  { field: "quantity_amount", label: "Quantity Amount", type: "positive_number" },
  { field: "quantity_unit", label: "Quantity Unit", type: "string" },
  { field: "price_amount", label: "Price Amount", type: "positive_number" },
  { field: "price_currency", label: "Price Currency", type: "currency" },
];

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  checkedFields: string[];
  passedFields: string[];
  failedFields: string[];
}

export interface EligibilityReason {
  code: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Evaluate if a match is eligible for Confirm Intent
 */
export function evaluateEligibility(match: Record<string, unknown>): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const checkedFields: string[] = [];
  const passedFields: string[] = [];
  const failedFields: string[] = [];

  const isUnilateral = match.match_type === "unilateral";

  // Choose field set based on match type
  const requiredFields = isUnilateral ? UNILATERAL_REQUIRED_FIELDS : BILATERAL_REQUIRED_FIELDS;

  // For unilateral: at least one party (the declaring side) must be present
  if (isUnilateral) {
    const hasBuyer = match.buyer_id != null && match.buyer_name != null;
    const hasSeller = match.seller_id != null && match.seller_name != null;
    checkedFields.push("declaring_party");
    if (!hasBuyer && !hasSeller) {
      reasons.push({
        code: "MISSING_FIELD",
        field: "declaring_party",
        message: "At least one party (buyer or seller) must be identified for a unilateral intent",
        severity: "error",
      });
      failedFields.push("declaring_party");
    } else {
      passedFields.push("declaring_party");
    }
  }

  // Check all required fields
  for (const { field, label, type } of requiredFields) {
    checkedFields.push(field);
    const value = match[field];
    let fieldPassed = true;

    // Check for missing fields
    if (value === undefined || value === null) {
      reasons.push({
        code: "MISSING_FIELD",
        field,
        message: `Missing required field: ${label}`,
        severity: "error",
      });
      fieldPassed = false;
      failedFields.push(field);
      continue;
    }

    // Type-specific validation
    switch (type) {
      case "string":
        if (typeof value !== "string" || value.trim() === "") {
          reasons.push({
            code: "EMPTY_FIELD",
            field,
            message: `${label} cannot be empty`,
            severity: "error",
          });
          fieldPassed = false;
        }
        break;

      case "positive_number":
        if (typeof value !== "number" || isNaN(value) || !isFinite(value)) {
          reasons.push({
            code: "INVALID_NUMBER",
            field,
            message: `${label} must be a valid number`,
            severity: "error",
          });
          fieldPassed = false;
        } else if (value <= 0) {
          reasons.push({
            code: "INVALID_VALUE",
            field,
            message: `${label} must be greater than zero`,
            severity: "error",
          });
          fieldPassed = false;
        }
        break;

      case "currency":
        if (typeof value !== "string") {
          reasons.push({
            code: "INVALID_CURRENCY",
            field,
            message: `${label} must be a string`,
            severity: "error",
          });
          fieldPassed = false;
        } else if (!/^[A-Za-z]{3}$/.test(value)) {
          reasons.push({
            code: "INVALID_CURRENCY",
            field,
            message: `${label} must be a valid 3-letter ISO currency code (e.g., USD, EUR, ZAR)`,
            severity: "error",
          });
          fieldPassed = false;
        }
        break;
    }

    if (fieldPassed) {
      passedFields.push(field);
    } else if (!failedFields.includes(field)) {
      failedFields.push(field);
    }
  }

  // Validate buyer/seller are not the same (only for bilateral).
  //
  // Identifier-based collision is always a hard ERROR — registered ids are
  // unambiguous and cannot legitimately be on both sides.
  //
  // Name-only collision is downgraded to a WARNING:
  //   - Two distinct legal entities can share a trading name across
  //     jurisdictions ("Acme (Pty) Ltd" vs "Acme LLC"), and we no longer
  //     have a registered id to discriminate them post-2026-04-27.
  //   - Hard-blocking would create false positives that the user cannot
  //     resolve without registering a counterparty (which is exactly the
  //     gate Daniel asked us to drop).
  // The warning still surfaces in the eligibility response so the user
  // sees it before sealing a POI.
  if (!isUnilateral) {
    const sameById =
      match.buyer_id != null &&
      match.seller_id != null &&
      match.buyer_id === match.seller_id;
    const buyerNameNorm =
      typeof match.buyer_name === "string" ? match.buyer_name.trim().toLowerCase() : "";
    const sellerNameNorm =
      typeof match.seller_name === "string" ? match.seller_name.trim().toLowerCase() : "";
    const sameByName =
      buyerNameNorm.length > 0 &&
      sellerNameNorm.length > 0 &&
      buyerNameNorm === sellerNameNorm;

    if (sameById) {
      reasons.push({
        code: "SAME_COUNTERPARTY",
        field: "buyer_name,seller_name",
        message: "Buyer and seller cannot be the same registered entity",
        severity: "error",
      });
      if (!failedFields.includes("buyer_name")) failedFields.push("buyer_name");
      if (!failedFields.includes("seller_name")) failedFields.push("seller_name");
    } else if (sameByName) {
      reasons.push({
        code: "SAME_COUNTERPARTY_NAME",
        field: "buyer_name,seller_name",
        message:
          "Buyer and seller share the same name. If they are distinct legal entities (e.g. across jurisdictions), continue. If not, correct one side before sealing the Proof of Intent.",
        severity: "warning",
      });
    }
  }

  // Check if already settled (warning only - doesn't block)
  if (match.status === "settled") {
    reasons.push({
      code: "ALREADY_CONFIRMED",
      field: "status",
      message: "Intent has already been confirmed for this match",
      severity: "warning",
    });
  }

  // Determine eligibility (only errors block, warnings don't)
  const hasErrors = reasons.some((r) => r.severity === "error");

  return {
    eligible: !hasErrors,
    reasons,
    checkedFields,
    passedFields,
    failedFields,
  };
}

/**
 * Enforce eligibility - throws if not eligible
 */
export function enforceEligibility(match: Record<string, unknown>): void {
  const result = evaluateEligibility(match);

  if (!result.eligible) {
    const errorReasons = result.reasons.filter((r) => r.severity === "error");
    const denialReasons = errorReasons.map((r) => r.message);

    throw new ApiException(
      "ELIGIBILITY_FAILED",
      "Match does not meet eligibility requirements for Confirm Intent",
      422,
      {
        eligible: false,
        denialReasons,
        checkedFields: result.checkedFields,
        passedFields: result.passedFields,
        failedFields: result.failedFields,
        guidance: match.match_type === "unilateral"
          ? "Ensure commodity, quantity, and price are set before declaring intent on a unilateral record."
          : "Ensure all required fields are present and valid before confirming intent.",
      }
    );
  }
}

/**
 * Format eligibility result for API response
 */
export function formatEligibilityResponse(result: EligibilityResult): {
  eligible: boolean;
  checkedFields: string[];
  passedFields: string[];
  failedFields: string[];
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string; code: string }>;
} {
  return {
    eligible: result.eligible,
    checkedFields: result.checkedFields,
    passedFields: result.passedFields,
    failedFields: result.failedFields,
    errors: result.reasons
      .filter((r) => r.severity === "error")
      .map((r) => ({ field: r.field, message: r.message, code: r.code })),
    warnings: result.reasons
      .filter((r) => r.severity === "warning")
      .map((r) => ({ field: r.field, message: r.message, code: r.code })),
  };
}
