/**
 * P-5 Batch 2 — Stage 2: Role-based masking helpers.
 *
 * Pure. Intended for both edge-function output shaping and UI render code.
 * Sensitive fields never return raw values to non-authorised viewers.
 */
import type { P5B2ViewerType } from "./provider-wording-guard";

export type P5B2SensitiveField =
  | "bank_account_number"
  | "id_or_passport_number"
  | "tax_or_vat_number"
  | "physical_address"
  | "ubo_details"
  | "personal_contact_details"
  | "reviewer_note_internal"
  | "fraud_flag"
  | "provider_raw_response";

/** Admin / compliance can see raw values for everything by default. */
const ADMIN_ONLY_FIELDS = new Set<P5B2SensitiveField>([
  "reviewer_note_internal",
  "fraud_flag",
  "provider_raw_response",
]);

function last4(value: string | null | undefined): string {
  if (!value) return "";
  const digits = String(value);
  if (digits.length <= 4) return `••${digits.slice(-4)}`;
  return `••••${digits.slice(-4)}`;
}

function partialTaxVat(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).replace(/\s+/g, "");
  if (s.length <= 4) return `••${s.slice(-2)}`;
  return `${s.slice(0, 2)}••••${s.slice(-2)}`;
}

function summariseAddress(value: string | null | undefined): string {
  if (!value) return "";
  // Keep city / country tail, drop street numbers.
  const parts = String(value).split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return "Address on file";
  return parts.slice(-2).join(", ");
}

function summariseUbo(value: string | null | undefined): string {
  if (!value) return "";
  return "UBO summary on file";
}

function maskedContact(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value);
  if (s.includes("@")) {
    const [user, domain] = s.split("@");
    return `${user.slice(0, 1)}••@${domain}`;
  }
  return last4(s);
}

export interface P5B2MaskOptions {
  viewer: P5B2ViewerType;
  /** Set true when the viewer is on a privileged compliance surface. */
  is_compliance_owner?: boolean;
  /** Set true to apply admin-style masking (still masks if not admin). */
  is_admin?: boolean;
}

export function maskP5B2Field(
  field: P5B2SensitiveField,
  raw: string | null | undefined,
  options: P5B2MaskOptions,
): string {
  const adminLike = options.is_admin || options.is_compliance_owner || options.viewer === "admin";

  if (ADMIN_ONLY_FIELDS.has(field)) {
    return adminLike ? raw ?? "" : "";
  }

  if (adminLike) return raw ?? "";

  switch (field) {
    case "bank_account_number":
      return last4(raw);
    case "id_or_passport_number":
      return last4(raw);
    case "tax_or_vat_number":
      return partialTaxVat(raw);
    case "physical_address":
      // Funder / API see country/city only; counterparty/org_user get summary.
      return options.viewer === "funder" || options.viewer === "api_user"
        ? "Address on file"
        : summariseAddress(raw);
    case "ubo_details":
      return options.viewer === "funder" || options.viewer === "api_user"
        ? summariseUbo(raw)
        : summariseUbo(raw);
    case "personal_contact_details":
      return options.viewer === "funder" || options.viewer === "api_user"
        ? "Contact on file"
        : maskedContact(raw);
  }
}

/** Mask an entire object in one pass. Unknown fields are passed through. */
export function maskP5B2Object<T extends Record<string, unknown>>(
  obj: T,
  fieldMap: Partial<Record<keyof T, P5B2SensitiveField>>,
  options: P5B2MaskOptions,
): T {
  const out: Record<string, unknown> = { ...obj };
  for (const key of Object.keys(fieldMap) as Array<keyof T>) {
    const field = fieldMap[key];
    if (!field) continue;
    out[key as string] = maskP5B2Field(field, obj[key] as string | null, options);
  }
  return out as T;
}

/** True if the field is admin-only (used by edge functions to strip output). */
export function isP5B2AdminOnlyField(field: P5B2SensitiveField): boolean {
  return ADMIN_ONLY_FIELDS.has(field);
}
