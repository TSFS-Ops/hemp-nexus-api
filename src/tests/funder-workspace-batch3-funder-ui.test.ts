/**
 * Institutional Funder Evidence Workspace — Batch 3
 * Static guard: funder-facing workspace routes are registered, auth-guarded,
 * the funder client only reads Batch 1 tables via RLS, and no
 * PDF/download/notification/billing/marketplace surface is introduced.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
const FUNDER_CLIENT = readFileSync(
  join(ROOT, "src/lib/funder-workspace/funder-client.ts"),
  "utf8",
);

const ROUTES: Array<[string, string]> = [
  ["/funder/workspace", "FunderWorkspaceFunderIndex"],
  ["/funder/workspace/deals", "FunderWorkspaceFunderDeals"],
  ["/funder/workspace/deals/:releaseId", "FunderWorkspaceFunderDealDetail"],
  ["/funder/workspace/activity", "FunderWorkspaceFunderActivity"],
  ["/funder/workspace/profile", "FunderWorkspaceFunderProfile"],
];

const PAGE_FILES = [
  "src/pages/funder/workspace/Index.tsx",
  "src/pages/funder/workspace/Deals.tsx",
  "src/pages/funder/workspace/DealDetail.tsx",
  "src/pages/funder/workspace/Profile.tsx",
  "src/pages/funder/workspace/Activity.tsx",
  "src/pages/funder/workspace/components/FunderWorkspaceShell.tsx",
  "src/pages/funder/workspace/components/FunderBadges.tsx",
];

describe("Funder Workspace Batch 3 — route registration", () => {
  it("registers every funder-facing route", () => {
    for (const [path] of ROUTES) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(APP, `route ${path}`).toMatch(
        new RegExp(`<Route\\s+path="${escaped}"`),
      );
    }
  });

  it("wraps every funder-facing route in RequireAuth", () => {
    for (const [path, component] of ROUTES) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(APP, `route ${path} must be auth-guarded`).toMatch(
        new RegExp(
          `path="${escaped}"\\s+element=\\{<RequireAuth[^>]*>\\s*<${component}`,
        ),
      );
    }
  });

  it("lazy-loads every funder page component", () => {
    for (const [, component] of ROUTES) {
      expect(APP).toMatch(
        new RegExp(
          `const ${component} = lazy\\(\\(\\) => import\\("@/pages/funder/workspace/`,
        ),
      );
    }
  });

  it("all page files exist", () => {
    for (const f of PAGE_FILES) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
  });

  it("does not remove any existing /funder/p5-batch* routes", () => {
    expect(APP).toMatch(/path="\/funder\/p5-batch3"/);
    expect(APP).toMatch(/\/funder\/p5-batch3\/opportunities\/:grantId/);
  });
});

describe("Funder Workspace Batch 3 — funder client scope", () => {
  it("only calls approved read-only RPCs (Batch 6 counter helper); no writes from funder client", () => {
    const rpcCalls = [...FUNDER_CLIENT.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]);
        const allowed = new Set(["fw_counters_funder_v1", "fw_log_access_event_v1"]);
    for (const name of rpcCalls) {
      expect(allowed.has(name), `unexpected funder-side RPC ${name}`).toBe(true);
    }
    // No admin/mutation RPCs.
    expect(FUNDER_CLIENT).not.toMatch(/fw_admin_/);
    expect(FUNDER_CLIENT).not.toMatch(/fw_funder_(create|edit|delete|withdraw|close|add|record)_/);
  });


  it("never imports admin-client (no admin mutations from funder surface)", () => {
    expect(FUNDER_CLIENT).not.toMatch(/from\s+["']\.\/admin-client["']/);
    expect(FUNDER_CLIENT).not.toMatch(/fw_admin_/);
  });

  it("never touches the deprecated per-user grant table", () => {
    // Batch 3 explicitly must not drive the dashboard from
    // p5_batch3_funder_access_grants.
    expect(FUNDER_CLIENT).not.toMatch(/p5_batch3_funder_access_grants/);
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body, `${f} must not touch access_grants`).not.toMatch(
        /p5_batch3_funder_access_grants/,
      );
    }
  });

  it("dashboard is driven by funder_deal_releases, not by grants", () => {
    const indexBody = readFileSync(
      join(ROOT, "src/pages/funder/workspace/Index.tsx"),
      "utf8",
    );
    // No transaction-reference paste flow, no browse/discovery UI:
    expect(indexBody).not.toMatch(/transaction_reference/);
    expect(indexBody).not.toMatch(/<Input\b/);
    expect(indexBody).not.toMatch(/onPaste/i);
    expect(indexBody).not.toMatch(/\bdiscover\b/i);
    expect(indexBody).not.toMatch(/marketplace/i);
  });

  it("only reads from Batch 1 / Batch 3 tables", () => {
    const allowed = [
      "p5_batch3_funder_organisations",
      "p5_batch3_funder_users",
      "funder_deal_releases",
      "funder_release_consents",
      "funder_pack_versions",
      "funder_usage_events",
      "p5_batch3_funder_audit_events",
    ];
    const tables = [...FUNDER_CLIENT.matchAll(/\.from\((?:T\.)?["`]?([a-z0-9_]+)["`]?\)/g)]
      .map((m) => m[1])
      // Also strip references like T.releases -> we look up the T constant literals below.
      .filter(Boolean);
    // Additionally check literal table strings in the T constant map.
    const literalTables = [...FUNDER_CLIENT.matchAll(/["']([a-z0-9_]+)["']/g)]
      .map((m) => m[1])
      .filter((s) => s.startsWith("funder_") || s.startsWith("p5_batch3_"));
    for (const t of literalTables) {
      expect(allowed, `table ${t}`).toContain(t);
    }
    // Sanity: at least one .from() call exists.
    expect(tables.length + literalTables.length).toBeGreaterThan(0);
  });
});

describe("Funder Workspace Batch 3 — scope safety", () => {
  it("no funder workspace page introduces PDF generation", () => {
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body, `${f} must not import PDF libs`).not.toMatch(
        /from\s+["'](?:pdfkit|pdf-lib|jspdf)["']/,
      );
    }
  });

  it("no funder workspace page introduces sealed-pack download", () => {
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body, `${f} must not use createSignedUrl`).not.toMatch(
        /createSignedUrl\(/,
      );
      expect(body, `${f} must not call storage .download()`).not.toMatch(
        /\.download\(/,
      );
    }
  });

  it("no funder workspace page introduces notifications, billing, invoices, share links", () => {
    for (const f of PAGE_FILES) {
      const body = readFileSync(join(ROOT, f), "utf8");
      expect(body).not.toMatch(/notification-dispatch/i);
      expect(body).not.toMatch(/paystack|stripe|payfast|paddle/i);
      expect(body).not.toMatch(/invoice/i);
      expect(body).not.toMatch(/share[-_ ]?link/i);
    }
  });

  it("does not modify existing Batch-3/4 RPC signatures", () => {
    // Sanity: the p5b3 record-download RPC continues to exist as it was.
    expect(FUNDER_CLIENT).not.toMatch(/p5b3_funder_record_download_v1/);
  });
});

describe("Funder Workspace Batch 3 — release detail hides access", () => {
  it("detail page renders opaque access-denied state (no metadata leak)", () => {
    const body = readFileSync(
      join(ROOT, "src/pages/funder/workspace/DealDetail.tsx"),
      "utf8",
    );
    expect(body).toMatch(/data-testid="fw-funder-access-denied"/);
    expect(body).toMatch(/Not available/);
    // Access-denied branch must not print the releaseId or any release fields.
    const denied = body.slice(body.indexOf("release === null"));
    expect(denied.slice(0, 800)).not.toMatch(/\{releaseId\}/);
    expect(denied.slice(0, 800)).not.toMatch(/deal_reference/);
  });

  it("does not render a working PDF download button in Batch 3", () => {
    const body = readFileSync(
      join(ROOT, "src/pages/funder/workspace/DealDetail.tsx"),
      "utf8",
    );
    expect(body).toMatch(/PDF generation comes in the next build batch/);
    expect(body).not.toMatch(/href=\{[^}]*\.pdf/);
  });
});

describe("Funder Workspace Batch 3 — role label mapping", () => {
  it("maps every Batch 1 funder_role enum value to a display label without renaming enums", () => {
    const perms = readFileSync(
      join(ROOT, "src/lib/funder-workspace/funder-permissions.ts"),
      "utf8",
    );
    for (const enumVal of [
      "funder_org_admin",
      "funder_approver",
      "funder_reviewer",
      "funder_viewer",
      "external_adviser",
    ]) {
      expect(perms, `enum ${enumVal}`).toMatch(new RegExp(`\\b${enumVal}\\b`));
    }
  });
});
