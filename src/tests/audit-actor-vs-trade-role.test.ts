/**
 * audit-actor-vs-trade-role — Phase 1 ownership-ambiguity guardrail.
 *
 * Pattern guarded against:
 *   `audit_logs.actor_role` is treated as if it carried a buyer/seller
 *   trade side. It does not. It carries the **acting user's first RBAC
 *   role** (e.g. `platform_admin`, `org_admin`, `compliance_officer`).
 *   Cross-grouping it with match-side fields produces nonsense.
 *
 * Tests #6 and #7 from the Phase 1 brief:
 *   6. audit-actor-role-not-confused-with-buyer-seller-role
 *   7. notification-recipient-role-not-confused-with-initiator-role
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EDGE_FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");

/** RBAC roles that audit_logs.actor_role is allowed to take. */
const ALLOWED_RBAC_ROLES = new Set([
  "platform_admin",
  "org_admin",
  "billing_admin",
  "api_admin",
  "compliance_officer",
  "compliance",
  "legal",
  "director",
  "auditor",
  "user",
  "member",
  "system",
]);

/** Trade-side values that must NEVER appear as actor_role. */
const FORBIDDEN_TRADE_SIDES = new Set(["buyer", "seller"]);

function listEdgeFunctionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listEdgeFunctionFiles(full));
    } else if (name === "index.ts") {
      out.push(full);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* #6. audit-actor-role-not-confused-with-buyer-seller-role            */
/* ------------------------------------------------------------------ */

describe("audit-actor-role-not-confused-with-buyer-seller-role", () => {
  it("the allowed-RBAC set never overlaps with the forbidden trade-side set", () => {
    for (const tradeSide of FORBIDDEN_TRADE_SIDES) {
      expect(ALLOWED_RBAC_ROLES.has(tradeSide)).toBe(false);
    }
  });

  it("no edge function writes a literal trade-side value into actor_role", () => {
    const files = listEdgeFunctionFiles(EDGE_FUNCTIONS_DIR);
    const offenders: string[] = [];
    // Forbidden patterns: actor_role: "buyer" / "seller" / 'buyer' / 'seller'
    const badPattern = /actor_role\s*:\s*['"](buyer|seller)['"]/i;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (badPattern.test(text)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the canonical write pattern (authCtx.roles?.[0]) is the dominant form", () => {
    const files = listEdgeFunctionFiles(EDGE_FUNCTIONS_DIR);
    let canonicalCount = 0;
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/actor_role\s*:\s*authCtx\.roles\?\.\[0\]/.test(text)) {
        canonicalCount += 1;
      }
    }
    // At least 5 edge functions should follow the canonical form. This
    // is a low-water mark; today the figure is ~12.
    expect(canonicalCount).toBeGreaterThanOrEqual(5);
  });

  it("the actor-context shared module documents the actor_role ownership rule", () => {
    const text = readFileSync(
      join(EDGE_FUNCTIONS_DIR, "_shared", "actor-context.ts"),
      "utf8",
    );
    expect(text).toMatch(/OWNERSHIP/);
    expect(text).toMatch(/actor_role/);
    expect(text).toMatch(/RBAC/);
    expect(text).toMatch(/NEVER a buyer\/seller trade side/i);
  });
});

/* ------------------------------------------------------------------ */
/* #7. notification-recipient-role-not-confused-with-initiator-role    */
/* ------------------------------------------------------------------ */

describe("notification-recipient-role-not-confused-with-initiator-role", () => {
  /**
   * Mirror of the contract in
   *   supabase/functions/poi-engagements/index.ts:248-253, 510-515
   *   supabase/functions/_shared/transactional-email-templates/outreach-intent-to-trade.tsx
   *
   * `counterpartyRole` (the email template prop) = the role we are
   * inviting THEM to play = the OPPOSITE side from the initiator.
   */
  function deriveRecipientRole(
    initiatorOrgId: string,
    match: { buyer_org_id: string | null; seller_org_id: string | null },
  ): "buyer" | "seller" | null {
    if (match.buyer_org_id === initiatorOrgId) return "seller";
    if (match.seller_org_id === initiatorOrgId) return "buyer";
    return null;
  }

  it("a buyer initiator invites the recipient as the SELLER", () => {
    const recipientRole = deriveRecipientRole("org-A", {
      buyer_org_id: "org-A",
      seller_org_id: null,
    });
    expect(recipientRole).toBe("seller");
  });

  it("a seller initiator invites the recipient as the BUYER", () => {
    const recipientRole = deriveRecipientRole("org-A", {
      buyer_org_id: null,
      seller_org_id: "org-A",
    });
    expect(recipientRole).toBe("buyer");
  });

  it("recipient role is NEVER equal to initiator role for the same trade", () => {
    // Property: for any populated buyer/seller slots where the initiator
    // sits in one of them, the recipient role must be the opposite.
    const cases = [
      { initiator: "org-A", buyer: "org-A", seller: "org-B" },
      { initiator: "org-B", buyer: "org-A", seller: "org-B" },
    ];
    for (const c of cases) {
      const initiatorIsBuyer = c.buyer === c.initiator;
      const initiatorRole = initiatorIsBuyer ? "buyer" : "seller";
      const recipientRole = deriveRecipientRole(c.initiator, {
        buyer_org_id: c.buyer,
        seller_org_id: c.seller,
      });
      expect(recipientRole).not.toBe(initiatorRole);
    }
  });

  it("returns null when initiator is not in either slot (no silent default)", () => {
    expect(
      deriveRecipientRole("org-X", {
        buyer_org_id: "org-A",
        seller_org_id: "org-B",
      }),
    ).toBeNull();
  });

  it("the outreach email template documents counterpartyRole as 'role we're inviting THEM to play'", () => {
    const text = readFileSync(
      join(
        EDGE_FUNCTIONS_DIR,
        "_shared",
        "transactional-email-templates",
        "outreach-intent-to-trade.tsx",
      ),
      "utf8",
    );
    expect(text).toMatch(/counterpartyRole/);
    expect(text).toMatch(/inviting THEM to play/i);
  });
});
