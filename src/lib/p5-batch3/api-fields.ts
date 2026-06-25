/**
 * P-5 Batch 3 — Stage 2 funder API field allow/block (pure TS).
 *
 * No public endpoint exists yet. This is pure logic to be wired in a
 * later stage. The API may expose FEWER fields than the dashboard,
 * never more.
 */
import {
  P5B3_FUNDER_ALLOWED_RELEASED_FIELDS,
  P5B3_FUNDER_BLOCKED_FIELDS,
} from "./visibility";

/** API allow-list is a strict subset of dashboard allow-list. */
export const P5B3_FUNDER_API_ALLOWED_FIELDS = [
  "transaction_summary",
  "released_evidence_pack_version",
  "released_pack_sha256",
  "outcome_history",
  "counterparty_display_name",
  "jurisdiction_summary",
  "provider_safe_status_label",
] as const;
export type P5B3FunderApiField = (typeof P5B3_FUNDER_API_ALLOWED_FIELDS)[number];

export const P5B3_FUNDER_API_BLOCKED_FIELDS = [
  ...P5B3_FUNDER_BLOCKED_FIELDS,
  "released_evidence_pack_url", // no raw doc URLs over API
  "admin_released_notes", // no internal notes over API
  "request_thread_public",
] as const;

export function isApiFieldAllowed(field: string): boolean {
  if ((P5B3_FUNDER_API_BLOCKED_FIELDS as readonly string[]).includes(field)) return false;
  return (P5B3_FUNDER_API_ALLOWED_FIELDS as readonly string[]).includes(field);
}

/** Invariant: API allow ⊆ dashboard allow. */
export function apiIsSubsetOfDashboard(): boolean {
  const dash = new Set<string>(P5B3_FUNDER_ALLOWED_RELEASED_FIELDS);
  return (P5B3_FUNDER_API_ALLOWED_FIELDS as readonly string[]).every((f) => dash.has(f));
}

export function filterForApi<T extends Record<string, unknown>>(record: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(record)) {
    if (isApiFieldAllowed(k)) out[k] = record[k];
  }
  return out as Partial<T>;
}
