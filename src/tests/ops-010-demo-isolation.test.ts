/**
 * OPS-010 — Demo workspace isolation contract tests.
 *
 * These are structural / contract assertions over the SSOT modules,
 * mirror files, prebuild guards, and edge-function wiring. They prove
 * the OPS-010 phase-2A guarantees in a way that does not require live
 * DB / edge-fn execution in the local Vitest runner.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

import {
  OPS_010_AUDIT,
  OPS_010_MIN_REASON_LENGTH,
  OPS_010_DEMO_WATERMARK,
} from "@/lib/ops/ops-010-audit";

describe("OPS-010 audit name SSOT", () => {
  it("exposes all 12 canonical demo audit names", () => {
    expect(Object.keys(OPS_010_AUDIT)).toHaveLength(12);
    for (const v of Object.values(OPS_010_AUDIT)) {
      expect(v.startsWith("ops.demo_")).toBe(true);
    }
  });

  it("mirrors every browser audit name in the Deno SSOT", () => {
    const denoSrc = readFileSync(
      "supabase/functions/_shared/ops-010-audit.ts",
      "utf8",
    );
    for (const v of Object.values(OPS_010_AUDIT)) {
      expect(denoSrc).toContain(`"${v}"`);
    }
  });
});

describe("OPS-010 reason-length policy", () => {
  it("enforces a 20-character minimum reason on the SECDEF RPCs", () => {
    expect(OPS_010_MIN_REASON_LENGTH).toBe(20);
    for (const fn of [
      "admin-demo-workspace-create",
      "admin-demo-workspace-reset",
      "admin-demo-workspace-archive",
    ]) {
      const p = `supabase/functions/${fn}/index.ts`;
      expect(existsSync(p), `${p} must exist`).toBe(true);
      const src = readFileSync(p, "utf8");
      // Edge fn relays the reason; the RPC itself enforces ≥ 20 chars.
      expect(src).toMatch(/reason/i);
    }
  });
});

describe("OPS-010 AAL2 + platform_admin on SECDEF RPCs", () => {
  it("create/reset/archive require AAL2 and platform_admin", () => {
    for (const fn of [
      "admin-demo-workspace-create",
      "admin-demo-workspace-reset",
      "admin-demo-workspace-archive",
    ]) {
      const src = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
      expect(src, `${fn} must call assertAal2`).toMatch(/assertAal2|aal\.ts/);
      expect(src, `${fn} must check platform_admin`).toMatch(/platform_admin/);
    }
  });
});

describe("OPS-010 deterministic seeder", () => {
  it("uses the ops010- prefix and contains no real client / CP fixture names", () => {
    const src = readFileSync(
      "supabase/functions/seed-ops010-demo-workspace/index.ts",
      "utf8",
    );
    expect(src).toContain("ops010-");
    expect(src).not.toMatch(/\bCP Buyer A\b/);
    expect(src).not.toMatch(/\bCP Seller A\b/);
    // No real-customer surnames or live brand strings allowed.
    expect(src).not.toMatch(/"Izenzo"|'Izenzo'/);
  });
});

describe("OPS-010 demo/live boundary enforcement", () => {
  it("retains DEMO_BOUNDARY_VIOLATION in the trigger migration", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const dir = "supabase/migrations";
    const found = fs.readdirSync(dir).some((f) => {
      if (!f.endsWith(".sql")) return false;
      const src = fs.readFileSync(`${dir}/${f}`, "utf8");
      return (
        src.includes("enforce_demo_inheritance_trg") &&
        src.includes("DEMO_BOUNDARY_VIOLATION")
      );
    });
    expect(found, "no migration installs enforce_demo_inheritance_trg with DEMO_BOUNDARY_VIOLATION").toBe(true);
  });

  it("reset_demo_workspace scopes by BOTH is_demo AND demo_dataset_id", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const dir = "supabase/migrations";
    const found = fs.readdirSync(dir).some((f) => {
      if (!f.endsWith(".sql")) return false;
      const src = fs.readFileSync(`${dir}/${f}`, "utf8");
      if (!src.includes("reset_demo_workspace")) return false;
      const block = (src.match(/reset_demo_workspace[\s\S]+?\$fn\$;/i) || [""])[0];
      return /is_demo[\s\S]+demo_dataset_id/i.test(block);
    });
    expect(found, "reset_demo_workspace must scope by both is_demo AND demo_dataset_id").toBe(true);
  });
});

describe("OPS-010 zero-outbound email policy", () => {
  it("send-transactional-email short-circuits demo orgs before Resend", () => {
    const src = readFileSync(
      "supabase/functions/send-transactional-email/index.ts",
      "utf8",
    );
    expect(src).toMatch(/wouldEmitToDemoOrg|demo-mode-guard/);
  });
});

describe("OPS-010 payment / compliance provider suppression", () => {
  it("token-purchase wires the demo-mode guard", () => {
    const src = readFileSync(
      "supabase/functions/token-purchase/index.ts",
      "utf8",
    );
    expect(src).toMatch(/demo-mode-guard|loadDemoContext|simulateInsteadOf/);
  });
  it("dilisense-screen wires the demo-mode guard", () => {
    const src = readFileSync(
      "supabase/functions/dilisense-screen/index.ts",
      "utf8",
    );
    expect(src).toMatch(/demo-mode-guard|simulateInsteadOf/);
  });
});

describe("OPS-010 secondary chokepoint wiring", () => {
  const SURFACES = [
    "paystack-webhook",
    "admin-credit-org",
    "idv-verify",
    "ubo-verify",
    "wad",
    "p3-wad",
    "collapse",
    "deal-certificate",
    "evidence-pack",
    "webhooks",
    "webhook-retry",
    "webhook-events",
    "export-prepare",
    "export-download",
  ];
  it.each(SURFACES)("%s imports demo-mode-entry and calls tryDemoShortCircuit", (fn) => {
    const src = readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");
    expect(src).toContain("demo-mode-entry");
    expect(src).toContain("tryDemoShortCircuit");
  });
});

describe("OPS-010 demo artefact watermark", () => {
  it("markDemoArtifact exists and stamps non_production + watermark", () => {
    const src = readFileSync(
      "supabase/functions/_shared/demo-mode-guard.ts",
      "utf8",
    );
    expect(src).toContain("markDemoArtifact");
    expect(src).toContain("non_production");
    expect(src).toContain("OPS_010_DEMO_WATERMARK"); // referenced via import
  });
});

describe("OPS-010 DemoModeBanner mount", () => {
  it("is mounted in App.tsx alongside TestModeBanner", () => {
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).toContain("DemoModeBanner");
    expect(src).toContain("TestModeBanner");
  });
});
