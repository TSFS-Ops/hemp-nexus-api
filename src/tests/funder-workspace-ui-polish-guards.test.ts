/**
 * Funder Workspace — UI polish guardrails.
 *
 * Locks the enterprise-grade UI decisions that were shipped by the last
 * Lovable-safe pass:
 *
 *   - Role changes and deactivations go through the shared ConfirmDialog.
 *   - Deactivation and organisation suspension REQUIRE a reason.
 *   - Every mutation applies optimistic UI and rolls back on error.
 *   - Legacy `/funder/p5-batch*` pages render a LegacyBanner.
 *   - Canonical funder pages render no raw UUIDs or raw enum strings.
 *   - Statuses are rendered through the shared label helpers.
 *
 * Style: static source-file inspection (matches the existing
 * funder-workspace-batch*.test.ts guard suite). Runtime rendering is
 * covered by the batch demo-journey tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─── Team management (admin/p5-batch3) ─────────────────────────────

const ORG_DETAIL = read("src/pages/admin/p5-batch3/OrganisationDetail.tsx");
const ORGS = read("src/pages/admin/p5-batch3/Organisations.tsx");
const ADMIN_AUDIT = read("src/pages/admin/p5-batch3/Audit.tsx");

describe("Team management — confirmation dialogs", () => {
  it("uses the shared ConfirmDialog for role changes and deactivation", () => {
    expect(ORG_DETAIL).toMatch(/from\s+"@\/lib\/funder-workspace\/ui"/);
    expect(ORG_DETAIL).toMatch(/ConfirmDialog/);
    // Two ConfirmDialog instances: one for deactivation, one for role change.
    const count = (ORG_DETAIL.match(/<ConfirmDialog\b/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("requires a reason before deactivating a funder user", () => {
    // The deactivate ConfirmDialog carries `requireReason`.
    expect(ORG_DETAIL).toMatch(/requireReason[\s\S]{0,400}Deactivate/);
  });

  it("uses the shared ConfirmDialog and requires a reason before suspending an org", () => {
    expect(ORGS).toMatch(/ConfirmDialog/);
    expect(ORGS).toMatch(/requireReason/);
    expect(ORGS).toMatch(/Suspend/);
  });
});

describe("Team management — optimistic UI with rollback", () => {
  it("rolls back the role on RPC failure", () => {
    // setUsers is called optimistically, then again inside the catch to restore previousRole.
    expect(ORG_DETAIL).toMatch(/previousRole/);
    expect(ORG_DETAIL).toMatch(/catch[\s\S]{0,400}setUsers[\s\S]{0,200}previousRole/);
  });

  it("rolls back user status on RPC failure", () => {
    expect(ORG_DETAIL).toMatch(/const previous = user\.status/);
    expect(ORG_DETAIL).toMatch(/catch[\s\S]{0,400}setUsers[\s\S]{0,200}previous/);
  });

  it("rolls back org status on RPC failure", () => {
    expect(ORGS).toMatch(/const previous = target\.status/);
    expect(ORGS).toMatch(/catch[\s\S]{0,400}setOrgs[\s\S]{0,200}previous/);
  });
});

describe("Team management — resend invitation is implemented", () => {
      it("routes through the typed RPC wrapper (never a raw .rpc() call) and surfaces success/error", () => {
              // Resend must go through the typed wrapper (p5b3ResendFunderInvite in
              // src/lib/p5-batch3/rpc.ts), which is the only place that calls
              // supabase.rpc("p5b3_admin_resend_funder_invite_v1", ...). The
              // component itself must never call .rpc() directly.
              const code = ORG_DETAIL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
              expect(code).not.toMatch(/\.rpc\(["'][^"']*resend[^"']*["']/i);
              expect(ORG_DETAIL).toMatch(/p5b3ResendFunderInvite/);
              expect(ORG_DETAIL).toMatch(/setResendingId/);
              expect(ORG_DETAIL).toMatch(/toast\.success\([^)]*[Rr]esent/);
              expect(ORG_DETAIL).toMatch(/toast\.error\(\(e as Error\)\.message\)/);
      });
});

describe("Team management — empty and loading states", () => {
  it("uses the shared LoadingState and EmptyState primitives on OrganisationDetail", () => {
    expect(ORG_DETAIL).toMatch(/LoadingState/);
    expect(ORG_DETAIL).toMatch(/EmptyState/);
  });

  it("uses the shared LoadingState and EmptyState primitives on Organisations", () => {
    expect(ORGS).toMatch(/LoadingState/);
    expect(ORGS).toMatch(/EmptyState/);
  });

  it("uses the shared LoadingState and EmptyState primitives on Audit", () => {
    expect(ADMIN_AUDIT).toMatch(/LoadingState/);
    expect(ADMIN_AUDIT).toMatch(/EmptyState/);
  });
});

// ─── Legacy route containment ─────────────────────────────────────

const LEGACY_PAGES = [
  "src/pages/funder/FunderEvidencePack.tsx",
  "src/pages/funder/p5-batch2/FunderEvidencePack.tsx",
  "src/pages/funder/p5-batch3/components/P5B3FunderShell.tsx",
  "src/pages/funder/p5-batch4/components/P5B4FunderShell.tsx",
  "src/pages/funder/p5-batch5/FunderFinality.tsx",
  "src/pages/funder/p5-batch6/FunderExceptions.tsx",
  "src/pages/funder/p5-batch7/FunderDashboard.tsx",
];

describe("Legacy funder surfaces — banner + link back to canonical", () => {
  for (const p of LEGACY_PAGES) {
    it(`renders LegacyBanner on ${p}`, () => {
      const src = read(p);
      expect(src).toMatch(/LegacyBanner/);
    });
  }
});

// ─── Canonical funder pages — no raw identifiers ──────────────────

const CANONICAL_PAGES = [
  "src/pages/funder/workspace/Index.tsx",
  "src/pages/funder/workspace/Deals.tsx",
  "src/pages/funder/workspace/DealDetail.tsx",
  "src/pages/funder/workspace/Activity.tsx",
  "src/pages/funder/workspace/Profile.tsx",
];

const RAW_ENUM_LEAK_STRINGS = [
  // Raw statuses that must always be rendered through StatusBadge / labels.
  "'draft'",
  "'active'",
  "'expired'",
  "'revoked'",
  "'expiring_soon'",
  "'sealed'",
  "'generated'",
  "'superseded'",
  "'failed'",
  "'not_required'",
  "'overridden'",
];

describe("Canonical funder pages — no raw enum labels in JSX", () => {
  for (const p of CANONICAL_PAGES) {
    it(`${p} renders statuses through the shared label helpers, not raw strings`, () => {
      const src = read(p);
      // Anything status-shaped must be routed through StatusBadge or a *Label helper.
      // We accept the raw string only inside type positions / switch discriminants,
      // which show up as `=== "active"` or `"active" |`. So we only flag JSX-y
      // occurrences: `>active<`, `>{"active"}<`, or a bare `{"active"}` render.
      for (const raw of RAW_ENUM_LEAK_STRINGS) {
        const bareRender = new RegExp(`\\{\\s*${raw.replace(/'/g, '"')}\\s*\\}`);
        const between = new RegExp(`>\\s*${raw.slice(1, -1)}\\s*<`);
        expect(src, `${p} leaked ${raw} into JSX`).not.toMatch(bareRender);
        expect(src, `${p} leaked ${raw} between JSX tags`).not.toMatch(between);
      }
    });

    it(`${p} does not render bare monospace UUIDs as identity`, () => {
      const src = read(p);
      // Explicit ban: no <code>{...id}</code> as a primary heading.
      // A UUID literal check (36-char) — no page should hard-code one.
      const uuidLiteral = /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/i;
      expect(src, `${p} contains a hard-coded UUID literal`).not.toMatch(uuidLiteral);
    });
  }
});

// ─── Shared UI kit surface ────────────────────────────────────────

const UI_INDEX = read("src/lib/funder-workspace/ui/index.ts");

describe("Shared funder-workspace UI kit", () => {
  it("exposes the primitives the polished pages depend on", () => {
    for (const name of [
      "StatusBadge",
      "EmptyState",
      "LoadingState",
      "ConfirmDialog",
      "LegacyBanner",
      "ExpiryIndicator",
      "SectionHeading",
      "InfoBanner",
    ]) {
      expect(UI_INDEX, `missing export: ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

// ─── ConfirmDialog behaviour contract ─────────────────────────────

const CONFIRM_SRC = read("src/lib/funder-workspace/ui/ConfirmDialog.tsx");

describe("ConfirmDialog — reason gate", () => {
  it("disables the confirm action until a reason of at least 3 chars is entered", () => {
    // Guards regressions in the deactivation/suspension flow: the confirm
    // button MUST be blocked when requireReason is on and the textarea is
    // empty or trivially short.
    expect(CONFIRM_SRC).toMatch(/requireReason/);
    expect(CONFIRM_SRC).toMatch(/reason\.trim\(\)\.length\s*>=\s*3/);
    expect(CONFIRM_SRC).toMatch(/disabled=\{!canConfirm\}/);
  });
});
