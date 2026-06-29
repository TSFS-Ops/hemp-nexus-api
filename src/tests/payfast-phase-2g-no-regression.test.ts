/**
 * Phase 2G no-regression guards.
 *
 * Pins the live-readiness hardening contract:
 *   - sandbox checkout cannot use live credentials, and vice versa;
 *   - live checkout requires PAYFAST_MODE=live + PAYFAST_LIVE_SMOKE_ENABLED;
 *   - live checkout requires platform_admin;
 *   - live passphrase resolution prefers _LIVE and never falls back
 *     to the generic or sandbox name;
 *   - PayFast remains absent from the customer-facing live registry;
 *   - the live smoke button stays admin-only and probe-gated;
 *   - Paystack runtime is untouched; no FX revival; ITN-only credit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ITN_SRC = readFileSync(
  resolve("supabase/functions/payfast-itn/index.ts"),
  "utf8",
);
const SBX_FN_SRC = readFileSync(
  resolve("supabase/functions/payfast-checkout-sandbox/index.ts"),
  "utf8",
);
const LIVE_FN_PATH = resolve("supabase/functions/payfast-checkout-live/index.ts");
const LIVE_HELPER_PATH = resolve(
  "supabase/functions/_shared/payments/payfast-live-checkout.ts",
);
const LIVE_FN_SRC = readFileSync(LIVE_FN_PATH, "utf8");
const LIVE_HELPER_SRC = readFileSync(LIVE_HELPER_PATH, "utf8");
const LIVE_BTN_SRC = readFileSync(
  resolve("src/components/desk/billing/PayfastLiveSmokeTestButton.tsx"),
  "utf8",
);
const SELECT_SRC = readFileSync(
  resolve("supabase/functions/_shared/payments/select.ts"),
  "utf8",
);

describe("Phase 2G: live-readiness file presence", () => {
  it("payfast-checkout-live edge function exists", () => {
    expect(existsSync(LIVE_FN_PATH)).toBe(true);
  });
  it("payfast-live-checkout shared helper exists", () => {
    expect(existsSync(LIVE_HELPER_PATH)).toBe(true);
  });
});

describe("Phase 2G: passphrase resolution in payfast-itn is per-mode and strict", () => {
  it("live mode uses ONLY PAYFAST_PASSPHRASE_LIVE — no fallback to sandbox or generic", () => {
    // Find the live branch and assert it does not mention the legacy
    // generic PAYFAST_PASSPHRASE or the sandbox name.
    const liveBranchMatch = ITN_SRC.match(
      /if\s*\(mode\s*===\s*"live"\)\s*\{[\s\S]*?return[\s\S]*?\}/,
    );
    expect(liveBranchMatch).toBeTruthy();
    const liveBranch = liveBranchMatch![0];
    expect(liveBranch).toContain("PAYFAST_PASSPHRASE_LIVE");
    expect(liveBranch).not.toContain("PAYFAST_PASSPHRASE_SANDBOX");
    // The generic name must not appear in the live branch.
    expect(liveBranch.match(/PAYFAST_PASSPHRASE(?!_LIVE)/)).toBeNull();
  });

  it("sandbox mode does not read PAYFAST_PASSPHRASE_LIVE", () => {
    // After the live branch returns, only sandbox candidates should remain.
    const sandboxPart = ITN_SRC.split(/return\s+v\s+&&\s+v\.length\s*>\s*0\s*\?\s*v\s*:\s*null;/)[1] ?? "";
    expect(sandboxPart).toContain("PAYFAST_PASSPHRASE_SANDBOX");
    expect(sandboxPart).not.toContain("PAYFAST_PASSPHRASE_LIVE");
  });
});

describe("Phase 2G: sandbox checkout cannot use live credentials", () => {
  it("payfast-checkout-sandbox/index.ts reads only *_SANDBOX / legacy / unsuffixed names", () => {
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_ID_LIVE/);
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_KEY_LIVE/);
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_PASSPHRASE_LIVE/);
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_NOTIFY_URL_LIVE/);
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_RETURN_URL_LIVE/);
    expect(SBX_FN_SRC).not.toMatch(/PAYFAST_CANCEL_URL_LIVE/);
  });
});

describe("Phase 2G: live checkout cannot use sandbox credentials", () => {
  it("payfast-checkout-live/index.ts reads only *_LIVE secret names", () => {
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_ID_SANDBOX/);
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_MERCHANT_KEY_SANDBOX/);
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_PASSPHRASE_SANDBOX/);
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_SANDBOX_MERCHANT_ID/);
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_SANDBOX_MERCHANT_KEY/);
    expect(LIVE_FN_SRC).not.toMatch(/PAYFAST_SANDBOX_CHECKOUT_ENABLED/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_MERCHANT_ID_LIVE/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_MERCHANT_KEY_LIVE/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_PASSPHRASE_LIVE/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_NOTIFY_URL_LIVE/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_RETURN_URL_LIVE/);
    expect(LIVE_FN_SRC).toMatch(/PAYFAST_CANCEL_URL_LIVE/);
  });
});

describe("Phase 2G: live checkout gates", () => {
  it("requires PAYFAST_LIVE_SMOKE_ENABLED", () => {
    expect(LIVE_FN_SRC).toContain('PAYFAST_LIVE_SMOKE_ENABLED');
    expect(LIVE_HELPER_SRC).toContain('"gate_disabled"');
  });
  it("requires PAYFAST_MODE=live", () => {
    expect(LIVE_FN_SRC).toContain('PAYFAST_MODE');
    expect(LIVE_HELPER_SRC).toContain('"mode_not_live"');
    // The helper's mode-not-live guard must check globalMode !== "live".
    expect(LIVE_HELPER_SRC).toMatch(/globalMode\s*!==\s*"live"/);
  });
  it("requires platform_admin role", () => {
    expect(LIVE_FN_SRC).toContain('"platform_admin"');
    expect(LIVE_HELPER_SRC).toMatch(/isPlatformAdmin\s*!==\s*true/);
  });
  it("requires body provider=payfast and mode=live", () => {
    expect(LIVE_HELPER_SRC).toMatch(/input\.provider\s*!==\s*"payfast"/);
    expect(LIVE_HELPER_SRC).toMatch(/input\.mode\s*!==\s*"live"/);
  });
});

describe("Phase 2G: live helper does not revive FX or read sandbox secrets", () => {
  it("payfast-live-checkout.ts does not import _shared/fx.ts", () => {
    expect(LIVE_HELPER_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast-live-checkout.ts does not mention any sandbox secret name", () => {
    expect(LIVE_HELPER_SRC).not.toMatch(/PAYFAST_[A-Z_]*SANDBOX[A-Z_]*/);
  });
  it("inserts token_purchases with provider='payfast' and mode='live'", () => {
    expect(LIVE_HELPER_SRC).toMatch(/provider:\s*"payfast"/);
    expect(LIVE_HELPER_SRC).toMatch(/mode:\s*"live"/);
    expect(LIVE_HELPER_SRC).toMatch(/status:\s*"pending"/);
    expect(LIVE_HELPER_SRC).toMatch(/currency:\s*"ZAR"/);
    // paystack_reference must be parked in a payfast_live:: namespace.
    expect(LIVE_HELPER_SRC).toMatch(/`payfast_live::\$\{mPaymentId\}`/);
  });
});

describe("Phase 2G: live smoke button is admin-only + probe-gated", () => {
  it("returns null unless isAdmin", () => {
    expect(LIVE_BTN_SRC).toMatch(/if\s*\(!isAdmin\)\s*return\s+null;/);
  });
  it("returns null unless probe.available === true", () => {
    expect(LIVE_BTN_SRC).toMatch(/probe\.available\s*!==\s*true/);
  });
  it("calls payfast-checkout-live and not the sandbox function", () => {
    expect(LIVE_BTN_SRC).toContain('"payfast-checkout-live"');
    expect(LIVE_BTN_SRC).not.toContain('"payfast-checkout-sandbox"');
  });
  it("posts mode=live (not sandbox)", () => {
    expect(LIVE_BTN_SRC).toMatch(/mode:\s*"live"/);
    // Must not silently submit a sandbox body from this button.
    const bodyArea = LIVE_BTN_SRC.match(/body:\s*\{[^}]*\}/);
    expect(bodyArea?.[0]).not.toContain('"sandbox"');
  });
});

describe("Phase 2G: customer-facing PayFast checkout remains absent", () => {
  it("live provider registry still excludes PayFast", () => {
    // select.ts must not register PayFast as a live customer-facing provider.
    expect(SELECT_SRC).toMatch(/payfast:\s*undefined/);
  });
});

describe("Phase 2G: ITN remains the only credit path; no FX revival", () => {
  it("payfast-itn does not import _shared/fx.ts", () => {
    expect(ITN_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
  it("payfast-checkout-live does not import _shared/fx.ts", () => {
    expect(LIVE_FN_SRC).not.toMatch(/from\s+["'][^"']*_shared\/fx[^"']*["']/);
  });
});
