/**
 * Batch L — Document Authority, Evidence and Upload Validation
 *
 * Static contract tests covering the 17 acceptance points. These are
 * file/string-level invariants (not Deno edge-fn runtime tests). Runtime
 * tests live alongside the edge functions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  inspectStructuralReadability,
} from "../../supabase/functions/_shared/magic-bytes.ts";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("Batch L — Document evidence validation", () => {
  // 1, 2 — doc_type is constrained and dialog requires it
  it("DOC-001: client taxonomy matches server taxonomy + dialog requires selection", () => {
    const client = read("src/components/match/MatchDocuments.tsx");
    expect(client).toMatch(/bill_of_lading/);
    expect(client).toMatch(/letter_of_credit/);
    expect(client).toMatch(/ALLOWED_DOC_TYPES\.has\(docType\)/);
    expect(client).toMatch(/Document type \*/);
    const fn = read("supabase/functions/finalise-match-document-upload/index.ts");
    expect(fn).toMatch(/z\.enum\(DOC_TYPES\)/);
    expect(fn).toMatch(/"bill_of_lading", "invoice", "letter_of_credit", "kyc", "licence", "other"/);
  });

  // 3 — legacy/unknown doc_type renders safely
  it("DOC-001: legacy doc_type values fall back to label-or-raw", () => {
    const client = read("src/components/match/MatchDocuments.tsx");
    expect(client).toMatch(/DOC_TYPES\.find\(\(t\) => t\.value === doc\.doc_type\)\?\.label \|\| doc\.doc_type/);
  });

  // 4, 5 — corrupt PDF rejected as FILE_UNREADABLE
  it("DOC-002: PDF with valid header but missing %%EOF is rejected", () => {
    const goodPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34,
      ...new Array(20).fill(0x20),
      0x25, 0x25, 0x45, 0x4F, 0x46]);
    expect(inspectStructuralReadability(goodPdf, "application/pdf").readable).toBe(true);

    const corruptPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34,
      ...new Array(200).fill(0x20)]);
    const r = inspectStructuralReadability(corruptPdf, "application/pdf");
    expect(r.readable).toBe(false);
    expect(r.reason).toMatch(/EOF/);
  });

  it("DOC-002: corrupt PNG/JPEG missing end marker is rejected", () => {
    const truncatedPng = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
    expect(inspectStructuralReadability(truncatedPng, "image/png").readable).toBe(false);
    const truncatedJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0]);
    expect(inspectStructuralReadability(truncatedJpeg, "image/jpeg").readable).toBe(false);
  });

  it("DOC-002: edge fn surfaces typed FILE_UNREADABLE + audits + cleans up", () => {
    const fn = read("supabase/functions/finalise-match-document-upload/index.ts");
    expect(fn).toMatch(/inspectStructuralReadability/);
    expect(fn).toMatch(/"FILE_UNREADABLE"/);
    expect(fn).toMatch(/server_readability_check_failed/);
    expect(fn).toMatch(/ApiException\(\s*"FILE_UNREADABLE"/);
  });

  // 6, 7 — expired exclusion in POI gate + match-evidence-counts
  it("DOC-003: atomic_generate_poi_v2 excludes expired/deleted docs from per-side count", () => {
    const dir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql"));
    const hit = files.find((f: string) => {
      const c = read(`supabase/migrations/${f}`);
      return c.includes("idx_match_documents_dedup_active") && c.includes("atomic_generate_poi_v2");
    });
    expect(hit).toBeDefined();
  });

  it("DOC-003: per-side count filter excludes deleted/archived/expired + expiry_date > now", () => {
    const dir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql"));
    const hit = files.find((f: string) => {
      const c = read(`supabase/migrations/${f}`);
      return c.includes("idx_match_documents_dedup_active") && c.includes("atomic_generate_poi_v2");
    });
    const sql = read(`supabase/migrations/${hit!}`);
    expect(sql).toMatch(/status NOT IN \('deleted','archived','expired'\)/);
    expect(sql).toMatch(/expiry_date IS NULL OR expiry_date > now\(\)/);
    expect(sql).toMatch(/match_documents_doc_type_check/);
  });

  it("DOC-003: match-evidence-counts excludes expired + deleted from per-side counts", () => {
    const fn = read("supabase/functions/match-evidence-counts/index.ts");
    expect(fn).toMatch(/expiry_date\.is\.null,expiry_date\.gt\./);
    expect(fn).toMatch(/\(deleted,archived,expired\)/);
  });

  // 8, 9, 10 — duplicate DB guard + cleanup + audit
  it("DOC-005: 23505 mapped to typed DUPLICATE_DOCUMENT with cleanup + audit", () => {
    const fn = read("supabase/functions/finalise-match-document-upload/index.ts");
    expect(fn).toMatch(/insertError\?\.code === "23505"/);
    expect(fn).toMatch(/"DUPLICATE_DOCUMENT"/);
    expect(fn).toMatch(/cleanup\("duplicate_document_blocked"\)/);
    expect(fn).toMatch(/db_insert_result: "duplicate"/);
    expect(fn).toMatch(/409/);
  });

  // 11, 12, 13, 14 — wrong org/match/non-participant/side regression freeze
  it("DOC-004: storage path scope + participant + side checks remain in place", () => {
    const fn = read("supabase/functions/finalise-match-document-upload/index.ts");
    expect(fn).toMatch(/STORAGE_PATH_SCOPE_MISMATCH/);
    expect(fn).toMatch(/pathOrgId !== authCtx\.orgId/);
    expect(fn).toMatch(/pathMatchId !== body\.match_id/);
    expect(fn).toMatch(/ORG_NOT_PARTICIPANT/);
    expect(fn).toMatch(/uploader_org_id: authCtx\.orgId/);
    const validator = read("supabase/functions/validate-upload/index.ts");
    expect(validator).toMatch(/pathOrgId !== authCtx\.orgId/);
  });

  // 15 — cross-match same SHA: each match has its own storage path (no shared link)
  it("DOC-005: dedup index is scoped to (match_id, uploader_org_id, sha256_hash)", () => {
    const dir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql"));
    const matches = files.filter((f: string) =>
      read(`supabase/migrations/${f}`).includes("idx_match_documents_dedup_active"),
    );
    expect(matches.length).toBeGreaterThan(0);
    const sql = read(`supabase/migrations/${matches[0]}`);
    expect(sql).toMatch(/\(match_id, uploader_org_id, sha256_hash\)/);
    expect(sql).toMatch(/WHERE status NOT IN \('deleted','archived'\)/);
  });

  // 16, 17 — no unaudited evidence override path exists
  it("AUD-008: no broad evidence-override edge function exists; existing override surfaces are audited", () => {
    const fnDir = resolve(process.cwd(), "supabase/functions");
    const entries = readdirSync(fnDir);
    expect(entries.includes("evidence-override")).toBe(false);
    const review = read("supabase/functions/document-review/index.ts");
    expect(review).toMatch(/audit_logs/);
    const revoke = read("supabase/functions/document-revoke/index.ts");
    expect(revoke).toMatch(/audit_logs/);
  });
});
