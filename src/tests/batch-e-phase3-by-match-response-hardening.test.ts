/**
 * Batch E Phase 3 — by-match response hardening contract test.
 *
 * Pins the exact server-side allowlist used by
 *   GET /poi-engagements/by-match/:matchId
 * so a future refactor cannot silently re-introduce `select("*")` and
 * leak sensitive fields (binding_candidates, dispute_reason,
 * dispute_source, disputed_by_token_hash, disputed_at, dispute_metadata,
 * admin_notes, support_notes*, SLA reminder counters, operational-state
 * setter audit fields, cancellation audit fields) onto the wire.
 *
 * The route is consumed by the initiator UI only — admin surfaces use
 * the list endpoint (`GET /poi-engagements?type=...`). If that ever
 * changes, the allowlist below must be widened deliberately and this
 * test updated in the same change.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(process.cwd(), "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

const FORBIDDEN_FIELDS = [
  "binding_candidates",
  "dispute_reason",
  "dispute_source",
  "disputed_by_token_hash",
  "disputed_at",
  "dispute_metadata",
  "admin_notes",
  "support_notes",
  "support_notes_updated_at",
  "support_notes_updated_by",
  "sla_reminder_sent_at",
  "sla_reminder_count",
  "operational_state_set_at",
  "operational_state_set_by",
  "cancelled_at",
  "cancelled_reason",
  "cancelled_by_user_id",
  "replacement_engagement_id",
  "original_expired_at",
  "late_acceptance_resolved_at",
  "reconfirmed_at",
  "reconfirmed_by_user_id",
  "contact_method",
  "contact_date",
  "source",
];

const REQUIRED_FIELDS = [
  "id",
  "match_id",
  "org_id",
  "engagement_status",
  "counterparty_type",
  "counterparty_email",
  "counterparty_org_id",
  "contact_type",
  "contact_name",
  "created_at",
  "updated_at",
  "contacted_at",
  "responded_at",
  "expires_at",
  "counterparty_response",
  "renewed_from_engagement_id",
  "renewed_engagement_id",
  "late_acceptance_recorded_at",
  "late_acceptance_resolution",
  "reconfirmation_window_expires_at",
  "operational_state",
  "binding_resolution",
];

function extractAllowlist(): string[] {
  const m = SOURCE.match(
    /const\s+BY_MATCH_RESPONSE_ALLOWLIST\s*=\s*\[([\s\S]*?)\]\s*\.join/,
  );
  if (!m) throw new Error("BY_MATCH_RESPONSE_ALLOWLIST not found in poi-engagements/index.ts");
  return Array.from(m[1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]);
}

describe("Batch E Phase 3 — GET /poi-engagements/by-match/:matchId response hardening", () => {
  it("does NOT use select(\"*\") for the by-match query", () => {
    // Look for the by-match handler block specifically.
    const handlerStart = SOURCE.indexOf('engagementId === "by-match"');
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = SOURCE.indexOf("// ── GET /poi-engagements/:id/outreach-log", handlerStart);
    const handler = SOURCE.slice(handlerStart, handlerEnd);
    expect(handler).not.toMatch(/\.select\(\s*"*"\s*\)/);
    expect(handler).toContain("BY_MATCH_RESPONSE_ALLOWLIST");
  });

  it("allowlist contains every field the initiator UI consumes", () => {
    const allow = extractAllowlist();
    for (const field of REQUIRED_FIELDS) {
      expect(allow, `missing required field ${field}`).toContain(field);
    }
  });

  it("allowlist excludes every sensitive / internal field", () => {
    const allow = extractAllowlist();
    for (const field of FORBIDDEN_FIELDS) {
      expect(allow, `forbidden field ${field} must not be in by-match allowlist`).not.toContain(field);
    }
  });

  it("simulated response shape strips forbidden fields", () => {
    // Build a fake row containing every column we care about, project
    // through the allowlist, and assert the projection drops every
    // forbidden field while keeping every required one.
    const allow = extractAllowlist();
    const row: Record<string, unknown> = {};
    for (const f of REQUIRED_FIELDS) row[f] = `value-${f}`;
    for (const f of FORBIDDEN_FIELDS) row[f] = `SENSITIVE-${f}`;

    const projected: Record<string, unknown> = {};
    for (const k of allow) if (k in row) projected[k] = row[k];

    for (const f of FORBIDDEN_FIELDS) {
      expect(projected).not.toHaveProperty(f);
    }
    for (const f of REQUIRED_FIELDS) {
      expect(projected).toHaveProperty(f);
    }
    // Specifically pin the three highest-risk fields the prompt called out.
    expect(projected).not.toHaveProperty("binding_candidates");
    expect(projected).not.toHaveProperty("dispute_reason");
    expect(projected).not.toHaveProperty("disputed_by_token_hash");
  });
});
