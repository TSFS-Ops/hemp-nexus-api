/**
 * Phase 3 (Compliance Case Management Workbench) -- permission-resolver
 * structural guard.
 *
 * Mirrors the existing p5-batch1-enum-drift.test.ts pattern: reads the
 * Phase 3 migrations as text and asserts the mandatory rules are encoded
 * the way the Phase 3 spec requires, so a future edit that silently
 * loosens one of them fails the build instead of shipping quietly.
 *
 * This is a static/structural guard, not a live-database RLS proof. A
 * live, transaction-rollback-safe negative-access proof covering the
 * same rules lives at supabase/tests/cw_phase3_permission_matrix_proof.sql
 * for manual/CI-wired execution against a migrated disposable database,
 * following the same convention as supabase/tests/phase_1a_support_behavioural_proof.sql.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadMigration(marker: string): string {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const bodies = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
    const found = bodies.find((b) => b.includes(marker));
    if (!found) throw new Error(`Migration containing marker "${marker}" not found`);
    return found;
}

function extractFunctionBody(sql: string, fnName: string): string {
    const re = new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${fnName}\\([^)]*\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
        );
    const m = sql.match(re);
    if (!m) throw new Error(`Could not find function body for public.${fnName}`);
    return m[1];
}

const resolverSql = loadMigration("Phase 3, Increment 1: compliance permission-resolution bridge");
const rlsSql = loadMigration("Phase 3, Increment 2: RLS write-policies + case-mutation guard");

describe("Phase 3 permission resolver -- role vocabulary", () => {
    const expectedNewRoles = [
          "compliance_analyst",
          "compliance_ops_lead",
          "legal_reviewer",
          "senior_compliance_approver",
          "director",
          "funder_viewer",
          "security_incident_commander",
          "technical_support",
        ];

           it.each(expectedNewRoles)("guards ADD VALUE '%s' with an existence check", (role) => {
                 const re = new RegExp(
                         `IF NOT EXISTS \\(SELECT 1 FROM pg_enum WHERE enumtypid = 'public\\.app_role'::regtype AND enumlabel = '${role}'\\) THEN\\s*\\n\\s*ALTER TYPE public\\.app_role ADD VALUE '${role}';`,
                       );
                 expect(resolverSql).toMatch(re);
           });
});

describe("Phase 3 permission resolver -- mandatory decision-authority rule", () => {
    it("cw_is_compliance_decision_maker excludes platform_admin", () => {
          const body = extractFunctionBody(resolverSql, "cw_is_compliance_decision_maker");
          expect(body).not.toMatch(/platform_admin/);
    });

           it("cw_is_compliance_decision_maker excludes compliance_analyst (analyst != decision-maker)", () => {
                 const body = extractFunctionBody(resolverSql, "cw_is_compliance_decision_maker");
                 expect(body).not.toMatch(/'compliance_analyst'/);
           });

           it("cw_can_decide_case resolves to cw_is_compliance_decision_maker only", () => {
                 const body = extractFunctionBody(resolverSql, "cw_can_decide_case");
                 expect(body).toMatch(/cw_is_compliance_decision_maker/);
                 expect(body).not.toMatch(/platform_admin/);
           });

           it("cw_can_assign_case does not grant decision authority by itself", () => {
                 const body = extractFunctionBody(resolverSql, "cw_can_assign_case");
                 expect(body).toMatch(/cw_is_platform_admin|platform_admin/);
                 expect(body).toMatch(/compliance_ops_lead/);
           });
});

describe("Phase 3 permission resolver -- read capability preserves existing access", () => {
    it("cw_can_read_case still includes org membership (does not narrow existing tenant access)", () => {
          const body = extractFunctionBody(resolverSql, "cw_can_read_case");
          expect(body).toMatch(/cw_is_org_member/);
    });

           it("cw_can_read_case includes auditor and compliance-analyst visibility", () => {
                 const body = extractFunctionBody(resolverSql, "cw_can_read_case");
                 expect(body).toMatch(/cw_is_auditor/);
                 expect(body).toMatch(/cw_is_compliance_analyst/);
           });
});

describe("Phase 3 RLS -- additive-only SELECT policies", () => {
    it("adds a compliance-staff SELECT policy on cw_cases alongside (not replacing) Phase 1's policies", () => {
          expect(rlsSql).toMatch(/CREATE POLICY "cw_cases_compliance_staff_select"/);
          expect(rlsSql).not.toMatch(/DROP POLICY[^;]*cw_cases_org_select/);
          expect(rlsSql).not.toMatch(/DROP POLICY[^;]*cw_cases_admin_select/);
    });

           it("repairs the dormant admin-only legacy-exceptions policy by adding a platform_admin policy, without touching the original", () => {
                 expect(rlsSql).toMatch(/CREATE POLICY "cw_legacy_exceptions_platform_admin_select"/);
                 expect(rlsSql).not.toMatch(/DROP POLICY[^;]*cw_legacy_exceptions_admin_select/);
           });
});

describe("Phase 3 RLS -- auditor export requires an explicit grant", () => {
    it("cw_can_export_case_data does not blanket-authorise every auditor", () => {
          const body = extractFunctionBody(rlsSql, "cw_can_export_case_data");
          expect(body).toMatch(/cw_auditor_export_grants/);
          expect(body).toMatch(/cw_is_auditor/);
    });

           it("cw_auditor_export_grants has RLS enabled", () => {
                 expect(rlsSql).toMatch(/ALTER TABLE public\.cw_auditor_export_grants ENABLE ROW LEVEL SECURITY/);
           });
});

describe("Phase 3 RLS -- history immutability and capability-scoped mutation", () => {
    it("blocks amending a decided/closed case's decision fields", () => {
          expect(rlsSql).toMatch(/cw\.history_immutable/);
          expect(rlsSql).toMatch(/'approved','conditionally_approved','rejected','closed'/);
    });

           it("requires cw_can_decide_case for a decision-outcome transition", () => {
                 expect(rlsSql).toMatch(/cw\.decision_requires_decision_maker/);
                 expect(rlsSql).toMatch(/cw_can_decide_case\(v_uid\)/);
           });

           it("requires cw_can_assign_case for an assignment-only change", () => {
                 expect(rlsSql).toMatch(/cw\.assignment_requires_assign_capability/);
                 expect(rlsSql).toMatch(/cw_can_assign_case\(v_uid\)/);
           });

           it("the guard trigger is installed on cw_cases", () => {
                 expect(rlsSql).toMatch(/CREATE TRIGGER cw_cases_guard_mutation_trg\s*\n\s*BEFORE UPDATE ON public\.cw_cases/);
           });
});

describe("Phase 3 -- cw_open_case relaxed from the Phase 1 interim placeholder", () => {
    it("no longer restricts case creation to admin/service_role only", () => {
          const body = extractFunctionBody(rlsSql, "cw_open_case");
          expect(body).toMatch(/cw_can_assign_case|cw_is_compliance_decision_maker/);
    });

           it("still allows service_role (system callers are unaffected)", () => {
                 const body = extractFunctionBody(rlsSql, "cw_open_case");
                 expect(body).toMatch(/service_role/);
           });
});

describe("Phase 3 -- funder and support/engineering personas are not widened in this increment", () => {
    it("no cw_cases or cw_case_concerns policy in this increment references a funder capability", () => {
          expect(rlsSql).not.toMatch(/cw_is_funder_viewer\(/);
          expect(rlsSql).not.toMatch(/cw_is_funder_reviewer\(/);
    });

           it("no policy in this increment grants technical_support or developer_technical_admin anything", () => {
                 expect(rlsSql).not.toMatch(/cw_is_support_or_engineering\(/);
           });
});
