/**
 * P-5 Batch 2 Stage 4 — static source-level guarantees on admin/operator UI.
 *
 * Asserts (without rendering) that:
 *  - Stage 4 components never call direct table writes for p5_batch2_*.
 *  - All Stage 4 components route mutations through the RPC wrapper module.
 *  - Forbidden provider wording does not appear as a raw string literal.
 *  - Required UI sections / queues / dialog actions are present.
 *  - Sensitive raw columns are never selected by Stage 4 components.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../pages/admin/p5-batch2");

const FILES = {
  dashboard: `${DIR}/EvidenceDashboard.tsx`,
  record: `${DIR}/RecordDetail.tsx`,
  pack: `${DIR}/EvidencePackViewer.tsx`,
  snapshot: `${DIR}/FinalitySnapshotViewer.tsx`,
  dialog: `${DIR}/components/ReasonedActionDialog.tsx`,
  maskedField: `${DIR}/components/MaskedField.tsx`,
  providerLabel: `${DIR}/components/ProviderSafeLabel.tsx`,
};

function read(p: string): string { return readFileSync(p, "utf8"); }

const FORBIDDEN_WORDING = [
  /\bverified\b/i,
  /\bpassed\b/i,
  /\bcleared\b/i,
  /\bsanctions clear\b/i,
  /\bbank verified\b/i,
  /\bprovider approved\b/i,
  /\bno adverse result\b/i,
];

const SENSITIVE_RAW_COLS = [
  "reviewer_note_internal", // only OK in: ReasonedActionDialog (as form field) and as type imports
  "notes_internal",
  "provider_raw_response",
  "fraud_flag",
  "passport_number",
  "id_number",
];

describe("p5-batch2 stage 4 — admin UI source guarantees", () => {
  it("dashboard, record, pack, snapshot exist and only mutate via RPC wrappers", () => {
    for (const key of ["dashboard", "record", "pack", "snapshot"] as const) {
      const src = read(FILES[key]);
      expect(src.length).toBeGreaterThan(100);
      // No direct table writes against Stage 2 tables.
      expect(src, `${key}: direct insert into p5_batch2_*`).not.toMatch(/\.from\(["']p5_batch2[\w]*["']\)[\s\S]{0,80}\.insert\(/);
      expect(src, `${key}: direct update on p5_batch2_*`).not.toMatch(/\.from\(["']p5_batch2[\w]*["']\)[\s\S]{0,80}\.update\(/);
      expect(src, `${key}: direct delete on p5_batch2_*`).not.toMatch(/\.from\(["']p5_batch2[\w]*["']\)[\s\S]{0,80}\.delete\(/);
      expect(src, `${key}: direct upsert on p5_batch2_*`).not.toMatch(/\.from\(["']p5_batch2[\w]*["']\)[\s\S]{0,80}\.upsert\(/);
    }
  });

  it("ReasonedActionDialog imports only RPC wrappers from the Stage 4 module", () => {
    const src = read(FILES.dialog);
    expect(src).toMatch(/from\s+["']@\/lib\/p5-batch2\/rpc["']/);
    expect(src).toMatch(/p5b2ReviewEvidence/);
    expect(src).toMatch(/p5b2SetProviderState/);
    expect(src).toMatch(/p5b2WaiveEvidence/);
    expect(src).toMatch(/p5b2SuspendRelease/);
    // No supabase.from() table writes
    expect(src).not.toMatch(/supabase\.from\(/);
  });

  it("MaskedField uses p5b2LogSensitiveAccess and requires a reason", () => {
    const src = read(FILES.maskedField);
    expect(src).toMatch(/p5b2LogSensitiveAccess/);
    expect(src).toMatch(/Reason required/);
    expect(src).not.toMatch(/supabase\.from\(/);
  });

  it("ProviderSafeLabel routes through wording guard + safe label catalogue", () => {
    const src = read(FILES.providerLabel);
    expect(src).toMatch(/checkP5B2ProviderWording/);
    expect(src).toMatch(/getP5B2SafeProviderLabel/);
  });

  it("Stage 4 UI contains no raw forbidden provider wording", () => {
    for (const key of ["dashboard", "record", "pack", "snapshot", "dialog", "maskedField", "providerLabel"] as const) {
      const src = read(FILES[key]);
      // Strip imports / comments so we only check rendered strings.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");
      for (const re of FORBIDDEN_WORDING) {
        expect(stripped, `${key}: must not render ${re}`).not.toMatch(re);
      }
    }
  });

  it("Stage 4 UI never selects raw sensitive columns", () => {
    for (const key of ["dashboard", "record", "pack", "snapshot"] as const) {
      const src = read(FILES[key]).toLowerCase();
      for (const col of SENSITIVE_RAW_COLS) {
        expect(src, `${key}: must not select ${col}`).not.toContain(col.toLowerCase());
      }
    }
  });

  it("dashboard renders all required queues", () => {
    const src = read(FILES.dashboard);
    for (const label of [
      "Evidence gaps",
      "Review queue",
      "Provider-dependent",
      "Expiry",
      "Rejected",
      "Bank-detail changes",
      "UBO / high-risk",
    ]) {
      expect(src, `dashboard missing queue: ${label}`).toContain(label);
    }
    expect(src).toMatch(/useP5Batch2Permissions/);
  });

  it("record detail renders checklist, statuses, ratings, timeline and access log sections", () => {
    const src = read(FILES.record);
    expect(src).toContain("evidence-checklist");
    expect(src).toContain("version-history");
    expect(src).toContain("review-timeline");
    expect(src).toContain("sensitive-access-log");
    expect(src).toContain("ReasonedActionDialog");
    expect(src).toContain("MaskedField");
    expect(src).toContain("ProviderSafeLabel");
    // Mandatory/conditional/optional split
    expect(src).toMatch(/mandatory[\s\S]{0,200}conditional[\s\S]{0,200}optional/);
  });

  it("evidence pack viewer renders pack metadata and links to immutable snapshot", () => {
    const src = read(FILES.pack);
    expect(src).toContain("pack_status");
    expect(src).toContain("hash_chain_reference");
    expect(src).toContain("sealed_at");
    expect(src).toContain("/admin/p5-batch2/packs/");
    expect(src).toContain("append-only");
    expect(src).toContain("Raw files are not exposed");
  });

  it("finality snapshot viewer marks pack items append-only and snapshot-based", () => {
    const src = read(FILES.snapshot);
    expect(src).toContain("Append-only");
    expect(src).toContain("snapshot_status");
    expect(src).toContain("snapshot_file_hash");
    expect(src).toContain("immutable");
  });

  it("dialog enforces reason-required actions and customer-safe vs internal note split", () => {
    const src = read(FILES.dialog);
    expect(src).toContain("Reason code is required");
    expect(src).toContain("Customer-safe note");
    expect(src).toContain("Reviewer note (internal)");
    expect(src).toContain("Provider result reference required when provider_live = true");
    // All eight required actions are covered.
    for (const a of [
      "accept", "accept_with_warning", "reject", "request_correction",
      "waive", "suspend", "release", "set_provider_state",
    ]) {
      expect(src, `dialog missing action: ${a}`).toContain(a);
    }
  });

  it("App.tsx exposes the four Stage 4 routes under /admin/p5-batch2 with platform_admin guard", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    for (const path of [
      "/admin/p5-batch2",
      "/admin/p5-batch2/records/:recordId",
      "/admin/p5-batch2/packs",
      "/admin/p5-batch2/packs/:packId",
    ]) {
      expect(app, `route missing: ${path}`).toContain(path);
    }
    // All four routes are wrapped in RequireAuth role="platform_admin".
    const matches = app.match(/\/admin\/p5-batch2[\s\S]{0,400}?<\/RequireAuth>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    for (const m of matches) {
      expect(m).toMatch(/role="platform_admin"/);
    }
  });
});
