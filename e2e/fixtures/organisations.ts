/**
 * Seeded TEST/UAT organisation IDs (both flagged is_demo=true by seeder).
 *
 * Populated by `scripts/seed-role-negative-e2e.sh` into env.
 */

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

export const ORG_A_ID = env("E2E_RN_ORG_A_ID") ?? "";
export const ORG_B_ID = env("E2E_RN_ORG_B_ID") ?? "";

export const ORG_NAMES = {
  A: "Organisation A TEST/UAT",
  B: "Organisation B TEST/UAT",
} as const;

export type OrgKey = "A" | "B";

export function requireOrgId(key: OrgKey): string {
  const id = key === "A" ? ORG_A_ID : ORG_B_ID;
  if (!id) {
    throw new Error(`Missing E2E_RN_ORG_${key}_ID. Run the seeder first.`);
  }
  return id;
}
