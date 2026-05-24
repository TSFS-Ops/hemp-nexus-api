/**
 * MT-012 — Trade Request Archive: governance + SSOT + guard coverage tests.
 * Pure / read-only: validates SSOT shape, migration content, edge-fn auth
 * shape, and progression-guard wiring. DB integration is exercised via
 * the prebuild guards (`check-mt012-*`) which run in `npm run build`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TRADE_REQUEST_MT012_AUDIT,
  TRADE_REQUEST_MT012_AUDIT_NAMES,
  MT012_BLOCK_MESSAGE,
  MT012_ADMIN_OVERRIDE_WARNING,
  EXCEPTION_HOLD_MARKER,
  MT012_MIN_REASON_LENGTH,
} from "@/lib/trade-request/mt-012-audit";

const MIG_DIR = "supabase/migrations";
const mt012Mig = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ f, body: readFileSync(join(MIG_DIR, f), "utf8") }))
  .filter((x) => x.body.includes("admin_archive_trade_request_override"))
  .pop();

const read = (p: string) => readFileSync(p, "utf8");

describe("MT-012 SSOT", () => {
  it("declares the four canonical audit action names", () => {
    expect(TRADE_REQUEST_MT012_AUDIT_NAMES).toContain(
      "trade_request.archive_blocked_active_child_matches",
    );
    expect(TRADE_REQUEST_MT012_AUDIT_NAMES).toContain(
      "trade_request.archived_admin_override_active_children",
    );
    expect(TRADE_REQUEST_MT012_AUDIT_NAMES).toContain("trade_request.archived_normal");
    expect(TRADE_REQUEST_MT012_AUDIT_NAMES).toContain(
      "trade_request.admin_exception_hold_released",
    );
    expect(TRADE_REQUEST_MT012_AUDIT_NAMES).toHaveLength(4);
  });

  it("client and Deno mirrors are byte-identical for action values", () => {
    const denoSsot = read("supabase/functions/_shared/mt-012-audit.ts");
    for (const name of TRADE_REQUEST_MT012_AUDIT_NAMES) {
      expect(denoSsot).toContain(`"${name}"`);
    }
    expect(denoSsot).toContain(`"${EXCEPTION_HOLD_MARKER}"`);
  });

  it("exposes the verbatim signed user + admin messages", () => {
    expect(MT012_BLOCK_MESSAGE).toBe(
      "This trade request cannot be archived because one or more linked matches are still active. Close, cancel, expire, or complete the linked matches before archiving this trade request.",
    );
    expect(MT012_ADMIN_OVERRIDE_WARNING).toBe(
      "This trade request has active child matches. Admin override will archive the parent trade request and place active child matches on exception hold. A reason is required and all actions will be audit logged.",
    );
    expect(MT012_MIN_REASON_LENGTH).toBe(20);
  });
});

describe("MT-012 migration", () => {
  it("exists and defines the three RPCs", () => {
    expect(mt012Mig).toBeTruthy();
    const b = mt012Mig!.body;
    expect(b).toContain("CREATE OR REPLACE FUNCTION public.archive_trade_request(");
    expect(b).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_archive_trade_request_override(",
    );
    expect(b).toContain(
      "CREATE OR REPLACE FUNCTION public.admin_release_trade_request_exception_hold(",
    );
  });

  it("adds archive columns to trade_requests (no enum widening)", () => {
    const b = mt012Mig!.body;
    expect(b).toContain("archived_at TIMESTAMPTZ");
    expect(b).toContain("archived_by UUID");
    expect(b).toContain("archive_reason TEXT");
    expect(b).toContain("archive_mode TEXT");
    expect(b).toContain(
      "archive_mode IN ('normal','admin_override_active_children')",
    );
    expect(b).not.toMatch(/trade_requests_status_check/);
  });

  it("each RPC is SECURITY DEFINER, search_path pinned, and service_role-only", () => {
    const b = mt012Mig!.body;
    const occurrences = (s: string, n: string) =>
      (s.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
    expect(occurrences(b, "SECURITY DEFINER")).toBeGreaterThanOrEqual(3);
    expect(occurrences(b, "SET search_path = public")).toBeGreaterThanOrEqual(3);
    expect(occurrences(b, "REVOKE ALL ON FUNCTION public.archive_trade_request")).toBe(1);
    expect(
      occurrences(b, "REVOKE ALL ON FUNCTION public.admin_archive_trade_request_override"),
    ).toBe(1);
    expect(
      occurrences(
        b,
        "REVOKE ALL ON FUNCTION public.admin_release_trade_request_exception_hold",
      ),
    ).toBe(1);
    expect(occurrences(b, "TO service_role")).toBeGreaterThanOrEqual(3);
    expect(b).not.toMatch(/GRANT EXECUTE[^;]+TO (authenticated|anon|PUBLIC)/);
  });

  it("normal archive blocks on active children and emits the canonical audit", () => {
    const b = mt012Mig!.body;
    expect(b).toContain("'trade_request.archive_blocked_active_child_matches'");
    expect(b).toContain("RAISE EXCEPTION 'ACTIVE_CHILDREN_BLOCK'");
  });

  it("normal archive emits archived_normal on success", () => {
    expect(mt012Mig!.body).toContain("'trade_request.archived_normal'");
  });

  it("admin override marks parent and writes exception-hold marker to each active child", () => {
    const b = mt012Mig!.body;
    expect(b).toContain("'admin_override_active_children'");
    expect(b).toContain("'parent_archived_admin_exception_hold',           true");
    expect(b).toContain("parent_archived_admin_exception_hold_at");
    expect(b).toContain("parent_archived_admin_exception_hold_reason");
    expect(b).toContain("parent_archived_admin_exception_hold_parent_id");
    expect(b).toContain("'trade_request.archived_admin_override_active_children'");
  });

  it("admin override requires ≥20-char reason", () => {
    expect(mt012Mig!.body).toMatch(/length\(btrim\(p_reason\)\)\s*<\s*20/);
  });

  it("release clears the marker without unarchiving the parent", () => {
    const b = mt012Mig!.body;
    expect(b).toContain("'trade_request.admin_exception_hold_released'");
    expect(b).toContain("parent_archived_admin_exception_hold_released_at");
    expect(b).toContain("parent_archived_admin_exception_hold_release_reason");
    expect(b).toContain("parent_archived_admin_exception_hold_released_by");
    // explicitly does NOT clear archived_at on the parent
    expect(b).not.toMatch(
      /admin_release_trade_request_exception_hold[\s\S]+?UPDATE public\.trade_requests[\s\S]+?archived_at\s*=\s*NULL/,
    );
    expect(b).toContain("parent_remains_archived");
  });

  it("terminal children are excluded from the active-children block set", () => {
    const b = mt012Mig!.body;
    expect(b).toContain(
      "NOT IN ('completed','cancelled','annulled')",
    );
    expect(b).toContain(
      "NOT IN ('EXPIRED','REJECTED','ANNULLED','CANCELLED','COMPLETED','SETTLED')",
    );
  });

  it("uses an advisory lock on the trade_request id for serialisation", () => {
    const b = mt012Mig!.body;
    expect(b).toContain(
      "pg_advisory_xact_lock(hashtext('trade_request:' || p_trade_request_id::text))",
    );
  });

  it("does not reference any payment / credit-ledger surface", () => {
    const lc = mt012Mig!.body.toLowerCase();
    for (const term of [
      "atomic_token_burn",
      "token_ledger",
      "credits.purchased",
      "credits.granted",
      "payment_intents",
      "paystack",
    ]) {
      expect(lc).not.toContain(term);
    }
  });
});

describe("MT-012 edge functions", () => {
  const archive = read("supabase/functions/trade-request-archive/index.ts");
  const override = read(
    "supabase/functions/admin-trade-request-archive-override/index.ts",
  );
  const release = read(
    "supabase/functions/admin-trade-request-exception-hold-release/index.ts",
  );

  it("owner-org archive validates JWT, resolves org, and maps error codes", () => {
    expect(archive).toContain('Bearer ');
    expect(archive).toContain('"NOT_OWNER"');
    expect(archive).toContain('"ACTIVE_CHILDREN_BLOCK"');
    expect(archive).toContain('"ALREADY_ARCHIVED"');
    expect(archive).toContain("archive_trade_request");
    // No AAL2 step-up on owner-org archive (signed scope).
    expect(archive).not.toContain("assertAal2");
  });

  it("admin override requires platform_admin + AAL2 + reason ≥20", () => {
    expect(override).toContain("is_admin");
    expect(override).toContain('"NOT_PLATFORM_ADMIN"');
    expect(override).toContain("assertAal2");
    expect(override).toContain('"MFA_REQUIRED"');
    expect(override).toContain("MT012_MIN_REASON_LENGTH");
    expect(override).toContain('"REASON_REQUIRED"');
    expect(override).toContain("admin_archive_trade_request_override");
  });

  it("exception-hold release requires platform_admin + AAL2 + reason ≥20", () => {
    expect(release).toContain("is_admin");
    expect(release).toContain('"NOT_PLATFORM_ADMIN"');
    expect(release).toContain("assertAal2");
    expect(release).toContain('"MFA_REQUIRED"');
    expect(release).toContain("MT012_MIN_REASON_LENGTH");
    expect(release).toContain('"REASON_REQUIRED"');
    expect(release).toContain('"NO_EXCEPTION_HOLD"');
    expect(release).toContain("admin_release_trade_request_exception_hold");
  });

  it("no MT-012 edge function references payment / credit surfaces (code, not comments)", () => {
    for (const body of [archive, override, release]) {
      const stripped = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .toLowerCase();
      for (const term of [
        "atomic_token_burn",
        "token_ledger",
        "credits.purchased",
        "credits.granted",
        "payment_intents",
        "paystack",
      ]) {
        expect(stripped).not.toContain(term);
      }
    }
  });
});

describe("MT-012 progression-guard coverage", () => {
  const PROTECTED = [
    "supabase/functions/poi-engagements/index.ts",
    "supabase/functions/poi-transition/index.ts",
    "supabase/functions/wad/index.ts",
    "supabase/functions/p3-wad/index.ts",
    "supabase/functions/collapse/index.ts",
  ];

  it("all five protected surfaces still import assertMatchProgressable", () => {
    for (const p of PROTECTED) {
      expect(existsSync(p), p).toBe(true);
      expect(read(p), p).toContain("assertMatchProgressable");
    }
  });

  it("guard still recognises parent_archived_admin_exception_hold marker", () => {
    const guard = read("supabase/functions/_shared/match-progression-guard.ts");
    expect(guard).toContain("parent_archived_admin_exception_hold");
    // returns the legacy-admin-hold block code so callers see 409.
    expect(guard).toContain("MT_008_LEGACY_ADMIN_HOLD");
  });

  it("client + Deno match-lifecycle mirrors exclude exception-held children from active filters", () => {
    for (const p of [
      "src/lib/match-lifecycle.ts",
      "supabase/functions/_shared/match-lifecycle.ts",
    ]) {
      const b = read(p);
      expect(b).toContain('hasMarker(m, "parent_archived_admin_exception_hold")');
      expect(b).toContain('hasMarker(c, "parent_archived_admin_exception_hold")');
    }
  });
});
