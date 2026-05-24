/**
 * DATA-003 Phase 1 — admin-legal-hold edge function WIRING tests.
 *
 * Static source-text proof of:
 *   1. Bearer token + admin.auth.getUser validation
 *   2. has_role(_role:"platform_admin") RBAC gate
 *   3. assertAal2 enforcement on apply/release/list
 *   4. discriminated-union Zod schema with all 10 scope types
 *   5. reason >= 10 chars on apply, released_reason >= 10 chars on release
 *   6. apply: duplicate active hold → 409 LEGAL_HOLD_ALREADY_ACTIVE (idempotent)
 *   7. release: not-active → 409 LEGAL_HOLD_NOT_ACTIVE, not-found → 404
 *   8. canonical audits emitted via LEGAL_HOLD_AUDIT_NAMES.{applied,released}
 *   9. exact success copy returned in response body
 *   10. optimistic-concurrency .eq("status","active") on the UPDATE
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "..", "supabase/functions/admin-legal-hold/index.ts"),
  "utf8",
);

const APPLY_SUCCESS_COPY =
  "Legal hold applied — deletion/anonymisation suspended for this scope.";
const RELEASE_SUCCESS_COPY =
  "Legal hold released — deletion/anonymisation may resume where otherwise permitted.";

describe("admin-legal-hold — auth + RBAC + MFA gating", () => {
  it("requires Bearer Authorization header", () => {
    expect(SRC).toMatch(/Authorization/);
    expect(SRC).toMatch(/Bearer/);
    expect(SRC).toMatch(/return jsonResponse\(req,\s*\{\s*error:\s*"Unauthorised"\s*\},\s*401\)/);
  });

  it("validates token via admin.auth.getUser", () => {
    expect(SRC).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(SRC).toMatch(/error:\s*"Invalid token"/);
  });

  it("checks platform_admin via has_role RPC", () => {
    expect(SRC).toMatch(/\.rpc\(\s*"has_role"\s*,\s*\{[\s\S]*?_role:\s*"platform_admin"/);
    expect(SRC).toMatch(/Platform admin access required/);
    expect(SRC).toMatch(/403/);
  });

  it("enforces AAL2 via assertAal2 (MFA_REQUIRED → 403)", () => {
    expect(SRC).toMatch(/assertAal2\(authHeader/);
    expect(SRC).toMatch(/MFA_REQUIRED/);
    expect(SRC).toMatch(/code:\s*"MFA_REQUIRED"/);
  });

  it("writes admin_audit_logs on RBAC failure / forbidden / unhandled error", () => {
    expect(SRC).toMatch(/admin\.legal_hold\.rbac_check_failed/);
    expect(SRC).toMatch(/admin\.legal_hold\.forbidden/);
    expect(SRC).toMatch(/admin\.legal_hold\.unhandled_error/);
  });
});

describe("admin-legal-hold — Zod schemas", () => {
  it("ApplySchema enforces all 10 scope types", () => {
    for (const s of [
      "user","org","match","engagement","poi",
      "wad","dispute","payment","evidence","record_group",
    ]) {
      expect(SRC).toMatch(new RegExp(`"${s}"`));
    }
  });

  it("ApplySchema requires reason ≥ 10 chars", () => {
    expect(SRC).toMatch(/reason:\s*z\.string\(\)\.trim\(\)\.min\(10/);
  });

  it("ReleaseSchema requires released_reason ≥ 10 chars", () => {
    expect(SRC).toMatch(/released_reason:\s*z\.string\(\)\.trim\(\)\.min\(10/);
  });

  it("uses discriminatedUnion on `action`", () => {
    expect(SRC).toMatch(/discriminatedUnion\(\s*"action"/);
  });

  it("400 Invalid input is returned when parsing fails", () => {
    expect(SRC).toMatch(/Invalid input/);
    expect(SRC).toMatch(/400/);
  });
});

describe("admin-legal-hold — APPLY", () => {
  it("idempotency: existing active hold returns 409 LEGAL_HOLD_ALREADY_ACTIVE", () => {
    expect(SRC).toMatch(/LEGAL_HOLD_ALREADY_ACTIVE/);
    // The idempotent skip writes admin audit
    expect(SRC).toMatch(/admin\.legal_hold\.apply_idempotent_skip/);
    // Returns 409 (not 200, not 201)
    expect(SRC).toMatch(/LEGAL_HOLD_ALREADY_ACTIVE[\s\S]{0,400}409/);
  });

  it("emits canonical data.legal_hold_applied audit on success", () => {
    expect(SRC).toMatch(/writeCanonicalAudit\(\s*admin\s*,\s*LEGAL_HOLD_AUDIT_NAMES\.applied/);
  });

  it("returns exact success copy", () => {
    expect(SRC).toContain(APPLY_SUCCESS_COPY);
  });
});

describe("admin-legal-hold — RELEASE", () => {
  it("404 NOT_FOUND when hold id does not exist", () => {
    expect(SRC).toMatch(/code:\s*"NOT_FOUND"/);
    expect(SRC).toMatch(/404/);
  });

  it("409 LEGAL_HOLD_NOT_ACTIVE when status !== 'active'", () => {
    expect(SRC).toMatch(/LEGAL_HOLD_NOT_ACTIVE/);
    expect(SRC).toMatch(/LEGAL_HOLD_NOT_ACTIVE[\s\S]{0,200}409/);
  });

  it("optimistic concurrency on UPDATE (.eq status active)", () => {
    expect(SRC).toMatch(
      /\.update\(\s*\{[\s\S]{0,400}status:\s*"released"[\s\S]{0,400}\}\)\s*\.eq\(\s*"id",\s*legal_hold_id\s*\)\s*\.eq\(\s*"status",\s*"active"\s*\)/,
    );
  });

  it("emits canonical data.legal_hold_released audit on success", () => {
    expect(SRC).toMatch(/writeCanonicalAudit\(\s*admin\s*,\s*LEGAL_HOLD_AUDIT_NAMES\.released/);
  });

  it("returns exact success copy", () => {
    expect(SRC).toContain(RELEASE_SUCCESS_COPY);
  });
});

describe("admin-legal-hold — LIST", () => {
  it("supports status filter active|released|all", () => {
    expect(SRC).toMatch(/z\.enum\(\["active",\s*"released",\s*"all"\]\)/);
  });

  it("orders by applied_at desc and caps limit at 500", () => {
    expect(SRC).toMatch(/order\(\s*"applied_at"\s*,\s*\{\s*ascending:\s*false/);
    expect(SRC).toMatch(/limit:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(500\)/);
  });

  it("is still admin-gated (no separate non-admin branch)", () => {
    // RBAC + AAL2 happen BEFORE BodySchema.safeParse, so list inherits both.
    const rbacIdx = SRC.indexOf('.rpc("has_role"');
    const parseIdx = SRC.indexOf("BodySchema.safeParse");
    const listIdx = SRC.indexOf('parsed.data.action === "list"');
    expect(rbacIdx).toBeGreaterThan(-1);
    expect(parseIdx).toBeGreaterThan(rbacIdx);
    expect(listIdx).toBeGreaterThan(parseIdx);
  });
});
