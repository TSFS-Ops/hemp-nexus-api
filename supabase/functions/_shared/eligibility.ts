import { ApiException } from "./errors.ts";

/**
 * Eligibility Evaluator - "Ambiguity = Automatic Denial" Rule
 * 
 * If any required field is missing, contradictory, or cannot be validated,
 * the system blocks Confirm Intent and returns a clear denial.
 */

// Required fields for Confirm Intent
const REQUIRED_MATCH_FIELDS = [
  { field: "org_id", label: "Organization ID" },
  { field: "buyer_id", label: "Buyer Identifier" },
  { field: "buyer_name", label: "Buyer Name" },
  { field: "seller_id", label: "Seller Identifier" },
  { field: "seller_name", label: "Seller Name" },
  { field: "commodity", label: "Commodity" },
  { field: "quantity_amount", label: "Quantity Amount" },
  { field: "quantity_unit", label: "Quantity Unit" },
  { field: "price_amount", label: "Price Amount" },
  { field: "price_currency", label: "Price Currency" },
  { field: "hash", label: "Match Hash" },
];

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
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

  // Check all required fields
  for (const { field, label } of REQUIRED_MATCH_FIELDS) {
    const value = match[field];

    // Check for missing fields
    if (value === undefined || value === null) {
      reasons.push({
        code: "MISSING_FIELD",
        field,
        message: `${label} is required but missing`,
        severity: "error",
      });
      continue;
    }

    // Check for empty strings
    if (typeof value === "string" && value.trim() === "") {
      reasons.push({
        code: "EMPTY_FIELD",
        field,
        message: `${label} cannot be empty`,
        severity: "error",
      });
      continue;
    }

    // Check for invalid numeric values
    if (field.includes("amount") && typeof value === "number") {
      if (isNaN(value) || !isFinite(value)) {
        reasons.push({
          code: "INVALID_NUMBER",
          field,
          message: `${label} must be a valid number`,
          severity: "error",
        });
      } else if (value <= 0) {
        reasons.push({
          code: "INVALID_VALUE",
          field,
          message: `${label} must be greater than zero`,
          severity: "error",
        });
      }
    }
  }

  // Validate buyer/seller are not the same
  if (match.buyer_id === match.seller_id && match.buyer_id) {
    reasons.push({
      code: "SAME_COUNTERPARTY",
      field: "buyer_id,seller_id",
      message: "Buyer and seller cannot be the same entity",
      severity: "error",
    });
  }

  // Validate hash format
  if (match.hash && typeof match.hash === "string") {
    if (!/^[a-f0-9]{64}$/i.test(match.hash)) {
      reasons.push({
        code: "INVALID_HASH",
        field: "hash",
        message: "Match hash must be a valid SHA-256 hash (64 hex characters)",
        severity: "error",
      });
    }
  }

  // Validate org_id format (UUID)
  if (match.org_id && typeof match.org_id === "string") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match.org_id)) {
      reasons.push({
        code: "INVALID_ORG_ID",
        field: "org_id",
        message: "Organization ID must be a valid UUID",
        severity: "error",
      });
    }
  }

  // Validate currency code format (3 uppercase letters)
  if (match.price_currency && typeof match.price_currency === "string") {
    if (!/^[A-Z]{3}$/.test(match.price_currency)) {
      reasons.push({
        code: "INVALID_CURRENCY",
        field: "price_currency",
        message: "Currency must be a valid 3-letter ISO currency code (e.g., USD, EUR, ZAR)",
        severity: "error",
      });
    }
  }

  // Check if already settled (cannot confirm again)
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
  };
}

/**
 * Enforce eligibility - throws if not eligible
 */
export function enforceEligibility(match: Record<string, unknown>): void {
  const result = evaluateEligibility(match);

  if (!result.eligible) {
    const errorReasons = result.reasons.filter((r) => r.severity === "error");
    const reasonCodes = errorReasons.map((r) => r.code).join(", ");
    const reasonMessages = errorReasons.map((r) => `• ${r.message}`).join("\n");

    throw new ApiException(
      "ELIGIBILITY_DENIED",
      `Confirm Intent denied due to ambiguity. Missing or invalid data prevents creating a valid proof record.\n\n${reasonMessages}`,
      422,
      {
        eligible: false,
        reasons: errorReasons,
        reasonCodes,
        guidance: "Ensure all required fields are present and valid before confirming intent.",
      }
    );
  }
}

/**
 * Format eligibility result for API response
 */
export function formatEligibilityResponse(result: EligibilityResult): {
  eligible: boolean;
  errors: Array<{ field: string; message: string; code: string }>;
  warnings: Array<{ field: string; message: string; code: string }>;
} {
  return {
    eligible: result.eligible,
    errors: result.reasons
      .filter((r) => r.severity === "error")
      .map((r) => ({ field: r.field, message: r.message, code: r.code })),
    warnings: result.reasons
      .filter((r) => r.severity === "warning")
      .map((r) => ({ field: r.field, message: r.message, code: r.code })),
  };
}
