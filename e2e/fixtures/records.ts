/**
 * Seeded record IDs per organisation. All values come from env, populated
 * by the seeder. Tests that require a record skip cleanly when its ID is
 * absent — never fall back to a fake/guessed ID against real data.
 *
 * Naming convention: TEST-* or UAT-* prefix enforced by seeder.
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

export type RecordKey =
  | "tradeRequestId"
  | "matchId"
  | "poiId"
  | "wadId"
  | "documentId"
  | "refundRequestId"
  | "governanceExportId"
  | "apiKeyId";

type RecordSet = Partial<Record<RecordKey, string>>;

export const ORG_A_RECORDS: RecordSet = {
  tradeRequestId: env("E2E_RN_ORG_A_TRADE_REQUEST_ID"),
  matchId: env("E2E_RN_ORG_A_MATCH_ID"),
  poiId: env("E2E_RN_ORG_A_POI_ID"),
  wadId: env("E2E_RN_ORG_A_WAD_ID"),
  documentId: env("E2E_RN_ORG_A_DOCUMENT_ID"),
  refundRequestId: env("E2E_RN_ORG_A_REFUND_REQUEST_ID"),
  governanceExportId: env("E2E_RN_ORG_A_GOVERNANCE_EXPORT_ID"),
  apiKeyId: env("E2E_RN_ORG_A_API_KEY_ID"),
};

export const ORG_B_RECORDS: RecordSet = {
  tradeRequestId: env("E2E_RN_ORG_B_TRADE_REQUEST_ID"),
  matchId: env("E2E_RN_ORG_B_MATCH_ID"),
  poiId: env("E2E_RN_ORG_B_POI_ID"),
  wadId: env("E2E_RN_ORG_B_WAD_ID"),
  documentId: env("E2E_RN_ORG_B_DOCUMENT_ID"),
  refundRequestId: env("E2E_RN_ORG_B_REFUND_REQUEST_ID"),
  governanceExportId: env("E2E_RN_ORG_B_GOVERNANCE_EXPORT_ID"),
  apiKeyId: env("E2E_RN_ORG_B_API_KEY_ID"),
};

export function getRecord(org: "A" | "B", key: RecordKey): string | undefined {
  return (org === "A" ? ORG_A_RECORDS : ORG_B_RECORDS)[key];
}

export function requireRecord(org: "A" | "B", key: RecordKey): string {
  const v = getRecord(org, key);
  if (!v) throw new Error(`Missing seeded record ${key} for Org ${org}. Run seeder Phase 2.`);
  return v;
}
