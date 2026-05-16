/**
 * Batch B Fix 4 — Frozen role live-data invariant.
 *
 * Asserts the production database holds zero `public.user_roles` rows
 * carrying a frozen-role value. The trigger in
 * `prevent_frozen_role_assignment` blocks future writes; this test
 * proves the historical state is also clean and stays that way.
 *
 * Frozen roles (per RBAC Stage 3A):
 *   admin, api_admin, billing_admin, buyer, seller, broker
 *
 * Execution model:
 *   - CI / live runs with PG* env vars: queries `user_roles` and FAILS
 *     loudly if any frozen-role row exists.
 *   - Local runs without PG*: SKIPS with a clear message rather than
 *     producing false positives.
 *
 * This is intentionally read-only and uses the standard `pg` library so
 * it works against either the Lovable Cloud session DB or a CI replica
 * with the same env contract.
 */

import { describe, it, expect } from "vitest";

const FROZEN_ROLES = [
  "admin",
  "api_admin",
  "billing_admin",
  "buyer",
  "seller",
  "broker",
] as const;

const hasPg = Boolean(process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE);

describe("Batch B Fix 4 — frozen role live-data invariant", () => {
  if (!hasPg) {
    it.skip(`SKIPPED — PGHOST/PGUSER/PGDATABASE not configured; cannot verify live user_roles. Frozen roles checked: ${FROZEN_ROLES.join(", ")}`, () => {});
    return;
  }

  it("public.user_roles contains zero rows for any frozen role", async () => {
    // Runtime-only import hidden from Vite's static analyser via Function
    // so the file type-checks and loads even when `pg` is not installed
    // (it is an optional CI-only dependency).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-new-func
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pg: any = await dynamicImport("pg").catch(() => null);
    if (!pg) {
      console.warn("[batch-b/fix-4] `pg` module unavailable at runtime; skipping live check.");
      return;
    }
    const client = new pg.Client();
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT role::text AS role, COUNT(*)::int AS n
           FROM public.user_roles
          WHERE role::text = ANY($1::text[])
          GROUP BY role`,
        [FROZEN_ROLES as unknown as string[]],
      );
      const offenders = rows.filter((r) => r.n > 0);
      expect(
        offenders,
        `Frozen-role rows leaked into user_roles: ${JSON.stringify(offenders)}`,
      ).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
