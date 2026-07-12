/**
 * Batch 6 — Notifications, counters, admin picker, scope safety.
 * Static/structural assertions on migration SQL + client code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const batch6Path = readdirSync(MIG_DIR)
  .filter((f) => f.startsWith("20260712092927"))
  .map((f) => join(MIG_DIR, f))[0];
const sql = readFileSync(batch6Path, "utf8");

describe("Batch 6 — notification helpers exist", () => {
  it("declares fw_notification_recipients_v1", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_notification_recipients_v1/);
  });
  it("declares fw_notify_event_v1", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_notify_event_v1/);
  });
  it("inserts into public.notifications", () => {
    expect(sql).toMatch(/INSERT INTO public\.notifications/);
  });
});

describe("Batch 6 — server-side trigger wiring for every required event", () => {
  const triggers = [
    ["fw_trg_org_notify", "p5_batch3_funder_organisations"],
    ["fw_trg_release_notify", "funder_deal_releases"],
    ["fw_trg_pack_notify", "funder_pack_versions"],
    ["fw_trg_rfi_notify", "funder_workspace_rfis"],
    ["fw_trg_rfi_message_notify", "funder_workspace_rfi_messages"],
    ["fw_trg_note_notify", "funder_workspace_notes"],
    ["fw_trg_decision_notify", "funder_workspace_decisions"],
  ] as const;
  for (const [trg, table] of triggers) {
    it(`creates ${trg} on ${table}`, () => {
      expect(sql).toContain(`CREATE TRIGGER ${trg}`);
      expect(sql).toContain(`ON public.${table}`);
    });
  }

  const events = [
    "funder_workspace.org_approved",
    "funder_workspace.org_rejected",
    "funder_workspace.deal_released",
    "funder_workspace.release_revoked",
    "funder_workspace.pack_generated",
    "funder_workspace.rfi_created",
    "funder_workspace.rfi_assigned",
    "funder_workspace.rfi_answered",
    "funder_workspace.shared_comment_created",
    "funder_workspace.decision_recorded",
  ];
  for (const ev of events) {
    it(`emits ${ev}`, () => {
      expect(sql).toContain(ev);
    });
  }
  it("emits rfi_closed and rfi_withdrawn (computed event type)", () => {
    expect(sql).toMatch(/'funder_workspace\.rfi_'\s*\|\|\s*NEW\.status/);
    expect(sql).toMatch(/status IN \('closed','withdrawn'\)/);
  });
});


describe("Batch 6 — recipient scoping is per funder organisation", () => {
  it("recipient helper filters by funder_organisation_id", () => {
    expect(sql).toMatch(/funder_organisation_id\s*=\s*p_funder_org/);
  });
  it("security-critical events ignore role filters (not user-suppressible)", () => {
    expect(sql).toMatch(/p_security_critical/);
    expect(sql).toMatch(/CASE WHEN p_security_critical THEN NULL/);
  });
  it("org_approved/rejected and release_revoked are marked security-critical", () => {
    // Extract calls; each of these three should end with `true, true` or `true, true);`
    const critical = [
      "funder_workspace.org_approved",
      "funder_workspace.org_rejected",
      "funder_workspace.release_revoked",
    ];
    for (const ev of critical) {
      const idx = sql.indexOf(ev);
      const chunk = sql.slice(idx, idx + 900);
      expect(chunk).toMatch(/true,\s*true/);
    }
  });
});

describe("Batch 6 — counter RPCs", () => {
  it("admin counter RPC exists and is platform_admin gated", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_counters_admin_v1/);
    expect(sql).toMatch(/has_role\(auth\.uid\(\),\s*'platform_admin'\)/);
  });
  it("funder counter RPC exists and scopes to current funder org", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_counters_funder_v1/);
    expect(sql).toMatch(/p5b3_current_funder_org\(\)/);
  });
  const adminKeys = [
    "pending_onboarding",
    "approved_orgs",
    "active_releases",
    "expiring_soon",
    "revoked_releases",
    "packs_generated",
    "pack_downloads",
    "open_rfis",
    "decisions_recorded",
  ];
  for (const k of adminKeys) {
    it(`admin counters expose ${k}`, () => expect(sql).toContain(`'${k}'`));
  }
});

describe("Batch 6 — admin assignment picker", () => {
  it("assignable-users RPC lists only platform_admin users", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_assignable_users_v1/);
    expect(sql).toMatch(/WHERE ur\.role = 'platform_admin'/);
  });
  it("assignable-users RPC is platform_admin gated", () => {
    const idx = sql.indexOf("fw_admin_assignable_users_v1");
    const chunk = sql.slice(idx, idx + 600);
    expect(chunk).toMatch(/platform_admin_required/);
  });
});

describe("Batch 6 — client wiring", () => {
  it("admin-client exposes fetchAdminCounters + listAssignableAdminUsers", () => {
    const src = readFileSync("src/lib/funder-workspace/admin-client.ts", "utf8");
    expect(src).toMatch(/fetchAdminCounters/);
    expect(src).toMatch(/listAssignableAdminUsers/);
    expect(src).toMatch(/fw_counters_admin_v1/);
    expect(src).toMatch(/fw_admin_assignable_users_v1/);
  });
  it("funder-client exposes fetchFunderCounters", () => {
    const src = readFileSync("src/lib/funder-workspace/funder-client.ts", "utf8");
    expect(src).toMatch(/fetchFunderCounters/);
    expect(src).toMatch(/fw_counters_funder_v1/);
  });
  it("admin Index page consumes new counter RPC", () => {
    const src = readFileSync("src/pages/admin/funder-workspace/Index.tsx", "utf8");
    expect(src).toMatch(/fetchAdminCounters/);
  });
  it("funder Index page consumes new counter RPC", () => {
    const src = readFileSync("src/pages/funder/workspace/Index.tsx", "utf8");
    expect(src).toMatch(/fetchFunderCounters/);
  });
  it("admin workflow panel wires safe assignment picker", () => {
    const src = readFileSync(
      "src/pages/admin/funder-workspace/components/AdminWorkflowPanels.tsx",
      "utf8",
    );
    expect(src).toMatch(/fw-admin-rfi-assignee-picker/);
    expect(src).toMatch(/listAssignableAdminUsers/);
  });
});

describe("Batch 6 — scope safety (nothing out-of-scope was introduced)", () => {
  it("no billing/payment/pricing UI added to funder workspace", () => {
    for (const p of [
      "src/pages/admin/funder-workspace",
      "src/pages/funder/workspace",
      "src/lib/funder-workspace",
    ]) {
      const files = walk(p);
      for (const f of files) {
        const s = readFileSync(f, "utf8").toLowerCase();
        expect(s).not.toMatch(/\bstripe\b|\bpaddle\b|\bpaystack\b|price.*plan|checkout.*session/);
      }
    }
  });
  it("no external share-link generation added", () => {
    for (const f of walk("src/pages/admin/funder-workspace").concat(walk("src/pages/funder/workspace"))) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/shareable[_-]?link|external[_-]?share|public[_-]?share/i);
    }
  });
  it("no marketplace/discovery UI added", () => {
    for (const f of walk("src/pages/funder/workspace")) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/marketplace|discovery|browse[_-]?deals/i);
    }
  });
  it("no white-labelling/logo upload added", () => {
    for (const f of walk("src/pages/admin/funder-workspace").concat(walk("src/pages/funder/workspace"))) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/whitelabel|white[_-]?label|logo[_-]?upload|brand[_-]?theme/i);
    }
  });
  it("Batch 6 migration does not rename enum values or drop legacy RPCs", () => {
    expect(sql).not.toMatch(/ALTER TYPE .* RENAME VALUE/i);
    for (const legacy of [
      "p5b3_funder_record_download_v1",
      "fw_admin_release_deal_v1",
      "fw_admin_revoke_deal_release_v1",
      "fw_funder_record_decision_v1",
    ]) {
      expect(sql).not.toMatch(new RegExp(`DROP\\s+FUNCTION[^;]*${legacy}`, "i"));
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e);
      const st = require("node:fs").statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
  }
  return out;
}
