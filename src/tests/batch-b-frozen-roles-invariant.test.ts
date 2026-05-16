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
    // Lazy import so vitest still loads when `pg` is unavailable locally.
    const { Client } = await import("pg");
    const client = new Client();
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
