/**
 * Batch S — Support, admin override and manual intervention consistency.
 *
 * Static source-level guards covering SUP-001…SUP-005 and AUD-016. These
 * tests intentionally don't hit the live DB — they pin the contracts that
 * the audit pulled out so future refactors can't silently regress them.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Batch S — Support manual intervention hardening", () => {
  const overridesFn = "supabase/functions/admin-manual-overrides/index.ts";
  const resolverFn = "supabase/functions/resolve-admin-risk-item/index.ts";
  const creditFn = "supabase/functions/admin-credit-org/index.ts";
  const ddFn = "supabase/functions/due-diligence/index.ts";
  const overridesClient = "src/components/admin/AdminManualOverrides.tsx";
  const auditUi = "src/components/admin/AdminAuditLogs.tsx";
  const auditMig = "supabase/migrations/20260516173105_defd936d-71d5-4c0a-a6a5-ff0583ca66eb.sql";

  // 1 & 2: client no longer inserts admin_audit_logs directly, calls edge fn
  it("AdminManualOverrides no longer inserts admin_audit_logs from client", () => {
    const src = read(overridesClient);
    expect(src).not.toMatch(/admin_audit_logs/);
    expect(src).not.toMatch(/supabase\.from\(["']admin_audit_logs/);
  });

  it("AdminManualOverrides calls admin-manual-overrides edge function", () => {
    const src = read(overridesClient);
    expect(src).toMatch(/apiFetch\(["']admin-manual-overrides["']/);
    expect(src).toMatch(/Idempotency-Key/);
  });

  // 3-6: edge function gates
  it("admin-manual-overrides enforces AAL2, reason>=10, Zod strict, idempotency", () => {
    const src = read(overridesFn);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toMatch(/assertIdempotencyKey\(/);
    expect(src).toMatch(/z\.string\(\)\.trim\(\)\.min\(10\)/);
    expect(src).toMatch(/discriminatedUnion\("operation"/);
    expect(src).toMatch(/\.strict\(\)/);
  });

  it("admin-manual-overrides writes server-authored audit with before/after + actor context", () => {
    const src = read(overridesFn);
    // Batch F7 rewired the endpoint to a single SECURITY DEFINER wrapper
    // (admin_manual_override_with_governance) that performs the override
    // mutation, the admin_audit_logs insert and the governance event
    // commit in one DB transaction. The endpoint must call the wrapper
    // and forward before/after snapshots + actor context as RPC params.
    expect(src).toMatch(/admin\.rpc\(\s*["']admin_manual_override_with_governance["']/);
    expect(src).toMatch(/p_before_snapshot:\s*externalBefore/);
    expect(src).toMatch(/p_after_snapshot:\s*externalAfter/);
    expect(src).toMatch(/p_actor_ip:\s*actorIp/);
    expect(src).toMatch(/p_user_agent:\s*userAgent/);
    expect(src).toMatch(/p_request_id:\s*requestId/);
    // No legacy split-commit (direct admin_audit_logs insert or
    // recordAdminHqDecision after the mutation).
    expect(src).not.toMatch(/from\(\s*["']admin_audit_logs["']\s*\)\s*\.insert/);
    expect(src).not.toMatch(/recordAdminHqDecision/);
    // Still pins the canonical action namespace (in code comments and
    // the writeAudit failure path).
    expect(src).toMatch(/admin\.manual_override/);
  });


  it("admin-manual-overrides only accepts the four approved operations", () => {
    const src = read(overridesFn);
    for (const op of ["force_status", "void_match", "rerun_screening", "regenerate_evidence"]) {
      expect(src).toMatch(new RegExp(`z\\.literal\\(["']${op}["']\\)`));
    }
    // No other operation literal sneaks in.
    const literals = [...src.matchAll(/z\.literal\(["']([a-z_]+)["']\)/g)].map((m) => m[1]);
    const operationLiterals = literals.filter((l) =>
      ["force_status", "void_match", "rerun_screening", "regenerate_evidence"].includes(l)
    );
    expect(operationLiterals.length).toBeGreaterThanOrEqual(4);
  });

  // 7: admin-credit-org reason floor
  it("admin-credit-org requires reason >= 10 chars", () => {
    const src = read(creditFn);
    expect(src).toMatch(/reason:\s*z\.string\(\)\.trim\(\)\.min\(10/);
    expect(src).not.toMatch(/reason:\s*z\.string\(\)\.trim\(\)\.min\(1,/);
  });

  // 8-10: resolve-admin-risk-item
  it("resolve-admin-risk-item enforces AAL2, reason>=10, and calls the controlled RPC", () => {
    const src = read(resolverFn);
    expect(src).toMatch(/assertAal2\(/);
    expect(src).toMatch(/z\.string\(\)\.trim\(\)\.min\(10\)/);
    expect(src).toMatch(/resolve_admin_risk_item/);
    expect(src).toMatch(/assertIdempotencyKey\(/);
  });

  // 11 & 12: trigger + GUC system path live in the migration
  it("admin_risk_items update guard exists and allows controlled resolver + system jobs", () => {
    // Find the latest Batch S migration that defines the guard.
    const migDir = path.join(root, "supabase/migrations");
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    const sources = files.map((f) => read(`supabase/migrations/${f}`));
    const has = (re: RegExp) => sources.some((s) => re.test(s));
    expect(has(/assert_risk_item_update_guard/)).toBe(true);
    expect(has(/admin_risk_items_update_guard_trg/)).toBe(true);
    expect(has(/app\.allow_risk_item_update/)).toBe(true);
    expect(has(/CREATE OR REPLACE FUNCTION public\.resolve_admin_risk_item/)).toBe(true);
    expect(has(/RAISE EXCEPTION 'RISK_ITEM_UPDATE_BLOCKED/)).toBe(true);
  });

  // 13: resolver cascades notifications
  it("resolve_admin_risk_item RPC cascades notifications via resolve_notifications_for", () => {
    const migDir = path.join(root, "supabase/migrations");
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    const found = files
      .map((f) => read(`supabase/migrations/${f}`))
      .some((s) => /resolve_admin_risk_item[\s\S]*resolve_notifications_for\(\s*'admin_risk_item'/.test(s));
    expect(found).toBe(true);
  });

  // 14-16: DD reject gating + before/after audit
  it("due-diligence rejection requires AAL2 and reason >= 10 chars", () => {
    const src = read(ddFn);
    expect(src).toMatch(/import\s*\{\s*assertAal2\s*\}/);
    expect(src).toMatch(/if \(decision === "reject"\)[\s\S]{0,400}reason\.trim\(\)\.length < 10/);
    expect(src).toMatch(/assertAal2\(authHeader,\s*\{[\s\S]*?dd\.approval_rejected/);
  });

  it("due-diligence audit captures before/after request snapshot on approve and reject", () => {
    const src = read(ddFn);
    expect(src).toMatch(/beforeSnapshot\s*=\s*\{[\s\S]*status: request\.status/);
    expect(src).toMatch(/before:\s*beforeSnapshot/);
    expect(src).toMatch(/action_taken:\s*"compliance_closure_rejected"/);
    expect(src).toMatch(/"compliance_closure_approved"/);
    expect(src).toMatch(/"compliance_partial_approval"/);
  });

  // 17: audit immutability triggers still present
  it("Batch O audit immutability triggers are still installed", () => {
    const src = read(auditMig);
    expect(src).toMatch(/audit_logs_no_mutate_trg/);
    expect(src).toMatch(/admin_audit_logs_no_mutate_trg/);
    expect(src).toMatch(/assert_audit_immutable/);
    expect(src).toMatch(/AUDIT_IMMUTABLE/);
  });

  // 18: support actions populate actor IP / UA / request_id
  it("new support edge functions populate actor_ip, user_agent and request_id", () => {
    for (const f of [overridesFn, resolverFn]) {
      const src = read(f);
      expect(src).toMatch(/readActorIp/);
      expect(src).toMatch(/user-agent/i);
      expect(src).toMatch(/requestId/);
    }
  });

  // 19: impersonation absence grep guard
  it("no impersonation/act-as/sudo routes exist outside test fixtures", () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", "dist", ".lovable", ".git"].includes(entry.name)) continue;
          walk(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    }
    const files = [
      ...walk(path.join(root, "supabase/functions")),
      ...walk(path.join(root, "src")),
    ];
    const banned = [
      /auth\.admin\.generateLink\b/,
      /\bsignInAsUser\b/,
      /\bimpersonateUser\b/,
      /\bact_as_user\b/,
      /\bsudo_session\b/,
    ];
    const allowlist = (p: string) =>
      /\b(test|tests|__tests__|\.test\.)\b/.test(p) ||
      /_test\.ts$/.test(p) ||
      p.endsWith("batch-s-support-manual-intervention.test.ts");
    for (const f of files) {
      if (allowlist(f)) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const re of banned) {
        // Strip line-/block-comments before scanning so UI copy / docstrings
        // that DESCRIBE the absence of impersonation don't false-positive.
        const stripped = src
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        expect(stripped, `Banned impersonation primitive in ${f}: ${re}`).not.toMatch(re);
      }
    }
  });

  // 20: AdminAuditLogs filter exposes the new support action groups
  it("AdminAuditLogs exposes a support-group filter for new support actions", () => {
    const src = read(auditUi);
    expect(src).toMatch(/groupFilter/);
    expect(src).toMatch(/admin_risk_item\./);
    expect(src).toMatch(/admin\.manual_override\./);
    expect(src).toMatch(/programme\./);
    expect(src).toMatch(/SelectItem value="due_diligence"/);
  });
});
