// NOT-008 behavioural — proves the shared helper:
//   1. Skips legacy rows (no entity_id) without calling the RPC.
//   2. Forwards entity_type/entity_id correctly to the SECURITY DEFINER RPC.
//   3. Returns the row-count the RPC produced so callers can audit it.
//   4. Never throws when the RPC errors (Zero Swallowed Errors policy: log + return ok:false).
//
// We also assert the SQL function only flips rows that match BOTH entity_type
// AND entity_id, leaving legacy (NULL entity_id) rows untouched.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolveNotificationsFor } from "../../supabase/functions/_shared/resolve-notifications.ts";

function makeAdmin(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) };
}

describe("NOT-008 — resolveNotificationsFor() behaviour", () => {
  it("skips legacy notifications (no entity_id) — RPC is never called", async () => {
    const admin = makeAdmin(async () => ({ data: 0, error: null }));
    const result = await resolveNotificationsFor(admin as any, "poi_engagement", null);
    expect(result).toEqual({ ok: true, resolved: 0 });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("skips when entity_type is empty", async () => {
    const admin = makeAdmin(async () => ({ data: 5, error: null }));
    const result = await resolveNotificationsFor(admin as any, "", "11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(0);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("forwards entity_type / entity_id to resolve_notifications_for and reports the resolved count", async () => {
    const admin = makeAdmin(async (fn, args) => {
      expect(fn).toBe("resolve_notifications_for");
      expect(args).toEqual({
        p_entity_type: "poi_engagement",
        p_entity_id: "22222222-2222-2222-2222-222222222222",
      });
      return { data: 3, error: null };
    });
    const result = await resolveNotificationsFor(
      admin as any,
      "poi_engagement",
      "22222222-2222-2222-2222-222222222222",
      { requestId: "req-test", source: "test" },
    );
    expect(result).toEqual({ ok: true, resolved: 3 });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false but does not throw when the RPC errors", async () => {
    const admin = makeAdmin(async () => ({ data: null, error: { message: "boom" } }));
    const result = await resolveNotificationsFor(admin as any, "match_challenge", "33333333-3333-3333-3333-333333333333");
    expect(result.ok).toBe(false);
    expect(result.resolved).toBe(0);
    expect(result.error).toBe("boom");
  });

  it("does not throw when the RPC promise rejects", async () => {
    const admin = makeAdmin(async () => {
      throw new Error("network");
    });
    const result = await resolveNotificationsFor(admin as any, "breach", "44444444-4444-4444-4444-444444444444");
    expect(result.ok).toBe(false);
    expect(result.resolved).toBe(0);
  });
});

describe("NOT-008 — SQL contract (resolve_notifications_for definition)", () => {
  const sql = readFileSync(
    "supabase/migrations/20260516161747_d5b914c5-62ac-4429-b3bc-c7b2d80780be.sql",
    "utf8",
  );

  it("only flips rows that match BOTH entity_type AND entity_id (legacy rows safe)", () => {
    expect(sql).toMatch(/UPDATE\s+public\.notifications/);
    expect(sql).toMatch(/WHERE entity_type = p_entity_type/);
    expect(sql).toMatch(/AND entity_id = p_entity_id/);
  });

  it("short-circuits to 0 when either parameter is NULL", () => {
    expect(sql).toMatch(/IF p_entity_type IS NULL OR p_entity_id IS NULL THEN[\s\S]*?RETURN 0/);
  });

  it("only updates still-unread / unresolved rows (idempotent re-runs)", () => {
    expect(sql).toMatch(/\(read = false OR resolved_at IS NULL\)/);
  });

  it("is service_role-only (EXECUTE revoked from anon/authenticated/PUBLIC)", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_notifications_for\(text, uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_notifications_for\(text, uuid\) TO service_role/);
  });
});

describe("NOT-008 — admin_risk_item resolution wiring", () => {
  const tokenPurchase = readFileSync("supabase/functions/token-purchase/index.ts", "utf8");
  it("resolves notifications when a chargeback hold's risk item is marked resolved (won path)", () => {
    expect(tokenPurchase).toMatch(/resolveNotificationsFor\([^)]+,\s*["']admin_risk_item["'][^)]+chargeback_won/);
  });
  it("resolves notifications when a chargeback hold's risk item is marked resolved (lost path)", () => {
    expect(tokenPurchase).toMatch(/resolveNotificationsFor\([^)]+,\s*["']admin_risk_item["'][^)]+chargeback_lost/);
  });
});

describe("NOT-008 — binding-review dispute resolution", () => {
  const poi = readFileSync("supabase/functions/poi-engagements/index.ts", "utf8");
  it("clears engagement notifications when binding review is confirmed_canonical or deferred (not rejected)", () => {
    expect(poi).toMatch(/parsed\.data\.resolution !== ["']rejected["'][\s\S]{0,400}resolveNotificationsFor\([^)]+,\s*["']poi_engagement["']/);
  });
});
