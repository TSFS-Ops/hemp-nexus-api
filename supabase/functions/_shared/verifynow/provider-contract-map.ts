/**
 * Batch V — VerifyNow provider-contract map.
 *
 * SERVER-ONLY. Confirmed by Daniel via the VerifyNow dashboard/docs/support
 * (2026-07-08). Maps our internal `document_type` identifiers to the real
 * VerifyNow provider contract (endpoint path, reportType where applicable,
 * and body field mapping).
 *
 * FAIL-CLOSED RULE: only entries with `confirmed: true` may ever be used to
 * build a live VerifyNow request. `resolveProviderContract` returns `null`
 * for any unmapped or unconfirmed document type, and the adapter
 * (adapter.ts) treats a `null` result as PROVIDER_MISCONFIGURED. The
 * adapter must never fall back to guessing an endpoint or reportType from
 * the internal document_type.
 *
 * Confirmed routes (2026-07-08):
 *   - za_said_basic            -> POST /verify, reportType "said_verification"
 *   - za_home_affairs_enhanced -> POST /verify, reportType "home_affairs_id_photo"
 *   - ng_nin                   -> POST /africa-verification, country "NG", id_type "NIN_V2"
 *
 * Deliberately NOT mapped yet (must stay fail-closed until VerifyNow /
 * Daniel confirms the exact contract): ng_virtual_nin, ng_nin_slip,
 * ng_bvn, ng_voter_id, ng_phone_lookup, ng_bank_account_check, and any
 * route that would require "home_affairs_real_time_idv" (not found in
 * VerifyNow's docs).
 */

export interface ProviderContractEntry {
    document_type: string;
    confirmed: boolean;
    /** Path appended to VERIFYNOW_BASE_URL, e.g. "verify" or "africa-verification". */
  endpoint_path: string;
    /** Provider reportType, when the endpoint requires one (SA /verify routes). */
  report_type?: string;
    /** internal required_fields key -> provider body key. */
  field_mapping: Record<string, string>;
    /** Fixed provider fields that never come from user input, e.g. country/id_type. */
  constant_fields?: Record<string, string>;
}

const CONTRACTS: readonly ProviderContractEntry[] = Object.freeze([
  {
        document_type: "za_said_basic",
        confirmed: true,
        endpoint_path: "verify",
        report_type: "said_verification",
        field_mapping: { said_number: "idNumber" },
  },
  {
        document_type: "za_home_affairs_enhanced",
        confirmed: true,
        endpoint_path: "verify",
        report_type: "home_affairs_id_photo",
        field_mapping: { said_number: "idNumber" },
  },
  {
        document_type: "ng_nin",
        confirmed: true,
        endpoint_path: "africa-verification",
        field_mapping: { nin: "id_number" },
        constant_fields: { country: "NG", id_type: "NIN_V2" },
  },
  ]);

/**
 * Returns the confirmed provider contract for a document type, or `null`
 * if the route is unmapped or not yet confirmed. Callers MUST fail closed
 * on `null` -- never construct a request from the internal document_type.
 */
export function resolveProviderContract(documentType: string): ProviderContractEntry | null {
    const entry = CONTRACTS.find((e) => e.document_type === documentType && e.confirmed);
    return entry ?? null;
}
