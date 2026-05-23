/**
 * DATA-010 Phase 1 — every admin export target must require AAL2.
 *
 * Source-level pins on supabase/functions/export-audit/index.ts and
 * supabase/functions/aal-preflight/index.ts to prove:
 *   1. `export.admin_pii_export` is registered as `aal2` in the
 *      SEC-001 preflight registry.
 *   2. The export-audit function calls `assertAal2` with the canonical
 *      action key on every sensitive export (default-sensitive, with an
 *      empty allowlist).
 *   3. The function performs a server-side `is_admin` check before
 *      processing the request body.
 *   4. All three canonical DATA-010 audit names are emitted:
 *        data.admin_export_requested
 *        data.admin_export_blocked_or_declined
 *        data.admin_export_generated
 *   5. Server validates `purpose` against the shared EXPORT_PURPOSES
 *      enum and enforces `MIN_EXPORT_REASON_LENGTH`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const EXPORT_AUDIT_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/export-audit/index.ts"),
  "utf8",
);
const AAL_PREFLIGHT_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/aal-preflight/index.ts"),
  "utf8",
);

describe("DATA-010 — AAL2 + admin gate are universal for admin exports", () => {
  it("registers export.admin_pii_export as aal2 in the SEC-001 preflight registry", () => {
    expect(AAL_PREFLIGHT_SRC).toMatch(/"export\.admin_pii_export"\s*:\s*"aal2"/);
  });

  it("calls assertAal2 with the canonical export action key", () => {
    expect(EXPORT_AUDIT_SRC).toMatch(/assertAal2\s*\(/);
    expect(EXPORT_AUDIT_SRC).toMatch(/action:\s*"export\.admin_pii_export"/);
  });

  it("enforces a default-sensitive policy (empty NON_SENSITIVE_TARGETS allowlist)", () => {
    // Match the declaration and confirm the Set body is empty (only
    // contains comments/whitespace). This guards against accidental
    // privacy-review-skipping additions.
    const m = EXPORT_AUDIT_SRC.match(
      /NON_SENSITIVE_TARGETS\s*=\s*new\s+Set<string>\(\[([\s\S]*?)\]\)/,
    );
    expect(m, "NON_SENSITIVE_TARGETS declaration not found").toBeTruthy();
    const body = (m![1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .trim();
    expect(body).toBe("");
  });

  it("performs a server-side is_admin RPC check before processing the body", () => {
    expect(EXPORT_AUDIT_SRC).toMatch(/rpc\(\s*"is_admin"\s*,/);
    // The 403 + canonical decline reason must be present.
    expect(EXPORT_AUDIT_SRC).toMatch(/NOT_PLATFORM_ADMIN/);
  });

  it("emits all three canonical DATA-010 audit names", () => {
    expect(EXPORT_AUDIT_SRC).toContain("data.admin_export_requested");
    expect(EXPORT_AUDIT_SRC).toContain("data.admin_export_blocked_or_declined");
    expect(EXPORT_AUDIT_SRC).toContain("data.admin_export_generated");
  });

  it("imports the shared EXPORT_PURPOSES enum and MIN_EXPORT_REASON_LENGTH", () => {
    expect(EXPORT_AUDIT_SRC).toMatch(
      /from\s+"\.\.\/_shared\/export-purpose\.ts"/,
    );
    expect(EXPORT_AUDIT_SRC).toMatch(/EXPORT_PURPOSES/);
    expect(EXPORT_AUDIT_SRC).toMatch(/MIN_EXPORT_REASON_LENGTH/);
  });

  it("returns MFA_REQUIRED with aal_required:true on the AAL gate", () => {
    expect(EXPORT_AUDIT_SRC).toMatch(/code:\s*"MFA_REQUIRED"/);
    expect(EXPORT_AUDIT_SRC).toMatch(/aal_required:\s*true/);
  });
});
