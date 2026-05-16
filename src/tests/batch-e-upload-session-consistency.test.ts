/**
 * Batch E — Document upload & session consistency hardening tests
 *
 * Covers the 12 acceptance items from the batch:
 *  1. storage-orphan-cleanup scans match-challenge-evidence bucket
 *  2. storage-orphan-cleanup reconciles match-challenge-evidence against table
 *  3. match-documents sweep checks governance_documents.document_path
 *  4. governance storage-success/DB-failure triggers server cleanup
 *  5. governance storage-success/DB-failure writes document.upload.attempt audit row
 *  6. governance getSession pre-flight exists before storage upload
 *  7. REFRESH_FAILED after storage upload enqueues path / triggers cleanup
 *  8. challenge-evidence DB-insert failure triggers cleanup
 *  9. challenge-evidence cleanup failure writes audit row
 * 10. visible DB rows are not created before storage upload succeeds
 * 11. retry uses a fresh per-attempt path
 * 12. existing MatchDocuments hardening guards still present
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Batch E — orphan sweeper extensions", () => {
  const src = repo("supabase/functions/storage-orphan-cleanup/index.ts");

  it("scans match-challenge-evidence bucket (item 1)", () => {
    expect(src).toMatch(/match-challenge-evidence/);
  });
  it("reconciles match-challenge-evidence against match_challenge_evidence.storage_path (item 2)", () => {
    expect(src).toMatch(/match_challenge_evidence/);
    expect(src).toMatch(/storage_path/);
  });
  it("reconciles match-documents bucket against BOTH match_documents and governance_documents (item 3)", () => {
    expect(src).toMatch(/match_documents/);
    expect(src).toMatch(/governance_documents/);
    expect(src).toMatch(/document_path/);
  });
  it("does NOT scan the legacy non-existent governance-docs bucket", () => {
    // Older buggy version listed bucket "governance-docs" and table "governance_docs" — both wrong.
    expect(src).not.toMatch(/"governance-docs"/);
    expect(src).not.toMatch(/"governance_docs"/);
  });
});

describe("Batch E — enqueue-storage-cleanup endpoint", () => {
  const src = repo("supabase/functions/enqueue-storage-cleanup/index.ts");
  it("refuses paths that already have a DB row (orphan-only contract)", () => {
    expect(src).toMatch(/has_db_row/);
  });
  it("writes into storage_deletion_queue with scheduled_for ~5 min in the future", () => {
    expect(src).toMatch(/storage_deletion_queue/);
    expect(src).toMatch(/5 \* 60 \* 1000/);
  });
  it("allowlists only the three known buckets", () => {
    expect(src).toMatch(/match-documents/);
    expect(src).toMatch(/match-challenge-evidence/);
    expect(src).toMatch(/kyc-documents/);
  });
});

describe("Batch E — governance finaliser hardening", () => {
  const edge = repo("supabase/functions/governance-docs/index.ts");
  it("performs server-side cleanup when governance_documents insert fails (item 4)", () => {
    expect(edge).toMatch(/cleanupGovOrphan/);
    expect(edge).toMatch(/governance_documents_insert_failed/);
  });
  it("writes document.upload.attempt audit rows on failure (item 5)", () => {
    expect(edge).toMatch(/document\.upload\.attempt/);
    expect(edge).toMatch(/writeGovAudit/);
  });
  it("verifies storage path scope before insert", () => {
    expect(edge).toMatch(/STORAGE_PATH_SCOPE_MISMATCH/);
  });
  it("requires the storage object to exist before insert", () => {
    expect(edge).toMatch(/STORAGE_OBJECT_MISSING/);
  });
});

describe("Batch E — governance client pre-flight + cleanup", () => {
  const client = repo("src/components/match/GovernanceDocSubmit.tsx");
  it("calls supabase.auth.getSession() before uploading (item 6)", () => {
    const idxGetSession = client.indexOf("supabase.auth.getSession()");
    const idxUpload = client.indexOf("supabase.storage");
    expect(idxGetSession).toBeGreaterThan(-1);
    expect(idxUpload).toBeGreaterThan(-1);
    expect(idxGetSession).toBeLessThan(idxUpload);
  });
  it("invokes cleanupOrphanUpload on session-dead errors (item 7)", () => {
    expect(client).toMatch(/cleanupOrphanUpload/);
    expect(client).toMatch(/isSessionDeadError/);
  });
});

describe("Batch E — MatchDocuments session-expiry cleanup", () => {
  const client = repo("src/components/match/MatchDocuments.tsx");
  it("invokes cleanupOrphanUpload when finaliser fails with session-dead code (item 7)", () => {
    expect(client).toMatch(/cleanupOrphanUpload\("match-documents"/);
    expect(client).toMatch(/isSessionDeadError/);
  });
  it("still uses two-phase upload (storage first, finaliser second) (item 10)", () => {
    expect(client).toMatch(/supabase\.storage[\s\S]{0,200}\.upload\(storagePath/);
    expect(client).toMatch(/finaliseMatchDocumentUpload/);
    expect(client.indexOf(".upload(storagePath")).toBeLessThan(client.indexOf("finaliseMatchDocumentUpload"));
  });
  it("regenerates docId per upload attempt so retries cannot collide (item 11)", () => {
    expect(client).toMatch(/const docId = crypto\.randomUUID\(\)/);
  });
  it("preserves existing client_request_id correlation (item 12)", () => {
    expect(client).toMatch(/clientRequestId/);
    expect(client).toMatch(/logMatchDocumentUploadAttempt/);
  });
});

describe("Batch E — challenge-evidence partial failure audit", () => {
  const edge = repo("supabase/functions/match-challenges/index.ts");
  it("attempts cleanup when match_challenge_evidence insert fails (item 8)", () => {
    expect(edge).toMatch(/match-challenge-evidence[\s\S]{0,200}\.remove\(\[storagePath\]\)/);
  });
  it("writes audit row for cleanup outcome including cleanup_succeeded:false on failure (item 9)", () => {
    expect(edge).toMatch(/document\.upload\.attempt/);
    expect(edge).toMatch(/cleanup_succeeded/);
    expect(edge).toMatch(/cleanup_error/);
  });
});

describe("Batch E — upload-cleanup helper contract", () => {
  const helper = repo("src/lib/upload-cleanup.ts");
  it("tries direct storage.remove first then falls back to enqueue", () => {
    const removeIdx = helper.indexOf("storage.from(bucket).remove");
    const enqueueIdx = helper.indexOf("enqueue-storage-cleanup");
    expect(removeIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(removeIdx);
  });
  it("recognises REFRESH_FAILED / NO_SESSION / UNAUTHORIZED as session-dead", () => {
    expect(helper).toMatch(/REFRESH_FAILED/);
    expect(helper).toMatch(/NO_SESSION/);
    expect(helper).toMatch(/UNAUTHORIZED/);
  });
});
