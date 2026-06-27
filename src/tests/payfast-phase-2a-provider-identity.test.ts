/**
 * PayFast Phase 2A — provider identity hardening on token_purchases.
 *
 * Source-text and migration-text guards. Asserts that:
 *   - the migration adds `provider` + `provider_reference`,
 *     backfills them from paystack_reference / metadata, and adds the
 *     partial unique index on (provider, provider_reference)
 *   - Paystack initiation still writes paystack_reference AND now
 *     additionally writes provider='paystack' + provider_reference
 *   - the org-purchases read surface selects the new columns
 *   - the PurchasesList UI uses a safe display-reference fallback
 *     (provider_reference || paystack_reference) without erasing
 *     historical Paystack rows
 *   - no PayFast checkout / ITN / secret is exposed in Phase 2A
 *
 * Strictly source/static assertions. No Supabase, no Paystack, no
 * PayFast, no live payment path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

const MIGRATION_TEXT = MIGRATION_FILES
  .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"))
  .join("\n\n-- ===== migration boundary =====\n\n");

const TP = readFileSync(
  resolve(process.cwd(), "supabase/functions/token-purchase/index.ts"),
  "utf8",
);
const LIST = readFileSync(
  resolve(process.cwd(), "supabase/functions/list-org-purchases/index.ts"),
  "utf8",
);
const PANEL = readFileSync(
  resolve(process.cwd(), "src/components/desk/billing/PurchasesList.tsx"),
  "utf8",
);

describe("Phase 2A migration: provider identity columns + index", () => {
  it("adds provider and provider_reference columns to token_purchases", () => {
    expect(MIGRATION_TEXT).toMatch(
      /ALTER TABLE public\.token_purchases[\s\S]{0,400}ADD COLUMN IF NOT EXISTS provider TEXT/,
    );
    expect(MIGRATION_TEXT).toMatch(
      /ADD COLUMN IF NOT EXISTS provider_reference TEXT/,
    );
  });

  it("backfills provider_reference from paystack_reference for legacy rows", () => {
    expect(MIGRATION_TEXT).toMatch(
      /UPDATE public\.token_purchases[\s\S]{0,200}SET provider_reference = paystack_reference[\s\S]{0,200}paystack_reference IS NOT NULL/,
    );
  });

  it("backfills provider='paystack' for legacy Paystack rows", () => {
    expect(MIGRATION_TEXT).toMatch(
      /SET provider = 'paystack'[\s\S]{0,200}paystack_reference IS NOT NULL/,
    );
  });

  it("preserves metadata.provider / metadata.provider_reference when present", () => {
    expect(MIGRATION_TEXT).toMatch(/metadata->>'provider'/);
    expect(MIGRATION_TEXT).toMatch(/metadata->>'provider_reference'/);
  });

  it("adds a partial unique index on (provider, provider_reference) — both NOT NULL", () => {
    expect(MIGRATION_TEXT).toMatch(
      /CREATE UNIQUE INDEX[\s\S]{0,200}token_purchases[\s\S]{0,200}\(\s*provider\s*,\s*provider_reference\s*\)[\s\S]{0,200}WHERE provider IS NOT NULL AND provider_reference IS NOT NULL/,
    );
  });

  it("constrains provider to the known ids only (paystack | payfast), leaving NULL allowed", () => {
    expect(MIGRATION_TEXT).toMatch(
      /CHECK\s*\(\s*provider IS NULL OR provider IN \(\s*'paystack'\s*,\s*'payfast'\s*\)\s*\)/,
    );
  });

  it("does NOT drop, rename or weaken paystack_reference or its UNIQUE constraint", () => {
    // Forbid any destructive statement against the historical column in
    // the Phase 2A migration window. (Older migrations created it; we
    // only inspect the project-wide migration text to ensure 2A is
    // additive.)
    const phase2a = MIGRATION_FILES
      .filter((f) => f >= "20260627115000")
      .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"))
      .join("\n");
    expect(phase2a).not.toMatch(/DROP\s+COLUMN\s+paystack_reference/i);
    expect(phase2a).not.toMatch(/RENAME\s+COLUMN\s+paystack_reference/i);
    expect(phase2a).not.toMatch(/DROP\s+INDEX[\s\S]{0,80}token_purchases_paystack_reference_key/i);
  });
});

describe("Phase 2A write path: Paystack initiation still writes paystack_reference AND provider identity", () => {
  it("token-purchase still inserts paystack_reference (historical column preserved)", () => {
    expect(TP).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,400}paystack_reference:\s*paystackData\.data\.reference/,
    );
  });

  it("token-purchase additionally writes provider: 'paystack' on the pending row", () => {
    expect(TP).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,600}provider:\s*["']paystack["']/,
    );
  });

  it("token-purchase additionally writes provider_reference mirroring paystack reference", () => {
    expect(TP).toMatch(
      /\.from\("token_purchases"\)[\s\S]{0,800}provider_reference:\s*paystackData\.data\.reference/,
    );
  });

  it("token-purchase metadata also carries provider + provider_reference for recovery", () => {
    expect(TP).toMatch(/metadata:\s*\{[\s\S]{0,400}provider:\s*["']paystack["']/);
    expect(TP).toMatch(/metadata:\s*\{[\s\S]{0,400}provider_reference:\s*paystackData\.data\.reference/);
  });

  it("Paystack settlement currency remains USD — no FX revival", () => {
    expect(TP).toContain('currency: "USD"');
    expect(TP).not.toMatch(/from\s+["']\.\.\/_shared\/fx\.ts["']/);
  });
});

describe("Phase 2A read surface: list-org-purchases selects the new identity columns", () => {
  it("primary purchases page selects provider and provider_reference", () => {
    expect(LIST).toMatch(/paystack_reference,\s*provider,\s*provider_reference/);
  });

  it("out-of-page refund-relevant lookup also selects provider and provider_reference", () => {
    const matches = LIST.match(/paystack_reference,\s*provider,\s*provider_reference/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Phase 2A UI: PurchasesList uses provider-agnostic display reference with Paystack fallback", () => {
  it("PurchaseRow type carries optional provider / provider_reference", () => {
    expect(PANEL).toMatch(/provider\?:\s*string\s*\|\s*null/);
    expect(PANEL).toMatch(/provider_reference\?:\s*string\s*\|\s*null/);
  });

  it("displayed reference prefers provider_reference and falls back to paystack_reference", () => {
    expect(PANEL).toMatch(/\{p\.provider_reference\s*\|\|\s*p\.paystack_reference\}/);
  });

  it("historical Paystack rows still render — fallback preserves paystack_reference visibility", () => {
    // The render expression MUST include paystack_reference as a fallback
    // so a legacy row (no provider columns yet, e.g. dev fixtures) still
    // shows its reference instead of an empty <code/> tag.
    expect(PANEL).toMatch(/p\.paystack_reference/);
  });
});

describe("Phase 2A boundary: no PayFast live surface is introduced", () => {
  it("no PayFast secret is read in any live payment function in Phase 2A", () => {
    expect(TP).not.toMatch(/PAYFAST_/);
    expect(LIST).not.toMatch(/PAYFAST_/);
  });

  it("no payfast-itn / payfast-webhook route is exposed in Phase 2A", () => {
    expect(TP).not.toMatch(/payfast-itn/);
    expect(TP).not.toMatch(/payfast[_-]?webhook/i);
    expect(LIST).not.toMatch(/payfast-itn/);
  });

  it("no PayFast checkout button / call-to-action is rendered from PurchasesList", () => {
    expect(PANEL).not.toMatch(/payfast/i);
  });
});
