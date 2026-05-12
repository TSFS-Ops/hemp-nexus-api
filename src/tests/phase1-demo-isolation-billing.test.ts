/**
 * Phase 1 demo isolation — billing/credit safety (Option B).
 *
 * Source-pinning tests proving that `_shared/token-metering.ts` short-circuits
 * BEFORE any `atomic_token_burn` RPC or `token_ledger` write whenever the
 * caller's organisation has `organizations.is_demo = true`.
 *
 * These tests are deliberately static (read source). The DB-level proof
 * (live burn against an `is_demo=true` org returns no ledger row and no
 * balance change) is captured separately in supabase/tests via the live-proof
 * pass and not run from vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const METERING_PATH = resolve(
  __dirname,
  "../../supabase/functions/_shared/token-metering.ts",
);
const meteringSrc = readFileSync(METERING_PATH, "utf8");

describe("Phase 1 demo isolation — token-metering (Option B: organizations.is_demo)", () => {
  it("exports an isDemoOrg helper that reads organizations.is_demo", () => {
    expect(meteringSrc).toMatch(/export\s+async\s+function\s+isDemoOrg\s*\(/);
    expect(meteringSrc).toMatch(/from\("organizations"\)[\s\S]{0,80}select\("is_demo"\)/);
  });

  it("isDemoOrg fails CLOSED (returns false) on lookup error — never silently skip a real burn", () => {
    // The error branch must return false, not true.
    expect(meteringSrc).toMatch(
      /is_demo lookup failed[\s\S]{0,80}return false/,
    );
  });

  it("TokenBurnResult exposes an optional `skipped: \"demo\"` discriminator", () => {
    expect(meteringSrc).toMatch(/skipped\?:\s*"demo"/);
  });

  it("burnTokens checks isDemoOrg BEFORE calling atomic_token_burn", () => {
    const burnTokensBlock = meteringSrc.match(
      /export async function burnTokens\([\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(burnTokensBlock).toBeTruthy();
    const demoIdx = burnTokensBlock!.indexOf("isDemoOrg");
    const rpcIdx = burnTokensBlock!.indexOf('rpc("atomic_token_burn"');
    expect(demoIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(demoIdx).toBeLessThan(rpcIdx);
  });

  it("burnTokens demo-skip returns success with skipped:\"demo\" and no ledger row", () => {
    const burnTokensBlock = meteringSrc.match(
      /export async function burnTokens\([\s\S]*?\n\}\s*\n/,
    )?.[0]!;
    expect(burnTokensBlock).toMatch(/isDemoOrg[\s\S]{0,400}skipped:\s*"demo"/);
  });

  it("burnTokensForAction checks isDemoOrg BEFORE the atomic_token_burn RPC", () => {
    const block = meteringSrc.match(
      /export async function burnTokensForAction\([\s\S]*?\n\}\s*\n/,
    )?.[0];
    expect(block).toBeTruthy();
    const demoIdx = block!.indexOf("isDemoOrg");
    const rpcIdx = block!.indexOf('rpc("atomic_token_burn"');
    expect(demoIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(demoIdx).toBeLessThan(rpcIdx);
  });

  it("enforceTokenMetering bypasses balance check + burn when org is demo", () => {
    const block = meteringSrc.match(
      /export async function enforceTokenMetering\([\s\S]*?\n\}\s*\n/,
    )?.[0]!;
    expect(block).toMatch(/isDemoOrg[\s\S]{0,200}return;/);
    // The bypass must come before checkTokenBalance / burnTokens calls.
    const demoIdx = block.indexOf("isDemoOrg");
    const checkIdx = block.indexOf("checkTokenBalance(");
    expect(demoIdx).toBeLessThan(checkIdx);
  });

  it("real (non-demo) org path is unchanged: atomic_token_burn still called with p_org_id", () => {
    expect(meteringSrc).toMatch(
      /rpc\("atomic_token_burn",\s*\{[\s\S]{0,80}p_org_id:\s*orgId/,
    );
  });

  it("demo skip never writes to token_ledger directly", () => {
    // Confirm there is still no direct insert into token_ledger anywhere in the module.
    expect(meteringSrc).not.toMatch(/from\("token_ledger"\)[\s\S]{0,40}\.insert\(/);
  });
});

describe("Phase 1 demo isolation — schema artefact", () => {
  it("organizations.is_demo migration is committed", () => {
    // Simple existence check — the column appears in the generated types file.
    const typesPath = resolve(__dirname, "../integrations/supabase/types.ts");
    const types = readFileSync(typesPath, "utf8");
    // The organizations Row block must include is_demo: boolean.
    const orgRowBlock = types.match(/organizations:\s*\{[\s\S]*?Row:\s*\{[\s\S]*?\}/);
    expect(orgRowBlock?.[0]).toMatch(/is_demo:\s*boolean/);
  });
});
