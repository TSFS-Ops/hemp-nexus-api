/**
 * Batch V — IDV Route Table (SSOT, browser-safe copy).
 *
 * Routing rule:
 *   Provider selection is decided ONLY by
 *     (document_issuing_country, document_type).
 *   Nationality, country of residence, company country and transaction
 *   country MUST NOT influence provider routing. They may be captured for
 *   records / screening context elsewhere.
 *
 * Live at launch: South Africa (ZA), Nigeria (NG) — VerifyNow.
 * Placeholders (not live yet, resolve to Provider not available / Manual
 * review required): Ghana (GH), Kenya (KE), Uganda (UG), Zambia (ZM),
 * Côte d'Ivoire (CI).
 *
 * The server mirror at supabase/functions/_shared/idv-route-table.ts is
 * guarded to stay in sync — see src/tests/batch-v-idv-routing.test.ts.
 */

export type IdvProviderId = "verifynow";

export type IdvDocumentClass = "full_idv" | "supporting_only";

export interface IdvRouteEntry {
  document_country: string; // ISO alpha-2, upper-case
  document_type: string;    // canonical machine identifier
  provider: IdvProviderId;
  live_enabled: boolean;
  api_supported: boolean;
  dashboard_only: boolean;
  document_class: IdvDocumentClass;
  can_unlock_controlled_actions: boolean;
  required_fields: readonly string[];
  user_wording: {
    label: string;
    hint?: string;
  };
  admin_wording: {
    label: string;
  };
}

/**
 * Route registry. Entries are keyed by (document_country, document_type).
 * Adding a new country/document should not require code changes in any
 * consumer — only add a row here (and its server-mirror row).
 */
export const IDV_ROUTE_TABLE: readonly IdvRouteEntry[] = Object.freeze([
  // -------- South Africa (LIVE) --------
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
    admin_wording: {
      label: "VerifyNow — Home Affairs Enhanced IDV (authoritative)",
    },
  },

  // -------- Nigeria (LIVE, limited authoritative set) --------
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

  // -------- Placeholder rows (NOT live yet) --------
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
  | { kind: "provider_not_available"; reason: "unsupported_country" | "unsupported_document_type" };

export interface IdvRouteInput {
  document_country: string;
  document_type: string;
  // Deliberately IGNORED for routing (present so callers cannot claim they
  // "just didn't have somewhere to pass it" — the guard test asserts these
  // are unread).
  nationality?: string;
  country_of_residence?: string;
  company_country?: string;
  transaction_country?: string;
}

/** Pure. No IO. Routes by document country + type only. */
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

/** True if any live-enabled full-IDV route exists for a document country. */
export function hasLiveFullIdvForCountry(cc: string): boolean {
  const upper = cc.trim().toUpperCase();
  return IDV_ROUTE_TABLE.some(
    (r) =>
      r.document_country === upper &&
      r.live_enabled &&
      r.api_supported &&
      r.document_class === "full_idv",
  );
}
