/**
 * Ticket 4 — Org Status Vocabulary (Blocked vs Suspended).
 *
 * Audit decision (see chat closeout): `organizations.frozen` is kept as the
 * internal compliance/collapse primitive. The separate `organizations.status`
 * column already owns the 'active'/'suspended'/'inactive' admin lifecycle.
 * To remove the vocabulary collision, the user-facing message for `frozen=true`
 * now says "restricted" (not "suspended"), and the admin reconciliation
 * report labels frozen orgs as "blocked (...)". No schema change. No gate
 * logic change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("Ticket 4 — org status vocabulary (display-only)", () => {
  it("user-facing legitimacy message uses 'restricted', not 'suspended'", () => {
    const hook = readFileSync(
      path.join(repoRoot, "src/hooks/use-org-legitimacy.ts"),
      "utf8",
    );
    expect(hook).toMatch(/currently restricted/);
    expect(hook).toMatch(/lifts the restriction/);
    expect(hook).not.toMatch(/currently suspended/);
  });

  it("server legitimacy gate uses 'restricted' in the user message", () => {
    const srv = readFileSync(
      path.join(repoRoot, "supabase/functions/_shared/legitimacy.ts"),
      "utf8",
    );
    expect(srv).toMatch(/currently restricted/);
    expect(srv).not.toMatch(/currently suspended/);
  });

  it("admin reconciliation labels frozen orgs as 'blocked', not 'frozen'", () => {
    const fn = readFileSync(
      path.join(
        repoRoot,
        "supabase/functions/admin-org-reconciliation/index.ts",
      ),
      "utf8",
    );
    expect(fn).toMatch(/`blocked \(\$\{org\.frozen_reason/);
    expect(fn).not.toMatch(/`frozen \(\$\{org\.frozen_reason/);
  });

  it("internal reason code on the gate remains 'frozen' (no schema/contract change)", () => {
    const srv = readFileSync(
      path.join(repoRoot, "supabase/functions/_shared/legitimacy.ts"),
      "utf8",
    );
    // Reason code is the stable machine contract consumed by audit logs and
    // Ticket 2 admin visibility. It MUST NOT be renamed.
    expect(srv).toMatch(/reason: "frozen"/);
  });

  it("organizations.status admin lifecycle ('suspended') is untouched", () => {
    const orgsMgmt = readFileSync(
      path.join(repoRoot, "src/components/admin/OrgsManagement.tsx"),
      "utf8",
    );
    // The independent status column still owns 'Suspended' as a lifecycle
    // option for admins; the frozen relabel above must not collide with it.
    expect(orgsMgmt).toMatch(/value="suspended"/);
  });
});
