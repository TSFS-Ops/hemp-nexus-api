/**
 * Batch L (tracker #26) — POI sealed snapshot drift fix, static guards.
 *
 * The deal-certificate edge function must source certificate commercial/POI
 * fields from wads.evidence_bundle.poi_snapshot when a sealed, non-revoked
 * WaD is linked, and fall back to the live matches row when no sealed WaD
 * exists or the snapshot is missing/malformed. The seal-hash formula and
 * payload key names/ordering must be unchanged.
 *
 * This is a source-level guard — no runtime, no DB. Runtime behaviour is
 * separately covered when the edge function is exercised end-to-end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SRC_PATH = resolve(
  process.cwd(),
  "supabase/functions/deal-certificate/index.ts",
);
const SRC = readFileSync(SRC_PATH, "utf8");

describe("Batch L — deal-certificate uses sealed poi_snapshot", () => {
  it("declares the pickCertifiedFields helper with the two source labels", () => {
    expect(SRC).toMatch(/function\s+pickCertifiedFields\s*\(/);
    expect(SRC).toMatch(/"sealed_wad_poi_snapshot"/);
    expect(SRC).toMatch(/"live_match_fallback"/);
  });

  it("helper reads evidence_bundle.poi_snapshot from the linked WaD", () => {
    expect(SRC).toMatch(/evidence_bundle/);
    expect(SRC).toMatch(/poi_snapshot/);
  });

  it("helper gates on linkedWad.status === \"sealed\"", () => {
    expect(SRC).toMatch(/linkedWad\.status\s*!==\s*"sealed"/);
  });

  it("maps commodity/quantity/price/terms/buyer/seller/settled_at from snapshot", () => {
    // Field mapping lines
    for (const line of [
      /commodity:\s*snap\.commodity/,
      /quantity_amount:\s*quantity\?\.amount/,
      /quantity_unit:\s*quantity\?\.unit/,
      /price_amount:\s*price\?\.amount/,
      /price_currency:\s*price\?\.currency/,
      /terms:\s*snap\.terms/,
      /buyer_name:\s*buyer\?\.name/,
      /seller_name:\s*seller\?\.name/,
      /settled_at:\s*snap\.settled_at/,
      /hash:\s*snap\.hash/,
    ]) {
      expect(SRC).toMatch(line);
    }
  });

  it("overlays snapshot onto match via certifiedMatch and passes it to sealPayload + HTML", () => {
    expect(SRC).toMatch(/const\s+certifiedMatch\s*:\s*Record<string,\s*unknown>\s*=\s*\{\s*\.\.\.match,\s*\.\.\.poiSource\.fields\s*\}/);
    // sealPayload keys read from certifiedMatch, not match.
    expect(SRC).toMatch(/sealPayload\s*=\s*\{[\s\S]*commodity:\s*certifiedMatch\.commodity[\s\S]*settled_at:\s*certifiedMatch\.settled_at[\s\S]*\}/);
    expect(SRC).toMatch(/generateCertificateHtml\(\s*certifiedMatch,/);
  });

  it("preserves the seal-hash formula and payload field names/ordering", () => {
    // Ordering: match_id → buyer_name → buyer_org_id → seller_name →
    // seller_org_id → commodity → quantity_amount → quantity_unit →
    // price_amount → price_currency → terms → settled_at.
    const payloadBlock = SRC.match(/const\s+sealPayload\s*=\s*\{[\s\S]*?\};/);
    expect(payloadBlock, "sealPayload literal must exist").toBeTruthy();
    const keys = [
      "match_id",
      "buyer_name",
      "buyer_org_id",
      "seller_name",
      "seller_org_id",
      "commodity",
      "quantity_amount",
      "quantity_unit",
      "price_amount",
      "price_currency",
      "terms",
      "settled_at",
    ];
    let cursor = 0;
    for (const k of keys) {
      const idx = payloadBlock![0].indexOf(k, cursor);
      expect(idx, `sealPayload must contain key "${k}" in canonical order`).toBeGreaterThan(-1);
      cursor = idx + k.length;
    }
    // Same hash function used.
    expect(SRC).toMatch(/sha256Hex\(\s*canonicalStringify\(\s*sealPayload\s*\)\s*\)/);
  });

  it("audit log records poi_source and wad_id", () => {
    expect(SRC).toMatch(/poi_source:\s*poiSource\.source/);
    expect(SRC).toMatch(/wad_id:\s*linkedWad\?\.id\s*\?\?\s*null/);
  });

  it("falls back to live match when no linked WaD (helper returns live_match_fallback for null/revoked)", () => {
    // Text-level check on the early returns
    expect(SRC).toMatch(/if\s*\(\s*!linkedWad\s*\|\|\s*linkedWad\.status\s*!==\s*"sealed"\s*\)\s*return\s+fallback/);
    expect(SRC).toMatch(/if\s*\(\s*!snap\s*\|\|\s*typeof\s+snap\s*!==\s*"object"\s*\)\s*return\s+fallback/);
    // Malformed snapshot fallback
    expect(SRC).toMatch(/typeof\s+snap\.commodity\s*!==\s*"string"/);
  });

  it("does not introduce a new hashing function or replace sha256Hex/canonicalStringify", () => {
    expect(SRC).toMatch(/function\s+sha256Hex\s*\(/);
    expect(SRC).toMatch(/function\s+canonicalStringify\s*\(/);
    // No alternative digest libraries pulled in.
    expect(SRC).not.toMatch(/from\s+["']https?:\/\/[^"']*sha3/i);
    expect(SRC).not.toMatch(/createHash\s*\(/);
  });
});

describe("Batch L — out-of-scope files untouched", () => {
  it("no migration file mentions pickCertifiedFields or the Batch L helper", () => {
    const migDir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    for (const f of files) {
      const full = resolve(migDir, f);
      if (!statSync(full).isFile()) continue;
      const sql = readFileSync(full, "utf8");
      expect(sql, `migration ${f} must not reference the Batch L helper`).not.toMatch(
        /pickCertifiedFields/,
      );
    }
  });

  it("does not modify the wad sealing edge function", () => {
    const wad = readFileSync(
      resolve(process.cwd(), "supabase/functions/wad/index.ts"),
      "utf8",
    );
    // wad/index.ts still writes poi_snapshot at seal — untouched contract.
    expect(wad).toMatch(/poi_snapshot:\s*\{/);
    expect(wad).not.toMatch(/pickCertifiedFields/);
  });
});
