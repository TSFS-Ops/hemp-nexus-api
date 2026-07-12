/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Static guard: routes are registered, platform-admin guarded, and the
 * admin client only calls approved Batch 1 RPC names.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
const ADMIN_CLIENT = readFileSync(
  join(ROOT, "src/lib/funder-workspace/admin-client.ts"),
  "utf8",
);

const ROUTES: Array<[string, string]> = [
  ["/admin/funder-workspace", "FunderWorkspaceAdminIndex"],
  ["/admin/funder-workspace/onboarding", "FunderWorkspaceOnboarding"],
  ["/admin/funder-workspace/organisations", "FunderWorkspaceOrganisations"],
  ["/admin/funder-workspace/organisations/:organisationId", "FunderWorkspaceOrganisationDetail"],
  ["/admin/funder-workspace/releases", "FunderWorkspaceReleases"],
  ["/admin/funder-workspace/releases/new", "FunderWorkspaceNewRelease"],
  ["/admin/funder-workspace/releases/:releaseId", "FunderWorkspaceReleaseDetail"],
  ["/admin/funder-workspace/audit", "FunderWorkspaceAudit"],
];

const PAGE_FILES = [
  "src/pages/admin/funder-workspace/Index.tsx",
  "src/pages/admin/funder-workspace/OnboardingRequests.tsx",
  "src/pages/admin/funder-workspace/Organisations.tsx",
  "src/pages/admin/funder-workspace/OrganisationDetail.tsx",
  "src/pages/admin/funder-workspace/Releases.tsx",
  "src/pages/admin/funder-workspace/NewRelease.tsx",
  "src/pages/admin/funder-workspace/ReleaseDetail.tsx",
  "src/pages/admin/funder-workspace/Audit.tsx",
];

const APPROVED_RPCS = new Set([
  "fw_admin_approve_funder_org_v1",
  "fw_admin_reject_funder_org_v1",
  "fw_admin_release_deal_v1",
  "fw_admin_revoke_deal_release_v1",
  // Batch 6 additive read-only RPCs (counters + safe admin picker):
  "fw_counters_admin_v1",
  "fw_admin_assignable_users_v1",
]);


const FORBIDDEN_RPC_PATTERNS = [
  /p5b3_funder_record_download_v1/,
  /fw_request_funder_onboarding_v1/, // funder-side, not admin
  // Any Batch-3/4 admin RPCs must remain untouched:
  /p5b3_admin_create_access_grant_v1/,
  /p5b3_admin_revoke_access_grant_v1/,
];

describe("Funder Workspace Batch 2 — admin routes", () => {
  it("registers every admin route path", () => {
    for (const [path] of ROUTES) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`<Route\\s+path="${escaped}"`);
      expect(APP, `route ${path}`).toMatch(re);
    }
  });


  it("guards every admin route with RequireAuth role=platform_admin", () => {
    for (const [path, component] of ROUTES) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `path="${escaped}"\\s+element=\\{<RequireAuth\\s+role="platform_admin"[^>]*>\\s*<${component}`,
      );
      expect(APP, `route ${path} must be platform-admin guarded`).toMatch(re);
    }
  });

  it("lazy-loads every admin page component", () => {
    for (const [, component] of ROUTES) {
      const re = new RegExp(
        `const ${component} = lazy\\(\\(\\) => import\\("@/pages/admin/funder-workspace/`,
      );
      expect(APP).toMatch(re);
    }
  });

  it("every admin page file exists", () => {
    for (const f of PAGE_FILES) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
  });
});

describe("Funder Workspace Batch 2 — RPC allow-list", () => {
  it("admin client only calls the four approved Batch 1 admin RPCs", () => {
    const rpcCalls = [...ADMIN_CLIENT.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]);
    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const name of rpcCalls) {
      expect(APPROVED_RPCS.has(name), `unexpected RPC ${name}`).toBe(true);
    }
  });

  it("admin client does NOT call any funder-side or forbidden RPC", () => {
    for (const pat of FORBIDDEN_RPC_PATTERNS) {
      expect(ADMIN_CLIENT).not.toMatch(pat);
    }
  });

  it("all four approved RPCs are actually referenced somewhere", () => {
    for (const name of APPROVED_RPCS) {
      expect(ADMIN_CLIENT.includes(name), name).toBe(true);
    }
  });
});

describe("Funder Workspace Batch 2 — scope guarantees", () => {
  it("no page under /admin/funder-workspace/* touches PDF/download pipelines", () => {
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body, `${f} must not import PDFKit/pdf-lib`).not.toMatch(
        /from\s+["'](?:pdfkit|pdf-lib|jspdf)["']/,
      );
      // No signed URL / storage download code in Batch 2:
      expect(body).not.toMatch(/createSignedUrl\(/);
      expect(body).not.toMatch(/download\(/);
    }
  });

  it("no Batch 2 file introduces notifications/billing/payment surfaces", () => {
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body).not.toMatch(/notification-dispatch/i);
      expect(body).not.toMatch(/paystack|stripe|payfast|paddle/i);
      expect(body).not.toMatch(/invoice/i);
    }
  });

  it("does not modify existing p5-batch3 admin pages", () => {
    // Sanity: the Batch 3 admin index file body must still exist and
    // reference /admin/p5-batch3 destinations, not /admin/funder-workspace.
    const p5b3Index = readFileSync(
      join(ROOT, "src/pages/admin/p5-batch3/Index.tsx"),
      "utf8",
    );
    expect(p5b3Index).toMatch(/\/admin\/p5-batch3\//);
    expect(p5b3Index).not.toMatch(/\/admin\/funder-workspace/);
  });
});
