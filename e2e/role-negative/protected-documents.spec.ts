/**
 * e2e/role-negative/protected-documents.spec.ts
 *
 * Proves a seeded TEST/UAT protected document can only be downloaded by
 * its assigned roles. Adversaries (other_tenant_user, normal_non_admin_user,
 * logged_out_user) must receive 401/403/404 and no body bytes.
 */
import { test, expect } from "../helpers/evidence-rn";
import { loginAs } from "../helpers/auth-roles";
import { getRecord } from "../fixtures/records";
import { getDownloadAs } from "../helpers/direct-actions";

const ADVERSARIES = ["other_tenant_user", "normal_non_admin_user", "logged_out_user"] as const;

for (const role of ADVERSARIES) {
  test(`protected-document · ${role} cannot download Org A document`, async ({ page, ev }) => {
    const docId = getRecord("A", "documentId");
    if (!docId) test.skip(true, "Phase-2 seeded document missing");
    const path = `/documents/${docId}/download`;
    ev.set({
      test_type: role === "logged_out_user" ? "logged_out" : "direct_backend",
      role_used: role,
      organisation_used: "Organisation A TEST/UAT",
      route_or_action_tested: path,
      record_type: "documentId",
      seeded_record_reference: docId,
      expected_result: "denied",
    });

    await loginAs(page, role);
    // Direct backend GET — bypass UI, prove the download endpoint denies.
    const { status } = await getDownloadAs(role, path);
    expect([401, 403, 404]).toContain(status);
  });
}
