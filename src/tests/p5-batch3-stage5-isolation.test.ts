/**
 * P-5 Batch 3 — Stage 5 static isolation tests.
 *
 * Drives the Stage 5 shell guard and re-asserts that Stages 1–4 still pass
 * with the new funder surfaces in place.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("P5 Batch 3 Stage 5 — isolation guards", () => {
  it("Stage 5 isolation guard passes", () => {
    const out = execSync("node scripts/check-p5-batch3-stage5-isolation.mjs", { encoding: "utf8" });
    expect(out).toMatch(/P5_BATCH_3_STAGE_5_ISOLATION_OK/);
  });

  it("Stage 1/2/3/4 isolation guards still pass after Stage 5 lands", () => {
    for (const s of [
      "check-p5-batch3-isolation.mjs",
      "check-p5-batch3-stage2-isolation.mjs",
      "check-p5-batch3-stage3-isolation.mjs",
      "check-p5-batch3-stage4-isolation.mjs",
    ]) {
      const out = execSync(`node scripts/${s}`, { encoding: "utf8" });
      expect(out).toMatch(/ISOLATION_OK/);
    }
  });
});

describe("P5 Batch 3 Stage 5 — funder routes", () => {
  const appTsx = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const expected = [
    "/funder/p5-batch3",
    "/funder/p5-batch3/opportunities/:grantId",
    "/funder/p5-batch3/readiness/:grantId",
    "/funder/p5-batch3/requests/:grantId",
    "/funder/p5-batch3/outcomes/:grantId",
    "/funder/p5-batch3/downloads/:grantId",
  ];

  it.each(expected)("%s is registered and RequireAuth-wrapped", (path) => {
    const re = new RegExp(`<Route\\s+path="${path.replace(/[/]/g, "\\/")}"[^>]*RequireAuth`, "s");
    expect(appTsx).toMatch(re);
  });

  it("no public /api/v1/funder/* route is registered", () => {
    expect(appTsx).not.toMatch(/\/api\/v1\/funder/);
  });

  it("no /registry/p5-batch3 funder/customer surface exists", () => {
    expect(appTsx).not.toMatch(/\/registry\/p5-batch3/);
  });
});

describe("P5 Batch 3 Stage 5 — summary client is single read path", () => {
  it("summary-client.ts exists and exports fetchFunderSummary", () => {
    const p = join(ROOT, "src/lib/p5-batch3/summary-client.ts");
    expect(existsSync(p)).toBe(true);
    const t = readFileSync(p, "utf8");
    expect(t).toMatch(/export\s+(async\s+)?function\s+fetchFunderSummary/);
    expect(t).toMatch(/p5-batch3-funder-summary/);
  });

  it("funder pages invoke only fetchFunderSummary, not functions.invoke directly", () => {
    const files = [
      "src/pages/funder/p5-batch3/Index.tsx",
      "src/pages/funder/p5-batch3/Opportunity.tsx",
      "src/pages/funder/p5-batch3/Readiness.tsx",
      "src/pages/funder/p5-batch3/Downloads.tsx",
    ];
    for (const f of files) {
      const t = readFileSync(join(ROOT, f), "utf8");
      expect(t).not.toMatch(/supabase\s*\.\s*functions\s*\.\s*invoke\(/);
      expect(t).toMatch(/fetchFunderSummary/);
    }
  });
});

describe("P5 Batch 3 Stage 5 — funder RPC use is restricted", () => {
  const funderFiles = [
    "src/pages/funder/p5-batch3/Index.tsx",
    "src/pages/funder/p5-batch3/Opportunity.tsx",
    "src/pages/funder/p5-batch3/Readiness.tsx",
    "src/pages/funder/p5-batch3/Requests.tsx",
    "src/pages/funder/p5-batch3/Outcomes.tsx",
    "src/pages/funder/p5-batch3/Downloads.tsx",
  ].map((f) => ({ path: f, text: readFileSync(join(ROOT, f), "utf8") }));

  const ADMIN_WRAPPERS = [
    "p5b3CreateFunderOrg", "p5b3UpdateFunderOrg", "p5b3InviteFunderUser",
    "p5b3AssignFunderRole", "p5b3SetFunderUserStatus", "p5b3CreateAccessGrant",
    "p5b3ReleasePackVersion", "p5b3ChangeGrantExpiry", "p5b3RevokeGrant",
    "p5b3ReactivateGrant", "p5b3EditRequestExternalText", "p5b3DecideRequest",
    "p5b3ReviewOutcome", "p5b3ExitReview",
  ];

  it("no admin-only RPC wrapper is imported into funder UI", () => {
    for (const { path, text } of funderFiles) {
      for (const name of ADMIN_WRAPPERS) {
        expect(text, `${path} must not import ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });

  it("no direct supabase.rpc() or p5_batch3_* table access from funder UI", () => {
    for (const { path, text } of funderFiles) {
      expect(text, `${path} must not call supabase.rpc directly`).not.toMatch(/supabase\s*\.\s*rpc\(/);
      expect(text, `${path} must not read p5_batch3_* tables directly`)
        .not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch3_/);
    }
  });
});

describe("P5 Batch 3 Stage 5 — sensitive surface guarantees", () => {
  const funderFiles = [
    "src/pages/funder/p5-batch3/Index.tsx",
    "src/pages/funder/p5-batch3/Opportunity.tsx",
    "src/pages/funder/p5-batch3/Readiness.tsx",
    "src/pages/funder/p5-batch3/Requests.tsx",
    "src/pages/funder/p5-batch3/Outcomes.tsx",
    "src/pages/funder/p5-batch3/Downloads.tsx",
    "src/pages/funder/p5-batch3/components/P5B3FunderShell.tsx",
    "src/pages/funder/p5-batch3/components/P5B3FunderMaskedField.tsx",
    "src/pages/funder/p5-batch3/components/P5B3FunderUnavailable.tsx",
  ].map((f) => ({ path: f, text: readFileSync(join(ROOT, f), "utf8") }));

  const FORBIDDEN = [
    /\bVerified\b/, /\bGuaranteed\b/, /\bCompliance Passed\b/,
    /\bSanctions Cleared\b/, /\bBankable\b/, /\bProvider Verified\b/,
    /\bInvestment Grade\b/, /\bDue Diligence Complete\b/,
  ];
  it("no forbidden provider wording in funder UI", () => {
    for (const { path, text } of funderFiles) {
      for (const re of FORBIDDEN) {
        expect(text, `${path} contains forbidden wording ${re}`).not.toMatch(re);
      }
    }
  });

  const RAW = [
    /\braw_bank_account_number\b/, /\braw_iban\b/, /\braw_id_number\b/,
    /\braw_passport_number\b/, /\braw_ubo_details\b/, /\braw_documents\b/, /\braw_kyc\b/,
  ];
  it("no raw sensitive field name appears in funder UI", () => {
    for (const { path, text } of funderFiles) {
      for (const re of RAW) {
        expect(text, `${path} references ${re}`).not.toMatch(re);
      }
    }
  });

  it("no other-funder fields appear in funder UI", () => {
    for (const { path, text } of funderFiles) {
      expect(text).not.toMatch(/\bother_funder_status\b/);
      expect(text).not.toMatch(/\bother_funder_notes\b/);
      expect(text).not.toMatch(/\bother_funder_requests\b/);
    }
  });

  it("funder pages do not show CSV / raw exports", () => {
    for (const { path, text } of funderFiles) {
      expect(text, `${path} offers CSV export`).not.toMatch(/\.csv['"]/i);
    }
  });
});

describe("P5 Batch 3 Stage 5 — backend allow-list (Stage 6 surfaces now permitted)", () => {
  it("edge functions are limited to the Batch 3 allow-list", () => {
    const dir = join(ROOT, "supabase/functions");
    const names = existsSync(dir)
      ? require("node:fs").readdirSync(dir).filter((n: string) => /p5-?batch-?3|funder/i.test(n))
      : [];
    for (const n of names) {
      expect(["p5-batch3-funder-summary", "p5-batch3-stage6-monitor"]).toContain(n);
    }
  });

  it("config.toml does not declare Batch 3 cron", () => {
    const cfg = join(ROOT, "supabase/config.toml");
    if (!existsSync(cfg)) return;
    const t = readFileSync(cfg, "utf8");
    expect(t).not.toMatch(/p5-batch3.*\n[^[]*(schedule|cron)/i);
  });
});


describe("P5 Batch 3 Stage 5 — summary-client safety helpers", () => {
  it("stripUnsafeFields drops unreleased fields", async () => {
    const mod = await import("@/lib/p5-batch3/summary-client");
    const stripped = mod.stripUnsafeFields({
      transaction_summary: "ok",
      raw_bank_account_number: "1234567890",
      admin_internal_notes: "secret",
      access_grant: { id: "g" },
    } as Record<string, unknown>);
    expect(stripped).toHaveProperty("transaction_summary", "ok");
    expect(stripped).toHaveProperty("access_grant");
    expect(stripped).not.toHaveProperty("raw_bank_account_number");
    expect(stripped).not.toHaveProperty("admin_internal_notes");
  });

  it("guardProviderWording downgrades unsafe labels", async () => {
    const mod = await import("@/lib/p5-batch3/summary-client");
    const ctx = { provider_live: false, provider_result_reference: null, approved_manual_decision_ref: null };
    expect(mod.guardProviderWording("Verified", ctx)).toBe("External Provider Result Pending");
    expect(mod.guardProviderWording("Provider-ready", ctx)).toBe("Provider-ready");
    expect(mod.guardProviderWording(null, ctx)).toBe("Provider result unavailable");
  });
});
