/**
 * Facilitation Batch 10 — Evidence-Pack SHA-256 Seal unit tests.
 *
 * Pure helper coverage. No edge-function network calls.
 *
 * What this proves:
 *   1. identical pack → identical digest
 *   2. any field change → digest changes
 *   3. canonical key ordering is deterministic regardless of insertion order
 *   4. empty array `[]` and missing field produce DIFFERENT digests
 *   5. digest is SHA-256 hex (64 lowercase hex chars)
 *   6. canonical_bytes is stable, positive, and matches UTF-8 length of canonical JSON
 *   7. seal envelope shape passes isEvidencePackSeal
 *   8. sealEvidencePack does NOT mutate the input pack
 *   9. cycles are rejected
 *  10. canonical audit name `facilitation_case.evidence_pack_sealed` is pinned in browser SSOT
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalJsonStringify,
  sha256OfCanonicalPack,
  sealEvidencePack,
  isEvidencePackSeal,
  SEAL_ALGO,
  SEAL_FUNCTION_VERSION,
} from "../../supabase/functions/_shared/evidence-pack-seal.ts";
import { FACILITATION_AUDIT_NAMES } from "@/lib/facilitation-case-state";

const samplePack = {
  pack_version: "1.0",
  generated_at: "2026-06-19T00:00:00.000Z",
  case_summary: { case_number: "FAC-2026-0007", current_status: "admin_reviewing" },
  intake: { counterparty_legal_name: "Evidence Counterparty (FIXTURE)", counterparty_country: "ZA" },
  status_history: [{ at: "2026-06-19T00:00:00.000Z", from_status: "new", to_status: "admin_reviewing" }],
  evidence_files: [],
};

describe("Batch 10 — evidence-pack seal helper", () => {
  it("(1) identical pack → identical digest", async () => {
    const a = await sha256OfCanonicalPack(samplePack);
    const b = await sha256OfCanonicalPack(structuredClone(samplePack));
    expect(a.digest_hex).toBe(b.digest_hex);
    expect(a.canonical_bytes).toBe(b.canonical_bytes);
  });

  it("(2) any field change → digest changes", async () => {
    const base = await sha256OfCanonicalPack(samplePack);
    const mutated = structuredClone(samplePack);
    mutated.case_summary.current_status = "closed";
    const after = await sha256OfCanonicalPack(mutated);
    expect(after.digest_hex).not.toBe(base.digest_hex);
  });

  it("(3) canonical key ordering is deterministic regardless of insertion order", async () => {
    const a = { b: 1, a: 2, c: { y: 3, x: 4 } };
    const b = { c: { x: 4, y: 3 }, a: 2, b: 1 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    const da = await sha256OfCanonicalPack(a);
    const db = await sha256OfCanonicalPack(b);
    expect(da.digest_hex).toBe(db.digest_hex);
  });

  it("(4) empty array vs missing field produce DIFFERENT digests", async () => {
    const withEmpty = await sha256OfCanonicalPack({ evidence_files: [] });
    const without   = await sha256OfCanonicalPack({});
    expect(withEmpty.digest_hex).not.toBe(without.digest_hex);
    expect(canonicalJsonStringify({ evidence_files: [] })).toBe('{"evidence_files":[]}');
    expect(canonicalJsonStringify({})).toBe("{}");
  });

  it("(5) digest is SHA-256 hex (64 lowercase hex chars)", async () => {
    const sealed = await sealEvidencePack(samplePack);
    expect(sealed.seal.digest_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.seal.algo).toBe(SEAL_ALGO);
    expect(SEAL_ALGO).toBe("sha-256");
  });

  it("(6) canonical_bytes is stable, positive, and matches UTF-8 length of canonical JSON", async () => {
    const canonical = canonicalJsonStringify(samplePack);
    const expectedBytes = new TextEncoder().encode(canonical).byteLength;
    const sealed = await sealEvidencePack(samplePack);
    expect(sealed.seal.canonical_bytes).toBe(expectedBytes);
    expect(sealed.seal.canonical_bytes).toBeGreaterThan(0);
  });

  it("(7) seal envelope shape passes isEvidencePackSeal", async () => {
    const sealed = await sealEvidencePack(samplePack, { now: () => new Date("2026-06-19T12:00:00Z") });
    expect(isEvidencePackSeal(sealed.seal)).toBe(true);
    expect(sealed.seal.sealed_at).toBe("2026-06-19T12:00:00.000Z");
    expect(sealed.seal.function_version).toBe(SEAL_FUNCTION_VERSION);
  });

  it("(7b) isEvidencePackSeal rejects malformed seals", () => {
    expect(isEvidencePackSeal(null)).toBe(false);
    expect(isEvidencePackSeal({})).toBe(false);
    expect(isEvidencePackSeal({ algo: "md5", digest_hex: "x".repeat(64), canonical_bytes: 1, sealed_at: new Date().toISOString(), function_version: "v" })).toBe(false);
    expect(isEvidencePackSeal({ algo: "sha-256", digest_hex: "ZZ", canonical_bytes: 1, sealed_at: new Date().toISOString(), function_version: "v" })).toBe(false);
    expect(isEvidencePackSeal({ algo: "sha-256", digest_hex: "a".repeat(64), canonical_bytes: 0, sealed_at: new Date().toISOString(), function_version: "v" })).toBe(false);
    expect(isEvidencePackSeal({ algo: "sha-256", digest_hex: "a".repeat(64), canonical_bytes: 1, sealed_at: "not a date", function_version: "v" })).toBe(false);
  });

  it("(8) sealEvidencePack does NOT mutate the input pack", async () => {
    const before = JSON.stringify(samplePack);
    await sealEvidencePack(samplePack);
    expect(JSON.stringify(samplePack)).toBe(before);
  });

  it("(8b) digest is computed over the PACK body, not the envelope", async () => {
    // If the digest were over the envelope it would change when sealed_at changed.
    const s1 = await sealEvidencePack(samplePack, { now: () => new Date("2026-06-19T00:00:00Z") });
    const s2 = await sealEvidencePack(samplePack, { now: () => new Date("2027-01-01T00:00:00Z") });
    expect(s1.seal.digest_hex).toBe(s2.seal.digest_hex);
    expect(s1.seal.sealed_at).not.toBe(s2.seal.sealed_at);
  });

  it("(9) cycles are rejected", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalJsonStringify(cyclic)).toThrow(/cycle/);
  });

  it("(10) canonical audit name `facilitation_case.evidence_pack_sealed` is pinned in browser SSOT", () => {
    expect(FACILITATION_AUDIT_NAMES).toContain("facilitation_case.evidence_pack_sealed");
  });

  it("(11) edge function response shape: { pack, seal } — verified by reading source", () => {
    // The seal-contract guard checks this at lint time; this test pins the
    // expected response envelope at test time too.
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/facilitation-export-evidence-pack/index.ts"), "utf8");
    expect(src).toMatch(/sealEvidencePack\(/);
    expect(src).toMatch(/return json\(req,\s*sealed,\s*200/);
    expect(src).not.toMatch(/return json\(req,\s*pack,\s*200/);
    expect(src).toContain('"facilitation_case.evidence_pack_sealed"');
  });
});
