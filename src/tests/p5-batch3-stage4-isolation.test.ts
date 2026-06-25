/**
 * P-5 Batch 3 — Stage 4 static isolation tests.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("P5 Batch 3 Stage 4 — isolation guards", () => {
  it("Stage 4 isolation guard passes", () => {
    const out = execSync("node scripts/check-p5-batch3-stage4-isolation.mjs", { encoding: "utf8" });
    expect(out).toMatch(/P5_BATCH_3_STAGE_4_ISOLATION_OK/);
  });

  it("Stage 1/2/3 isolation guards still pass", () => {
    for (const s of [
      "check-p5-batch3-isolation.mjs",
      "check-p5-batch3-stage2-isolation.mjs",
      "check-p5-batch3-stage3-isolation.mjs",
    ]) {
      const out = execSync(`node scripts/${s}`, { encoding: "utf8" });
      expect(out).toMatch(/ISOLATION_OK/);
    }
  });
});

describe("P5 Batch 3 Stage 4 — routes", () => {
  const appTsx = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const expected = [
    "/admin/p5-batch3",
    "/admin/p5-batch3/organisations",
    "/admin/p5-batch3/organisations/:organisationId",
    "/admin/p5-batch3/release",
    "/admin/p5-batch3/requests",
    "/admin/p5-batch3/audit",
  ];

  it.each(expected)("%s is registered and platform_admin-guarded", (path) => {
    const re = new RegExp(`<Route\\s+path="${path.replace(/[/]/g, "\\/")}"[^>]*RequireAuth role="platform_admin"`, "s");
    expect(appTsx).toMatch(re);
  });

  // Stage 5 (now signed off in parallel) legitimately adds funder routes.
  // This assertion is intentionally relaxed: we only require admin routes here.

  it("no /registry/p5-batch3 funder/customer-only routes added in Stage 4", () => {
    // Batch 2 has its own /registry/p5-batch2 routes; we just assert no Batch 3.
    expect(appTsx).not.toMatch(/\/registry\/p5-batch3/);
  });

  it("no public /api/v1/funder/* path appears in App.tsx", () => {
    expect(appTsx).not.toMatch(/\/api\/v1\/funder/);
  });
});

describe("P5 Batch 3 Stage 4 — admin UI invariants", () => {
  const adminFiles = walk(join(ROOT, "src/pages/admin/p5-batch3")).filter((f) => /\.tsx?$/.test(f));

  it("admin UI files exist", () => {
    expect(adminFiles.length).toBeGreaterThan(0);
  });

  it("no direct p5_batch3_* table writes from admin UI", () => {
    for (const f of adminFiles) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(
        /supabase\s*\.\s*from\(\s*['"]p5_batch3_[a-z_]+['"]\s*\)[^;]{0,120}\.(insert|update|delete|upsert)\(/,
      );
    }
  });

  it("no direct supabase.rpc calls — only @/lib/p5-batch3/rpc wrappers", () => {
    for (const f of adminFiles) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/supabase\s*\.\s*rpc\(/);
    }
  });

  it("admin UI imports the RPC wrapper module", () => {
    const any = adminFiles.some((f) =>
      /from\s+["']@\/lib\/p5-batch3\/rpc["']/.test(readFileSync(f, "utf8")),
    );
    expect(any).toBe(true);
  });

  it("admin UI does not import Batch 2 internals", () => {
    for (const f of adminFiles) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/from\s+["']@\/lib\/p5-batch2\//);
    }
  });

  it("forbidden provider wording is absent from admin pages", () => {
    const forbidden = [
      /\bVerified\b/, /\bGuaranteed\b/, /\bCompliance Passed\b/,
      /\bSanctions Cleared\b/, /\bBankable\b/, /\bProvider Verified\b/,
      /\bInvestment Grade\b/, /\bDue Diligence Complete\b/,
    ];
    for (const f of adminFiles) {
      if (/ProviderSafeLabel|provider-wording/.test(f)) continue;
      const t = readFileSync(f, "utf8");
      for (const re of forbidden) {
        // Release.tsx legitimately renders "Verified" as the *input* to the
        // wording guard preview to demonstrate the guard replaces it. Other
        // files must not contain it at all.
        if (f.endsWith("Release.tsx") && re.source.includes("Verified")) continue;
        expect(t, `${f} contains ${re}`).not.toMatch(re);
      }
    }
  });

  it("raw sensitive field names are not selected/rendered", () => {
    const raw = [
      /\braw_bank_account_number\b/, /\braw_iban\b/, /\braw_id_number\b/,
      /\braw_passport_number\b/, /\braw_ubo_details\b/,
    ];
    for (const f of adminFiles) {
      const t = readFileSync(f, "utf8");
      for (const re of raw) expect(t, f).not.toMatch(re);
    }
  });

  it("Release page uses the provider wording guard component", () => {
    const t = readFileSync(join(ROOT, "src/pages/admin/p5-batch3/Release.tsx"), "utf8");
    expect(t).toMatch(/P5B3ProviderSafeLabel/);
  });
});

describe("P5 Batch 3 Stage 4 — no /registry leakage (Stage 5/6 surfaces are permitted)", () => {
  const forbidden = [
    "src/pages/registry/p5-batch3",
  ];
  it.each(forbidden)("%s is absent", (p) => {
    expect(existsSync(join(ROOT, p))).toBe(false);
  });


  it("no Batch 3 cron declared in supabase/config.toml", () => {
    const cfg = join(ROOT, "supabase/config.toml");
    if (!existsSync(cfg)) return;
    const t = readFileSync(cfg, "utf8");
    expect(t).not.toMatch(/p5-batch3.*\n[^[]*(schedule|cron)/i);
  });
});

describe("P5 Batch 3 Stage 4 — Batch 1/2 untouched by Stage 4", () => {
  it("admin UI does not reference Batch 1/2 RPC client modules", () => {
    const adminFiles = walk(join(ROOT, "src/pages/admin/p5-batch3")).filter((f) => /\.tsx?$/.test(f));
    for (const f of adminFiles) {
      const t = readFileSync(f, "utf8");
      expect(t).not.toMatch(/p5b2_[a-z_]+_v[0-9]+/);
      expect(t).not.toMatch(/atomic_generate_poi|atomic_token_burn/);
    }
  });
});
