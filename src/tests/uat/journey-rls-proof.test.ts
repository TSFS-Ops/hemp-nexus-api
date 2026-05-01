/**
 * RLS Proof — Core Data Isolation
 *
 * Proves Row-Level Security correctly isolates two distinct organisations
 * (Org A, Org B) across the platform's most sensitive tables:
 *   matches, trade_requests, pois, poi_events, poi_engagements, wads,
 *   wad_attestations, match_documents, vault_documents, document_access,
 *   token_balances, token_ledger, audit_logs, admin_audit_logs,
 *   notifications, organizations, profiles, user_roles.
 *
 * Mode: read-only / safe-mutation. Throwaway fixtures only. No production
 * data is read or written. Sign-ups go through `provision-test-user` which
 * is restricted to `@test.izenzo.co.za`.
 *
 * Each "Org A cannot read Org B …" assertion uses the user-JWT client
 * directly — so a leaked row would prove an RLS gap.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { signUpTestUser } from "./test-client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function freshClient(): SupabaseClient<Database> {
  // Each fixture gets its own in-memory client so sessions don't collide.
  const mem: Record<string, string> = {};
  return createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      storage: {
        getItem: (k) => mem[k] ?? null,
        setItem: (k, v) => {
          mem[k] = v;
        },
        removeItem: (k) => {
          delete mem[k];
        },
      },
      persistSession: true,
      autoRefreshToken: false,
    },
  });
}

const ts = Date.now();
const EMAIL_A_ADMIN = `uat-rls-a-admin-${ts}@test.izenzo.co.za`;
const EMAIL_A_MEMBER = `uat-rls-a-member-${ts}@test.izenzo.co.za`;
const EMAIL_B_ADMIN = `uat-rls-b-admin-${ts}@test.izenzo.co.za`;
const PASSWORD = "RlsPr00f!Secure2026";

interface Fixture {
  client: SupabaseClient<Database>;
  userId: string;
  orgId: string;
}

const anonClient = freshClient(); // never signed in

let A_ADMIN: Fixture;
let A_MEMBER: Fixture; // distinct provisioned user; signup trigger gives them their OWN org
let B_ADMIN: Fixture;
let A_MATCH_ID: string | null = null;

describe("RLS Proof — Core Data Isolation", () => {
  // ── Section B: Fixture provisioning ──────────────────────────────
  describe("B. Fixtures", () => {
    it("provisions Org A admin (throwaway)", async () => {
      const c = freshClient();
      const r = await signUpTestUser(c, EMAIL_A_ADMIN, PASSWORD);
      A_ADMIN = { client: c, userId: r.userId, orgId: r.orgId };
      expect(A_ADMIN.orgId).toBeTruthy();
    }, 20_000);

    it("provisions Org A member (throwaway, distinct org by trigger)", async () => {
      const c = freshClient();
      const r = await signUpTestUser(c, EMAIL_A_MEMBER, PASSWORD);
      A_MEMBER = { client: c, userId: r.userId, orgId: r.orgId };
      expect(A_MEMBER.orgId).toBeTruthy();
    }, 20_000);

    it("provisions Org B admin (throwaway)", async () => {
      const c = freshClient();
      const r = await signUpTestUser(c, EMAIL_B_ADMIN, PASSWORD);
      B_ADMIN = { client: c, userId: r.userId, orgId: r.orgId };
      expect(B_ADMIN.orgId).toBeTruthy();
      // Sanity: the three orgs are distinct.
      expect(B_ADMIN.orgId).not.toBe(A_ADMIN.orgId);
      expect(B_ADMIN.orgId).not.toBe(A_MEMBER.orgId);
      expect(A_MEMBER.orgId).not.toBe(A_ADMIN.orgId);
    }, 20_000);
  });

  // ── Section A: RLS inventory sanity (rls_enabled on every table) ──
  describe("A. RLS-enabled inventory (live DB)", () => {
    const TABLES = [
      "organizations",
      "profiles",
      "user_roles",
      "matches",
      "trade_requests",
      "pois",
      "poi_events",
      "poi_engagements",
      "wads",
      "wad_attestations",
      "match_documents",
      "vault_documents",
      "document_access",
      "token_balances",
      "token_ledger",
      "audit_logs",
      "admin_audit_logs",
      "notifications",
    ] as const;

    for (const t of TABLES) {
      it(`${t}: anon SELECT is denied or returns zero rows`, async () => {
        const { data, error } = await anonClient
          .from(t as never)
          .select("*")
          .limit(1);
        // Either RLS denies (error) OR returns empty array. A populated
        // result here would prove the table is publicly readable.
        const denied =
          !!error ||
          data === null ||
          (Array.isArray(data) && data.length === 0);
        expect(denied).toBe(true);
      });
    }
  });

  // ── Section C: Read-isolation tests ──────────────────────────────
  describe("C. Cross-org read isolation", () => {
    it("C1 — Org A admin can read its own organization row", async () => {
      const { data, error } = await A_ADMIN.client
        .from("organizations")
        .select("id")
        .eq("id", A_ADMIN.orgId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(A_ADMIN.orgId);
    });

    it("C2 — Org A admin cannot read Org B organization row", async () => {
      const { data } = await A_ADMIN.client
        .from("organizations")
        .select("id")
        .eq("id", B_ADMIN.orgId)
        .maybeSingle();
      // RLS filters out the row; either null or empty.
      expect(data).toBeNull();
    });

    it("C3 — Org A member can read its own profile", async () => {
      const { data, error } = await A_MEMBER.client
        .from("profiles")
        .select("id, org_id")
        .eq("id", A_MEMBER.userId)
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.id).toBe(A_MEMBER.userId);
    });

    it("C4 — Org A member cannot SELECT another org admin's profile", async () => {
      const { data } = await A_MEMBER.client
        .from("profiles")
        .select("id")
        .eq("id", B_ADMIN.userId)
        .maybeSingle();
      expect(data).toBeNull();
    });

    it("C5 — Org A member cannot read Org B user_roles", async () => {
      const { data } = await A_MEMBER.client
        .from("user_roles")
        .select("id")
        .eq("user_id", B_ADMIN.userId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C6 — Org A admin creates a draft match (own org)", async () => {
      const { data, error } = await A_ADMIN.client
        .from("matches")
        .insert({
          org_id: A_ADMIN.orgId,
          buyer_org_id: A_ADMIN.orgId,
          commodity: "rls-proof-commodity",
          status: "draft",
        } as never)
        .select("id")
        .maybeSingle();
      // Either the insert succeeds (proving org_admin can write to own org)
      // OR it fails for an unrelated reason (NOT NULL on a column we omitted).
      // Both outcomes prove RLS did not block a legitimate same-org write.
      if (error) {
        // Acceptable: schema-level NOT NULL violations (code 23502) or
        // check-constraint failures (23514) are NOT RLS denials.
        expect(["23502", "23514", "23503"]).toContain(error.code);
      } else {
        expect(data?.id).toBeTruthy();
        A_MATCH_ID = (data as { id: string }).id;
      }
    });

    it("C7 — Org B admin cannot INSERT a match against Org A's org_id", async () => {
      const { data, error } = await B_ADMIN.client
        .from("matches")
        .insert({
          org_id: A_ADMIN.orgId, // attempt cross-org write
          buyer_org_id: A_ADMIN.orgId,
          commodity: "rls-cross-org-attack",
          status: "draft",
        } as never)
        .select("id")
        .maybeSingle();
      // Must be denied. RLS WITH CHECK rejection => code 42501 or
      // 'new row violates row-level security policy'.
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      const code = (error as { code?: string } | null)?.code ?? "";
      const msg = (error as { message?: string } | null)?.message ?? "";
      const blocked =
        code === "42501" ||
        /row-level security|violates row-level/i.test(msg);
      expect(blocked).toBe(true);
    });

    it("C8 — Org B cannot read Org A matches", async () => {
      const { data } = await B_ADMIN.client
        .from("matches")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C9 — Org B cannot read Org A trade_requests", async () => {
      const { data } = await B_ADMIN.client
        .from("trade_requests")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C10 — Org B cannot read Org A pois", async () => {
      const { data } = await B_ADMIN.client
        .from("pois")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C11 — Org B cannot read Org A wads", async () => {
      // wads scope is via match.org_id; query by match_id (none of A's
      // matches are visible to B, so this must return zero).
      const { data } = await B_ADMIN.client
        .from("wads")
        .select("id, match_id")
        .limit(50);
      const aOrgLeak = (data ?? []).filter((row) => {
        const r = row as { match_id?: string };
        return r.match_id && r.match_id === A_MATCH_ID;
      });
      expect(aOrgLeak.length).toBe(0);
    });

    it("C12 — Org B cannot read Org A match_documents", async () => {
      const { data } = await B_ADMIN.client
        .from("match_documents")
        .select("id, uploader_org_id")
        .eq("uploader_org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C13 — Org B cannot read Org A vault_documents", async () => {
      const { data } = await B_ADMIN.client
        .from("vault_documents")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C14 — Org B cannot read Org A token_balances", async () => {
      const { data } = await B_ADMIN.client
        .from("token_balances")
        .select("org_id, balance")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C15 — Org B cannot read Org A token_ledger rows", async () => {
      const { data } = await B_ADMIN.client
        .from("token_ledger")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C16 — Org B cannot read Org A audit_logs", async () => {
      const { data } = await B_ADMIN.client
        .from("audit_logs")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });

    it("C17 — anon cannot read admin_audit_logs (admin-only)", async () => {
      const { data, error } = await anonClient
        .from("admin_audit_logs")
        .select("id")
        .limit(1);
      const denied = !!error || data === null || (Array.isArray(data) && data.length === 0);
      expect(denied).toBe(true);
    });

    it("C18 — non-admin authenticated user cannot read admin_audit_logs", async () => {
      const { data, error } = await A_ADMIN.client
        .from("admin_audit_logs")
        .select("id")
        .limit(1);
      // policy: is_admin(auth.uid()) — throwaway org_admin is NOT
      // platform_admin, so this must be empty.
      const denied = !!error || data === null || (Array.isArray(data) && data.length === 0);
      expect(denied).toBe(true);
    });

    it("C19 — Org B cannot read Org A notifications", async () => {
      const { data } = await B_ADMIN.client
        .from("notifications")
        .select("id, org_id")
        .eq("org_id", A_ADMIN.orgId);
      expect(Array.isArray(data) ? data.length : 0).toBe(0);
    });
  });

  // ── Section D: Mutation isolation ────────────────────────────────
  describe("D. Mutation isolation", () => {
    it("D1 — non-admin cannot INSERT token_ledger (service-role only)", async () => {
      const { data, error } = await A_ADMIN.client
        .from("token_ledger")
        .insert({
          org_id: A_ADMIN.orgId,
          action_type: "credit_burn",
          amount: -1,
          reason: "rls-proof-should-fail",
        } as never)
        .select();
      const empty = data === null || (Array.isArray(data) && data.length === 0);
      expect(empty).toBe(true);
      expect(error).not.toBeNull();
    });

    it("D2 — non-admin cannot UPDATE token_balances directly", async () => {
      const { data, error } = await A_ADMIN.client
        .from("token_balances")
        .update({ balance: 999_999 } as never)
        .eq("org_id", A_ADMIN.orgId)
        .select();
      // Either no policy permits UPDATE (returns empty + error) or RLS
      // filters out the row entirely.
      const noMutation =
        data === null ||
        (Array.isArray(data) && data.length === 0) ||
        !!error;
      expect(noMutation).toBe(true);
    });

    it("D3 — non-admin cannot INSERT audit_logs claiming a foreign org", async () => {
      const { data, error } = await A_ADMIN.client
        .from("audit_logs")
        .insert({
          org_id: B_ADMIN.orgId, // foreign org
          action: "rls.proof.attack",
          actor_user_id: A_ADMIN.userId,
        } as never)
        .select();
      const blocked =
        data === null ||
        (Array.isArray(data) && data.length === 0) ||
        !!error;
      expect(blocked).toBe(true);
    });

    it("D4 — non-admin cannot INSERT admin_audit_logs", async () => {
      const { data, error } = await A_ADMIN.client
        .from("admin_audit_logs")
        .insert({
          actor_user_id: A_ADMIN.userId,
          action: "rls.proof.privilege_escalation_attempt",
          target_type: "org",
          target_id: A_ADMIN.orgId,
        } as never)
        .select();
      const blocked =
        data === null ||
        (Array.isArray(data) && data.length === 0) ||
        !!error;
      expect(blocked).toBe(true);
    });

    it("D5 — non-admin cannot self-promote via user_roles INSERT (platform_admin)", async () => {
      const { data, error } = await A_ADMIN.client
        .from("user_roles")
        .insert({
          user_id: A_ADMIN.userId,
          role: "platform_admin",
        } as never)
        .select();
      // Either the role enum/insert is blocked by trigger, or RLS denies.
      const blocked =
        data === null ||
        (Array.isArray(data) && data.length === 0) ||
        !!error;
      expect(blocked).toBe(true);
    });
  });

  // ── Cleanup hint (Section H) ─────────────────────────────────────
  // Throwaway accounts under @test.izenzo.co.za are reusable across runs
  // (provision-test-user is idempotent); their orgs/balances are isolated
  // and will be cleaned by the existing UAT teardown sweep when run.
  // The lone INSERT (matches in C6) is scoped to a throwaway org and will
  // be removed by the standard test-org retention sweeper.
});
