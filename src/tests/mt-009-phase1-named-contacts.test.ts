/**
 * MT-009 Phase 1 — predicate, read-model and source-guard tests.
 *
 * Scope: detection-only. No hard progression guard. No email/invite path.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  requiresNamedContact,
  type ActiveNamedContact,
  type LifecycleMatch,
} from "@/lib/match-lifecycle";

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const USER = "00000000-0000-0000-0000-0000000000ff";

const baseBilateral: LifecycleMatch = {
  buyer_org_id: ORG_A,
  seller_org_id: ORG_B,
};

describe("MT-009 Phase 1 — requiresNamedContact", () => {
  it("returns null when no organisation is attached on either side", () => {
    expect(requiresNamedContact({})).toBeNull();
  });

  it("satisfies a side via registered authorised user", () => {
    const m: LifecycleMatch = {
      ...baseBilateral,
      buyer_authorised_user_id: USER,
      seller_authorised_user_id: USER,
    };
    expect(requiresNamedContact(m)).toBeNull();
  });

  it("satisfies a side via active controlled named contact", () => {
    const contacts: ActiveNamedContact[] = [
      { side: "buyer", status: "active" },
      { side: "seller", status: "active" },
    ];
    expect(requiresNamedContact(baseBilateral, contacts)).toBeNull();
  });

  it("flags buyer missing when only seller is satisfied", () => {
    const m: LifecycleMatch = {
      ...baseBilateral,
      seller_authorised_user_id: USER,
    };
    expect(requiresNamedContact(m)).toBe("buyer");
  });

  it("flags seller missing when only buyer is satisfied", () => {
    const contacts: ActiveNamedContact[] = [{ side: "buyer", status: "active" }];
    expect(requiresNamedContact(baseBilateral, contacts)).toBe("seller");
  });

  it("flags both when neither side has a registered user or controlled contact", () => {
    expect(requiresNamedContact(baseBilateral)).toBe("both");
  });

  it("ignores replaced / revoked controlled contacts", () => {
    const contacts: ActiveNamedContact[] = [
      { side: "buyer", status: "replaced" },
      { side: "seller", status: "revoked" },
    ];
    expect(requiresNamedContact(baseBilateral, contacts)).toBe("both");
  });

  it("allows registered user AND controlled contact to co-exist (registered wins for display, both satisfy)", () => {
    const m: LifecycleMatch = {
      ...baseBilateral,
      buyer_authorised_user_id: USER,
      seller_authorised_user_id: USER,
    };
    const contacts: ActiveNamedContact[] = [
      { side: "buyer", status: "active" },
      { side: "seller", status: "active" },
    ];
    expect(requiresNamedContact(m, contacts)).toBeNull();
  });

  it("only flags sides that have an attached organisation", () => {
    const oneSided: LifecycleMatch = { buyer_org_id: ORG_A };
    expect(requiresNamedContact(oneSided)).toBe("buyer");
    expect(
      requiresNamedContact(oneSided, [{ side: "buyer", status: "active" }]),
    ).toBeNull();
  });
});

describe("MT-009 Phase 1 — client/edge mirror parity", () => {
  it("client and edge mirror blocks are byte-identical", () => {
    const root = process.cwd();
    const extract = (p: string) => {
      const src = readFileSync(join(root, p), "utf8");
      const s = src.indexOf("// MIRROR-START");
      const e = src.indexOf("// MIRROR-END");
      return src.slice(s, e + "// MIRROR-END".length);
    };
    expect(extract("src/lib/match-lifecycle.ts")).toBe(
      extract("supabase/functions/_shared/match-lifecycle.ts"),
    );
  });

  it("ActiveNamedContact type is exported from both mirrors", () => {
    const root = process.cwd();
    for (const p of [
      "src/lib/match-lifecycle.ts",
      "supabase/functions/_shared/match-lifecycle.ts",
    ]) {
      const src = readFileSync(join(root, p), "utf8");
      expect(src).toMatch(/export type ActiveNamedContact/);
    }
  });
});

describe("MT-009 Phase 1 — read-model isolation", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/match-named-contacts.ts"),
    "utf8",
  );
  const rpcMigration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260518170226_58c08639-c33c-4101-90c7-8025c7bcb8c2.sql",
    ),
    "utf8",
  );

  it("does not import POI, WaD, payment, credit, or notification modules", () => {
    // Check imports only — comments may reference these names to explain policy.
    const imports = src.match(/^import .+from .+$/gm) ?? [];
    const joined = imports.join("\n");
    expect(joined).not.toMatch(/poi-|wad|payment|credit|notification|resend|invite|email-/i);
  });

  it("uses the SECURITY DEFINER RPC and never mutates the table", () => {
    // MT-009 Phase 2: read goes through get_match_named_contact_status so
    // both sides of a match are visible to authorised participants.
    expect(src).toMatch(/rpc\(\s*"get_match_named_contact_status"/);
    expect(src).not.toMatch(/from\("match_named_contacts"\)\s*\.\s*select/);
    expect(src).not.toMatch(/from\("match_named_contacts"\)\s*\.\s*insert/);
    expect(src).not.toMatch(/from\("match_named_contacts"\)\s*\.\s*update/);
    expect(src).not.toMatch(/from\("match_named_contacts"\)\s*\.\s*delete/);
    expect(src).not.toMatch(/from\("match_named_contacts"\)\s*\.\s*upsert/);
  });

  it("keeps base-table RLS narrow while granting the cross-side read RPC", () => {
    expect(rpcMigration).toMatch(/SECURITY DEFINER/);
    expect(rpcMigration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_match_named_contact_status\(uuid\) TO authenticated/);
    expect(rpcMigration).toMatch(/v_caller_org IS DISTINCT FROM v_buyer/);
    expect(rpcMigration).toMatch(/v_caller_org IS DISTINCT FROM v_seller/);
    expect(rpcMigration).not.toMatch(/CREATE POLICY[\s\S]*match_named_contacts[\s\S]*buyer_org_id/);
    expect(rpcMigration).not.toMatch(/CREATE POLICY[\s\S]*match_named_contacts[\s\S]*seller_org_id/);
  });
});

describe("MT-009 Phase 1 — UI panel is display-only", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/match/NamedContactPanel.tsx"),
    "utf8",
  );

  it("does not import any mutation/notification/POI/WaD/payment/credit module", () => {
    // Check imports, not free-text. Phase 1 panel is allowed to mention
    // "notification" / "email" in user-facing copy explaining the policy.
    const imports = src.match(/^import .+from .+$/gm) ?? [];
    const joined = imports.join("\n");
    expect(joined).not.toMatch(/poi-|wad|payment|credit|notification|resend|invite|email-/i);
    expect(src).not.toMatch(/functions\.invoke\(/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
  });

  it("renders the missing-contact banner element via data-testid", () => {
    expect(src).toMatch(/data-testid="named-contact-missing-banner"/);
  });

  it("uses the canonical predicate from match-lifecycle", () => {
    expect(src).toMatch(/from "@\/lib\/match-lifecycle"/);
    expect(src).toMatch(/requiresNamedContact/);
  });
});

describe("MT-009 Phase 1 — no hard progression guard wired yet", () => {
  it("engagement-progression-guard does not import match-named-contacts", () => {
    const p = join(
      process.cwd(),
      "src/lib/engagement-progression-guard.ts",
    );
    let src = "";
    try {
      src = readFileSync(p, "utf8");
    } catch {
      return; // file optional in some branches
    }
    expect(src).not.toMatch(/match-named-contacts/);
  });

  it("MatchDetails does not block render on missing named contact", () => {
    const src = readFileSync(
      join(process.cwd(), "src/pages/MatchDetails.tsx"),
      "utf8",
    );
    // Panel is rendered but never used as a gate for other children
    expect(src).toMatch(/NamedContactPanel/);
    expect(src).not.toMatch(/requiresNamedContact\([^)]*\)\s*!==?\s*null\s*\?\s*null/);
  });
});
