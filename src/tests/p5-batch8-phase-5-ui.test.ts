import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * P-5 Batch 8 — Phase 5 UI contract tests.
 * Static asserts that the admin workbench surface is wired to the
 * Phase 4 read projections and Phase 3 RPCs only, with safe wording.
 */

const ROOT = resolve(__dirname, "../..");
const UI_PAGE = "src/pages/admin/p5-batch8/Workbench.tsx";
const UI_SHELL = "src/components/p5-batch8/WorkbenchShell.tsx";
const API = "src/lib/p5-batch8/api.ts";
const APP = "src/App.tsx";

const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const PHASE_4_READ_FNS = [
  "p5b8_read_provider_config_summary",
  "p5b8_read_provider_dependency_status_summary",
  "p5b8_read_provider_request_summary",
  "p5b8_read_provider_result_summary",
  "p5b8_read_provider_decision_summary",
  "p5b8_read_webhook_ledger_summary",
  "p5b8_read_audit_timeline_summary",
  "p5b8_read_retry_state_summary",
  "p5b8_read_memory_finality_link_summary",
  "p5b8_read_dashboard_queue_summary",
];

const PHASE_3_WRITE_FNS = [
  "p5b8_rpc_record_activation_signoff",
  "p5b8_rpc_set_dependency_status",
];

describe("P-5 Batch 8 Phase 5 — UI surfaces", () => {
  it("required files exist", () => {
    for (const p of [UI_PAGE, UI_SHELL, API]) {
      expect(existsSync(resolve(ROOT, p)), p).toBe(true);
    }
  });

  it("API wrapper calls every Phase 4 read projection", () => {
    const src = read(API);
    for (const fn of PHASE_4_READ_FNS) {
      expect(src, `API wraps ${fn}`).toContain(`"${fn}"`);
    }
  });

  it("API wrapper only calls allow-listed RPC names", () => {
    const src = read(API);
    const allowed = new Set<string>([...PHASE_4_READ_FNS, ...PHASE_3_WRITE_FNS]);
    const calls = Array.from(
      src.matchAll(/["'](p5b8_(?:read|rpc)_[a-z0-9_]+)["']/gi),
    ).map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(PHASE_4_READ_FNS.length);
    for (const name of calls) {
      expect(allowed.has(name), `RPC ${name} allow-listed`).toBe(true);
    }
  });

  it("UI does not read p5b8_ tables directly", () => {
    function walk(dir: string): string[] {
      const out: string[] = [];
      if (!existsSync(dir)) return out;
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        const s = statSync(p);
        if (s.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx)$/.test(e)) out.push(p);
      }
      return out;
    }
    for (const f of [
      ...walk(resolve(ROOT, "src/pages/admin/p5-batch8")),
      ...walk(resolve(ROOT, "src/components/p5-batch8")),
    ]) {
      const body = readFileSync(f, "utf8");
      expect(body, f).not.toMatch(/supabase\s*\.\s*from\s*\(\s*['"`]p5b8_/);
      expect(body, f).not.toMatch(/supabase\s*\.\s*rpc\s*\(/);
    }
  });

  it("UI shell renders the provider-ready vs provider-verified disclaimer", () => {
    const shell = read(UI_SHELL);
    expect(shell).toMatch(/Provider-ready is not provider-verified/i);
  });

  it("UI contains no banned external wording", () => {
    const BANNED = [
      "guaranteed clean", "regulator approved", "bank verified",
      "sanctions cleared", "kyc passed", "kyc complete",
      "provider certified", "provider verified", "verified by provider",
      "verified by bank", "live integrated", "live connected",
    ];
    for (const f of [UI_PAGE, UI_SHELL]) {
      const body = read(f).toLowerCase();
      for (const w of BANNED) {
        expect(body, `${f} banned wording "${w}"`).not.toContain(w);
      }
    }
  });

  it("UI contains no Phase 1 forbidden external fields", () => {
    const FORBIDDEN = [
      "raw_provider_payload_admin_only",
      "raw_webhook_payload_admin_only",
      "provider_api_key",
      "provider_api_secret",
      "webhook_signature_secret",
      "internal_risk_note",
      "internal_reviewer_note",
    ];
    for (const f of [UI_PAGE, UI_SHELL]) {
      const body = read(f);
      for (const col of FORBIDDEN) {
        expect(body, `${f} field "${col}"`).not.toContain(col);
      }
    }
  });

  it("route /admin/p5-batch8 is registered with platform_admin guard", () => {
    const app = read(APP);
    expect(app).toMatch(/path="\/admin\/p5-batch8"[\s\S]{0,400}RequireAuth\s+role="platform_admin"/);
    expect(app).toContain("P5Batch8Workbench");
  });

  it("no Batch 6 or Batch 7 token leakage into Phase 5 surfaces", () => {
    for (const f of [UI_PAGE, UI_SHELL, API]) {
      const body = read(f);
      for (const tok of ["p5b6_", "p5b7_"]) {
        expect(body, `${f} contains ${tok}`).not.toContain(tok);
      }
    }
  });
});
