/**
 * P-5 Screening — Phase 5 UI tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  P5_SCR_BANNED_EXTERNAL_WORDING,
  P5_SCR_API_FORBIDDEN_FIELDS,
} from "@/lib/p5-screening/registry";

const PAGE = "src/pages/admin/p5-screening/Workbench.tsx";
const API = "src/lib/p5-screening/api.ts";
const APP = readFileSync("src/App.tsx", "utf8");
const pageSrc = readFileSync(PAGE, "utf8");
const apiSrc = readFileSync(API, "utf8");

describe("P-5 Screening Phase 5 — UI", () => {
  it("page and API wrapper exist", () => {
    expect(existsSync(PAGE)).toBe(true);
    expect(existsSync(API)).toBe(true);
  });

  it("registers /admin/p5-screening behind platform_admin guard", () => {
    expect(APP).toMatch(/path="\/admin\/p5-screening"[^>]*RequireAuth role="platform_admin"/);
    expect(APP).toMatch(/P5ScreeningWorkbench = lazy\(\(\) => import\("@\/pages\/admin\/p5-screening\/Workbench"\)\)/);
  });

  it("UI never accesses screening tables directly", () => {
    expect(pageSrc).not.toMatch(/supabase\.from\(\s*['"]p5scr_/);
    expect(apiSrc).not.toMatch(/supabase\.from\(/);
  });

  it("API wrapper only calls Phase 4 projection RPCs", () => {
    const calls = [...apiSrc.matchAll(/supabase\.rpc[^)]*\)\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(["p5scr_api_subject_status", "p5scr_api_gate_readiness"]).toContain(c);
    }
  });

  it("UI never emits SSOT banned wording", () => {
    for (const phrase of P5_SCR_BANNED_EXTERNAL_WORDING) {
      expect(pageSrc.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it("UI never references SSOT forbidden fields", () => {
    for (const f of P5_SCR_API_FORBIDDEN_FIELDS) {
      expect(pageSrc).not.toContain(f);
    }
  });

  it("UI renders the provider-ready vs provider-verified disclaimer", () => {
    expect(pageSrc).toMatch(/Provider-ready is not provider-verified/);
  });

  it("UI uses no edge functions and no cron", () => {
    expect(pageSrc).not.toMatch(/supabase\.functions\.invoke/);
    expect(apiSrc).not.toMatch(/supabase\.functions\.invoke/);
  });
});
