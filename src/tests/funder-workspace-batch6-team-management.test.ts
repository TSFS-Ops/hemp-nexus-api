/**
* Institutional Funder Evidence Workspace -- Batch 6 (Team Management)
* Static tests: the V1 admin console must surface the funder team for an
* organisation (read-only) and link to the existing P-5 Batch 3 admin
* console for invite / role-change / deactivate actions, reusing the
* existing RPCs rather than duplicating them.
*/
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Batch 6 -- team management reuses existing P-5 Batch 3 infrastructure", () => {
const adminClient = readFileSync("src/lib/funder-workspace/admin-client.ts", "utf8");
const orgDetail = readFileSync("src/pages/admin/funder-workspace/OrganisationDetail.tsx", "utf8");

it("admin-client exposes a read-only funder-user listing for an organisation", () => {
expect(adminClient).toMatch(/export async function listFunderUsersForOrg/);
expect(adminClient).toMatch(/from\("p5_batch3_funder_users"\)/);
expect(adminClient).toMatch(/eq\("funder_organisation_id", organisationId\)/);
});

it("does not define any new invite/role/status mutation RPC wrapper (reuse, not duplication)", () => {
expect(adminClient).not.toMatch(/invite_funder_user/);
expect(adminClient).not.toMatch(/assign_funder_role/);
expect(adminClient).not.toMatch(/set_funder_user_status/);
});

it("OrganisationDetail fetches and renders the funder team for the org", () => {
expect(orgDetail).toMatch(/listFunderUsersForOrg/);
expect(orgDetail).toMatch(/funderUsers\.map/);
expect(orgDetail).toMatch(/funderRoleLabel\(u\.role\)/);
});

it("OrganisationDetail links to the existing P-5 Batch 3 admin console for actions", () => {
expect(orgDetail).toMatch(/\/admin\/p5-batch3\/organisations\/\$\{organisationId\}/);
expect(orgDetail).toMatch(/Manage team/);
});

it("no longer claims team management is out of scope", () => {
expect(orgDetail).not.toMatch(/Team management is intentionally out of scope/);
expect(orgDetail).not.toMatch(/self-service management is not available/);
});
});
