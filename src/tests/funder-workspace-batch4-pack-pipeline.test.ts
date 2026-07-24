/**
 * Institutional Funder Evidence Workspace — Batch 4
 * Static guard: sealed PDF pipeline exists and stays inside the V1
 * scope. Verifies:
 *   - two edge functions (generate + download) exist and follow the
 *     rules (no fake success, real PDF bytes, private storage, signed
 *     URLs, no public URLs, no share links);
 *   - migration adds SECURITY DEFINER RPCs that gate consent, active
 *     release and platform-admin;
 *   - admin UI exposes the Generate action;
 *   - funder UI shows a real download button only when permission +
 *     sealed pack are present, and a disabled state otherwise;
 *   - old p5b3_funder_record_download_v1 is untouched;
 *   - no notifications, billing, RFI, comments, decisions, share
 *     links, white-labelling or marketplace surfaces added.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const GEN_FN = join(ROOT, "supabase/functions/funder-pack-generate/index.ts");
const DL_FN = join(ROOT, "supabase/functions/funder-pack-download/index.ts");
const ADMIN_CLIENT = readFileSync(
  join(ROOT, "src/lib/funder-workspace/admin-client.ts"),
  "utf8",
);
const FUNDER_CLIENT = readFileSync(
  join(ROOT, "src/lib/funder-workspace/funder-client.ts"),
  "utf8",
);
const ADMIN_RELEASE_DETAIL = readFileSync(
  join(ROOT, "src/pages/admin/funder-workspace/ReleaseDetail.tsx"),
  "utf8",
);
const FUNDER_DEAL_DETAIL = readFileSync(
  join(ROOT, "src/pages/funder/workspace/DealDetail.tsx"),
  "utf8",
);

// Locate the Batch 4 migration file.
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) =>
  f.endsWith(".sql"),
);
const BATCH4_MIGRATION = migrationFiles
  .map((f) => ({ f, body: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }))
  .find((m) => /fw_admin_seal_pack_v1/.test(m.body));

describe("Funder Workspace Batch 4 — edge functions exist", () => {
  it("both funder-pack-generate and funder-pack-download exist", () => {
    expect(existsSync(GEN_FN), "generate fn").toBe(true);
    expect(existsSync(DL_FN), "download fn").toBe(true);
  });
});

describe("Funder Workspace Batch 4 — generation function", () => {
  const body = readFileSync(GEN_FN, "utf8");

  it("gates on the platform-admin context RPC before touching storage", () => {
    expect(body).toMatch(/fw_admin_pack_generation_context_v1/);
    // context RPC call must occur before storage upload
    const ctxIdx = body.indexOf("fw_admin_pack_generation_context_v1");
    const uploadIdx = body.indexOf(".upload(");
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(ctxIdx);
  });

  it("computes SHA-256 from the PDF bytes (not a placeholder string)", () => {
    expect(body).toMatch(/crypto\.subtle\.digest\("SHA-256",\s*bytes\)/);
    expect(body).toMatch(/pdfBytes\s*=\s*await\s+buildPdf\(/);
    expect(body).toMatch(/sha256Hex\(pdfBytes\)/);
    // The hash goes into fw_admin_seal_pack_v1
    expect(body).toMatch(/p_file_sha256:\s*fileSha256/);
  });

  it("uploads to the private funder-evidence-packs bucket, never public URLs", () => {
    expect(body).toMatch(/const\s+BUCKET\s*=\s*"funder-evidence-packs"/);
    expect(body).toMatch(/\.storage\s*\n?\s*\.from\(BUCKET\)\s*\n?\s*\.upload\(/);
    expect(body).not.toMatch(/getPublicUrl/);
  });

  it("renders every required V1 pack section label into the PDF", () => {
    const required = [
      "Buyer summary",
      "Seller summary",
      "Verification summary",
      "IDV / KYB summary",
      "WaD status",
      "Bank-confidence section",
      "Evidence register",
      "Missing evidence",
      "Risk / exception summary",
      "Finality snapshot",
      "Audit summary",
      "Disclaimer",
      "Hash / seal details",
      "Permission summary",
    ];
    for (const s of required) {
      expect(body, `section "${s}" missing from generated PDF`).toContain(s);
    }
  });

  it("includes a watermark containing IZENZO, org name, deal reference, timestamp and pack id", () => {
    expect(body).toMatch(/IZENZO/);
    expect(body).toMatch(/\{org_name\}/);
    expect(body).toMatch(/\{deal_reference\}/);
    expect(body).toMatch(/\{timestamp\}/);
    expect(body).toMatch(/\{pack_id\}/);
    expect(body).toMatch(/drawText\(wmText/);
  });

  it("records the sealed pack via fw_admin_seal_pack_v1 with real hash + storage", () => {
    expect(body).toMatch(/rpc\(\s*"fw_admin_seal_pack_v1"/);
    expect(body).toMatch(/p_storage_bucket:\s*BUCKET/);
    expect(body).toMatch(/p_storage_path:\s*storagePath/);
  });

  it("cleans up the uploaded PDF if sealing fails (no orphan file)", () => {
    expect(body).toMatch(/\.remove\(\[storagePath\]\)/);
  });

  it("does NOT call the old p5b3_funder_record_download_v1 RPC", () => {
    expect(body).not.toMatch(/p5b3_funder_record_download_v1/);
  });
});

describe("Funder Workspace Batch 4 — download function", () => {
  const body = readFileSync(DL_FN, "utf8");

  it("routes through the authorising RPC before minting a signed URL", () => {
    expect(body).toMatch(/fw_funder_authorize_pack_download_v1/);
    const authIdx = body.indexOf("fw_funder_authorize_pack_download_v1");
    const signIdx = body.indexOf("createSignedUrl");
    expect(authIdx).toBeGreaterThan(-1);
    expect(signIdx).toBeGreaterThan(authIdx);
  });

  it("issues a short-lived signed URL, never a public URL", () => {
    expect(body).toMatch(/SIGNED_URL_TTL_SECONDS\s*=\s*600/);
    expect(body).toMatch(/createSignedUrl\(info\.storage_path,\s*SIGNED_URL_TTL_SECONDS\)/);
    expect(body).not.toMatch(/getPublicUrl/);
  });

  it("returns opaque failure on authorisation error (no internal leak)", () => {
    expect(body).toMatch(/"not_available"/);
  });

  it("does NOT call the old p5b3_funder_record_download_v1 RPC", () => {
    expect(body).not.toMatch(/p5b3_funder_record_download_v1/);
  });
});

describe("Funder Workspace Batch 4 — migration guards", () => {
  it("Batch 4 migration file was created", () => {
    expect(BATCH4_MIGRATION, "batch 4 migration file").toBeDefined();
  });

  it("seal RPC enforces platform_admin, active release, non-expired and consent-or-override", () => {
    const sql = BATCH4_MIGRATION!.body;
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_seal_pack_v1/);
    expect(sql).toMatch(/p5b3_is_platform_admin\(\)/);
    expect(sql).toMatch(/release_status\s*<>\s*'active'/);
    expect(sql).toMatch(/expires_at\s*<=\s*v_now/);
    expect(sql).toMatch(/admin_override_reason/);
    expect(sql).toMatch(/length\(p_file_sha256\)\s*<>\s*64/);
    expect(sql).toMatch(/fw_audit\(\s*'funder_pack\.sealed'/);
    expect(sql).toMatch(/fw_record_usage\([^)]*'pack_generated'/);
  });

  it("download authoriser blocks wrong org, disabled permission, inactive/expired release", () => {
    const sql = BATCH4_MIGRATION!.body;
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.fw_funder_authorize_pack_download_v1/,
    );
    expect(sql).toMatch(/funder_organisation_id\s*<>\s*v_org/);
    expect(sql).toMatch(/NOT v_r\.can_download_compiled_pack/);
    expect(sql).toMatch(/release_status\s*<>\s*'active'/);
    expect(sql).toMatch(/expires_at\s*<=\s*v_now/);
    expect(sql).toMatch(/fw_audit\(\s*'funder_pack\.download_authorized'/);
    expect(sql).toMatch(/fw_record_usage\([^)]*'pack_downloaded'/);
  });

  it("private storage policies scope objects to funder org membership", () => {
    const sql = BATCH4_MIGRATION!.body;
    expect(sql).toMatch(/bucket_id\s*=\s*'funder-evidence-packs'/);
    expect(sql).toMatch(/p5b3_current_funder_org\(\)/);
    expect(sql).toMatch(/can_download_compiled_pack\s+IS\s+TRUE/);
  });

  it("does NOT redefine or touch p5b3_funder_record_download_v1", () => {
    expect(BATCH4_MIGRATION!.body).not.toMatch(/p5b3_funder_record_download_v1/);
  });
});

describe("Funder Workspace Batch 4 — client library", () => {
  it("admin client exposes generateSealedPack that invokes funder-pack-generate", () => {
    expect(ADMIN_CLIENT).toMatch(/export async function generateSealedPack/);
    expect(ADMIN_CLIENT).toMatch(/functions\.invoke\("funder-pack-generate"/);
    // Real success gate — no fake ok.
    expect(ADMIN_CLIENT).toMatch(/if\s*\(!data\?\.ok\)/);
  });

  it("funder client exposes requestPackDownload that invokes funder-pack-download", () => {
    expect(FUNDER_CLIENT).toMatch(/export async function requestPackDownload/);
    expect(FUNDER_CLIENT).toMatch(/functions\.invoke\(\s*\n?\s*"funder-pack-download"/);
    expect(FUNDER_CLIENT).toMatch(/if\s*\(!data\?\.ok\)/);
  });

  it("neither client calls p5b3_funder_record_download_v1", () => {
    expect(ADMIN_CLIENT).not.toMatch(/p5b3_funder_record_download_v1/);
    expect(FUNDER_CLIENT).not.toMatch(/p5b3_funder_record_download_v1/);
  });
});

describe("Funder Workspace Batch 4 — admin UI", () => {
  it("admin release detail exposes a Generate button that calls generateSealedPack", () => {
    expect(ADMIN_RELEASE_DETAIL).toMatch(/data-testid="fw-admin-generate-pack"/);
    expect(ADMIN_RELEASE_DETAIL).toMatch(/generateSealedPack\(releaseId/);
    // Generate button is gated by the shared canGenerateSealedPack helper,
    // which mirrors the server's fw_admin_seal_pack_v1 checks.
    expect(ADMIN_RELEASE_DETAIL).toMatch(/canGenerateSealedPack/);
    expect(ADMIN_RELEASE_DETAIL).toMatch(/disabled=\{generating \|\| !gate\.ok\}/);
  });
});

describe("Funder Workspace Batch 4 — funder UI download gating", () => {
  it("only enables download when the shared packDownloadReadiness helper says ready", () => {
    expect(FUNDER_DEAL_DETAIL).toMatch(/FunderPackDownloadButton/);
    // Positive-path gate is delegated to the SSOT helper so admin + funder
    // surfaces cannot disagree.
    expect(FUNDER_DEAL_DETAIL).toMatch(/packDownloadReadiness\(release, pack\)/);
    // Disabled-state UI when not allowed
    expect(FUNDER_DEAL_DETAIL).toMatch(/Not available/);
    expect(FUNDER_DEAL_DETAIL).toMatch(/fw-download-disabled-/);
  });

  it("does not use window.location redirect or embed the signed URL persistently", () => {
    // Signed URL opens in a new tab; never persisted or embedded as <a href>.
    expect(FUNDER_DEAL_DETAIL).toMatch(/window\.open\(res\.signed_url/);
    expect(FUNDER_DEAL_DETAIL).not.toMatch(/href=\{[^}]*signed_url/);
  });
});

describe("Funder Workspace Batch 4 — scope safety", () => {
  const surfaces = [ADMIN_RELEASE_DETAIL, FUNDER_DEAL_DETAIL, readFileSync(GEN_FN, "utf8"), readFileSync(DL_FN, "utf8")];

  it("no notifications, billing or share-link surfaces introduced by the pack pipeline", () => {
    // Note: RFI, notes/comments and decision workflow surfaces were
    // legitimately added in Batch 5. This scope-safety test remains for
    // the pack pipeline itself.
    for (const s of surfaces) {
      expect(s).not.toMatch(/notification-dispatch/i);
      expect(s).not.toMatch(/paystack|stripe|payfast|paddle/i);
      expect(s).not.toMatch(/\binvoice\b/i);
      expect(s).not.toMatch(/share[-_ ]?link/i);
      expect(s).not.toMatch(/marketplace|discovery/i);
      expect(s).not.toMatch(/white[-_ ]?label|funder\s+logo/i);
    }
  });
});
