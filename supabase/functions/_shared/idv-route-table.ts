/**
 * Batch V — IDV Route Table (server mirror of src/lib/idv/route-table.ts).
 *
 * The two files MUST stay identical in shape. A drift test in
 * src/tests/batch-v-idv-routing.test.ts fails the build if they diverge.
 *
 * Provider routing is decided ONLY by (document_country, document_type).
 * Nationality / residence / company country / transaction country must
 * NEVER influence provider selection. See the browser copy for rationale.
 */

export type IdvProviderId = "verifynow";

export type IdvDocumentClass = "full_idv" | "supporting_only";

export interface IdvRouteEntry {
  document_country: string;
  document_type: string;
  provider: IdvProviderId;
  live_enabled: boolean;
  api_supported: boolean;
  dashboard_only: boolean;
  document_class: IdvDocumentClass;
  can_unlock_controlled_actions: boolean;
  required_fields: readonly string[];
  user_wording: { label: string; hint?: string };
  admin_wording: { label: string };
}

export const IDV_ROUTE_TABLE: readonly IdvRouteEntry[] = Object.freeze([
  {
    document_country: "ZA",
    document_type: "za_said_basic",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "supporting_only",
    can_unlock_controlled_actions: false,
    required_fields: ["said_number", "surname"],
    user_wording: {
      label: "South African ID number check",
      hint: "Basic identity data lookup. Additional identity verification may still be required.",
    },
    admin_wording: { label: "VerifyNow — SAID basic verification (supporting)" },
  },
  {
    document_country: "ZA",
    document_type: "za_home_affairs_enhanced",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "full_idv",
    can_unlock_controlled_actions: true,
    required_fields: ["said_number", "first_names", "surname"],
    user_wording: {
      label: "Home Affairs identity verification",
      hint: "Authoritative real-time identity verification against Home Affairs.",
    },
    admin_wording: { label: "VerifyNow — Home Affairs Enhanced IDV (authoritative)" },
  },
  {
    document_country: "NG",
    document_type: "ng_nin",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "full_idv",
    can_unlock_controlled_actions: true,
    required_fields: ["nin", "first_name", "last_name"],
    user_wording: { label: "Nigerian NIN verification" },
    admin_wording: { label: "VerifyNow — NIN (authoritative)" },
  },
  {
    document_country: "NG",
    document_type: "ng_virtual_nin",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "full_idv",
    can_unlock_controlled_actions: true,
    required_fields: ["virtual_nin", "first_name", "last_name"],
    user_wording: { label: "Nigerian Virtual NIN verification" },
    admin_wording: { label: "VerifyNow — Virtual NIN (authoritative)" },
  },
  {
    document_country: "NG",
    document_type: "ng_nin_slip",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "full_idv",
    can_unlock_controlled_actions: true,
    required_fields: ["nin_slip_reference"],
    user_wording: { label: "Nigerian NIN slip verification" },
    admin_wording: { label: "VerifyNow — NIN Slip (authoritative, if API-supported)" },
  },
  {
    document_country: "NG",
    document_type: "ng_bvn",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "supporting_only",
    can_unlock_controlled_actions: false,
    required_fields: ["bvn"],
    user_wording: { label: "Nigerian BVN check" },
    admin_wording: { label: "VerifyNow — BVN (supporting only, not full IDV)" },
  },
  {
    document_country: "NG",
    document_type: "ng_voter_id",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "supporting_only",
    can_unlock_controlled_actions: false,
    required_fields: ["voter_id"],
    user_wording: { label: "Nigerian voter ID check" },
    admin_wording: { label: "VerifyNow — Voter ID (supporting)" },
  },
  {
    document_country: "NG",
    document_type: "ng_phone_lookup",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "supporting_only",
    can_unlock_controlled_actions: false,
    required_fields: ["phone_number"],
    user_wording: { label: "Nigerian phone number check" },
    admin_wording: { label: "VerifyNow — Phone lookup (supporting)" },
  },
  {
    document_country: "NG",
    document_type: "ng_bank_account_check",
    provider: "verifynow",
    live_enabled: true,
    api_supported: true,
    dashboard_only: false,
    document_class: "supporting_only",
    can_unlock_controlled_actions: false,
    required_fields: ["bank_account_number", "bank_code"],
    user_wording: { label: "Nigerian bank account check" },
    admin_wording: { label: "VerifyNow — Bank account check (supporting)" },
  },
  ...(["GH", "KE", "UG", "ZM", "CI"] as const).map(
    (cc): IdvRouteEntry => ({
      document_country: cc,
      document_type: "national_id_placeholder",
      provider: "verifynow",
      live_enabled: false,
      api_supported: false,
      dashboard_only: false,
      document_class: "supporting_only",
      can_unlock_controlled_actions: false,
      required_fields: [],
      user_wording: {
        label: "Manual review required",
        hint: "Automated identity verification for this country is not yet available. Your case will be reviewed by our team.",
      },
      admin_wording: {
        label: `VerifyNow — ${cc} placeholder (awaiting API confirmation)`,
      },
    }),
  ),
]);

export type IdvRouteResolution =
  | { kind: "route"; entry: IdvRouteEntry }
  | {
      kind: "provider_not_available";
      reason: "unsupported_country" | "unsupported_document_type";
    };

export interface IdvRouteInput {
  document_country: string;
  document_type: string;
  nationality?: string;
  country_of_residence?: string;
  company_country?: string;
  transaction_country?: string;
}

export function resolveIdvRoute(input: IdvRouteInput): IdvRouteResolution {
  const cc = (input.document_country || "").trim().toUpperCase();
  const dt = (input.document_type || "").trim();
  const countryRows = IDV_ROUTE_TABLE.filter((r) => r.document_country === cc);
  if (countryRows.length === 0) {
    return { kind: "provider_not_available", reason: "unsupported_country" };
  }
  const entry = countryRows.find((r) => r.document_type === dt);
  if (!entry) {
    return { kind: "provider_not_available", reason: "unsupported_document_type" };
  }
  if (!entry.live_enabled || !entry.api_supported) {
    return { kind: "provider_not_available", reason: "unsupported_document_type" };
  }
  return { kind: "route", entry };
}
