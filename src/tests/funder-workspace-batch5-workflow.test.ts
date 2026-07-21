/**
 * Institutional Funder Evidence Workspace — Batch 5
 * RFI, notes/comments, and formal decision workflow.
 *
 * Static guards + light DB introspection covering:
 * - migration installs the four V1 tables and locks down grants,
 * - every V1 RPC exists, is SECURITY DEFINER, sets search_path=public,
 *   and does NOT expose EXECUTE to anon,
 * - the workflow client library only calls approved Batch 5 RPCs
 *   and only reads approved Batch 5 tables,
 * - funder + admin UI wire the panels and enforce role-driven display,
 * - scope safety: no notifications, billing, payments, share links,
 *   white-labelling, or marketplace/discovery surfaces,
 * - Batch 1–4 signatures untouched, EXCEPT fw_admin_seal_pack_v1 which
 *   was legitimately extended (Batch 12 / Phase 2, audited sealed-pack
 *   supersession) with two additional optional parameters
 *   (p_supersede, p_supersede_reason). The original 6-argument call
 *   shape keeps working unchanged; only a genuine supersede request
 *   needs the new arguments. This is an intentional, spec-required
 *   signature evolution, not a regression, so it is excluded from the
 *   "must not redefine" guard below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = "supabase/migrations";

function allMigrations(): string {
    return readdirSync(MIG_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIG_DIR, f), "utf8"))
      .join("\n");
}

const CLIENT = readFileSync(
    join(ROOT, "src/lib/funder-workspace/workflow-client.ts"),
    "utf8",
  );
const FUNDER_PANEL = readFileSync(
    join(ROOT, "src/pages/funder/workspace/components/FunderWorkflowPanels.tsx"),
    "utf8",
  );
const ADMIN_PANEL = readFileSync(
    join(
          ROOT,
          "src/pages/admin/funder-workspace/components/AdminWorkflowPanels.tsx",
        ),
    "utf8",
  );
const FUNDER_DETAIL = readFileSync(
    join(ROOT, "src/pages/funder/workspace/DealDetail.tsx"),
    "utf8",
  );
const ADMIN_DETAIL = readFileSync(
    join(ROOT, "src/pages/admin/funder-workspace/ReleaseDetail.tsx"),
    "utf8",
  );

const V1_TABLES = [
    "funder_workspace_rfis",
    "funder_workspace_rfi_messages",
    "funder_workspace_notes",
    "funder_workspace_decisions",
  ] as const;

const V1_RPCS = [
    "fw_funder_create_rfi_v1",
    "fw_funder_add_rfi_message_v1",
    "fw_funder_close_rfi_v1",
    "fw_funder_withdraw_rfi_v1",
    "fw_admin_assign_rfi_v1",
    "fw_admin_answer_rfi_v1",
    "fw_funder_create_note_v1",
    "fw_funder_edit_note_v1",
    "fw_funder_delete_note_v1",
    "fw_funder_record_decision_v1",
  ] as const;

describe("Batch 5 — migration installs the V1 tables", () => {
    const sql = allMigrations();

           it.each(V1_TABLES)("creates public.%s with RLS enabled", (t) => {
                 expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
                 expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
           });

           it("grants each V1 table SELECT to authenticated and ALL to service_role only", () => {
                 for (const t of V1_TABLES) {
                         expect(sql).toMatch(
                                   new RegExp(`GRANT SELECT ON public\\.${t} TO authenticated`),
                                 );
                         expect(sql).toMatch(
                                   new RegExp(`GRANT ALL\\s+ON public\\.${t} TO service_role`),
                                 );
                         // Never grants INSERT/UPDATE/DELETE to authenticated directly on V1 tables.
                   expect(sql).not.toMatch(
                             new RegExp(
                                         `GRANT[^;]*\\b(INSERT|UPDATE|DELETE)\\b[^;]*ON public\\.${t}[^;]*TO authenticated`,
                                       ),
                           );
                 }
           });

           it("decisions has final-status-requires-reason CHECK and unique current partial index", () => {
                 expect(sql).toMatch(/funder_workspace_decisions_final_needs_reason/);
                 expect(sql).toMatch(/uniq_fw_decision_current/);
                 expect(sql).toMatch(/WHERE is_current/);
           });

           it("notes has type↔visibility consistency CHECK", () => {
                 expect(sql).toMatch(/funder_workspace_notes_type_visibility/);
           });
});

describe("Batch 5 — RPC hardening", () => {
    const sql = allMigrations();

           it.each(V1_RPCS)("declares %s as SECURITY DEFINER with search_path=public", (fn) => {
                 // Function block starts with CREATE OR REPLACE FUNCTION public.<fn>(...)
                                const idx = sql.indexOf(`FUNCTION public.${fn}(`);
                 expect(idx, `${fn} definition present`).toBeGreaterThan(-1);
                 const block = sql.slice(idx, idx + 4000);
                 expect(block).toMatch(/SECURITY DEFINER/);
                 expect(block).toMatch(/SET search_path = public/);
           });

           it.each(V1_RPCS)("locks down EXECUTE grants on %s", (fn) => {
                 expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
                 expect(sql).toMatch(
                         new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`),
                       );
                 // Must not GRANT EXECUTE to anon anywhere for these RPCs.
                                const grantsToAnon = new RegExp(
                                        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO [^;]*\\banon\\b`,
                                      );
                 expect(sql).not.toMatch(grantsToAnon);
           });

           it("record_decision requires reason for final statuses", () => {
                 const idx = sql.indexOf("FUNCTION public.fw_funder_record_decision_v1(");
                 const block = sql.slice(idx, idx + 4000);
                 expect(block).toMatch(/reason_required_for_final_decision/);
                 expect(block).toMatch(/only_approver_can_record_decision/);
           });

           it("create_rfi and create_note gate on release_status = 'active' and not expired", () => {
                 for (const fn of ["fw_funder_create_rfi_v1", "fw_funder_create_note_v1"]) {
                         const idx = sql.indexOf(`FUNCTION public.${fn}(`);
                         const block = sql.slice(idx, idx + 3000);
                         expect(block, `${fn} release-status gate`).toMatch(/release_not_active/);
                         expect(block, `${fn} expiry gate`).toMatch(/release_expired/);
                 }
           });

           it("viewer role cannot create RFI or note", () => {
                 for (const fn of [
                         "fw_funder_create_rfi_v1",
                         "fw_funder_create_note_v1",
                         "fw_funder_close_rfi_v1",
                         "fw_funder_withdraw_rfi_v1",
                         "fw_funder_add_rfi_message_v1",
                       ]) {
                         const idx = sql.indexOf(`FUNCTION public.${fn}(`);
                         const block = sql.slice(idx, idx + 3000);
                         expect(block, `${fn}`).toMatch(/insufficient_role/);
                         expect(block, `${fn}`).toMatch(/NOT IN \('admin','approver','reviewer'\)/);
                 }
           });

           it("edit_note creates a superseding version outside the edit window", () => {
                 const idx = sql.indexOf("FUNCTION public.fw_funder_edit_note_v1(");
                 const block = sql.slice(idx, idx + 4000);
                 expect(block).toMatch(/superseding/);
                 expect(block).toMatch(/supersedes_note_id/);
           });

           it("delete_note is a soft delete", () => {
                 const idx = sql.indexOf("FUNCTION public.fw_funder_delete_note_v1(");
                 const block = sql.slice(idx, idx + 3000);
                 expect(block).toMatch(/deleted_at = now\(\)/);
           });
});

describe("Batch 5 — workflow client scope", () => {
    it("only invokes approved Batch 5 RPCs", () => {
          const approved = new Set<string>(V1_RPCS as readonly string[]);
          const rpcCalls = [...CLIENT.matchAll(/\.rpc\("([^"]+)"/g)].map((m) => m[1]);
          for (const name of rpcCalls) {
                  expect(approved, `RPC ${name} must be an approved Batch 5 RPC`).toContain(
                            name,
                          );
          }
          // Every approved RPC is actually wired.
           for (const rpc of V1_RPCS) {
                   expect(rpcCalls, `client wires ${rpc}`).toContain(rpc);
           }
    });

           it("only reads from Batch 5 workflow tables", () => {
                 const tables = [...CLIENT.matchAll(/["']([a-z0-9_]+)["']/g)]
                   .map((m) => m[1])
                   .filter((s) => s.startsWith("funder_workspace_"));
                 const allowed = new Set<string>(V1_TABLES as readonly string[]);
                 for (const t of tables) {
                         expect(allowed, `table ${t}`).toContain(t);
                 }
           });

           it("never touches legacy per-user access grants", () => {
                 expect(CLIENT).not.toMatch(/p5_batch3_funder_access_grants/);
                 expect(CLIENT).not.toMatch(/p5b3_admin_/);
           });

           it("client-side reason gate blocks final decisions with empty reason", async () => {
                 const mod = await import("@/lib/funder-workspace/workflow-client");
                 expect(mod.requiresDecisionReason("approved")).toBe(true);
                 expect(mod.requiresDecisionReason("declined")).toBe(true);
                 expect(mod.requiresDecisionReason("conditional")).toBe(true);
                 expect(mod.requiresDecisionReason("withdrawn")).toBe(true);
                 expect(mod.requiresDecisionReason("under_review")).toBe(false);
                 expect(mod.requiresDecisionReason("not_started")).toBe(false);
                 expect(mod.requiresDecisionReason("info_requested")).toBe(false);
           });

           it("role helpers enforce the documented V1 permission matrix", async () => {
                 const mod = await import("@/lib/funder-workspace/workflow-client");
                 // Approver-only for decisions
                  expect(mod.canRecordDecision("approver")).toBe(true);
                 expect(mod.canRecordDecision("admin")).toBe(false);
                 expect(mod.canRecordDecision("reviewer")).toBe(false);
                 expect(mod.canRecordDecision("viewer")).toBe(false);
                 // Admin/Approver/Reviewer for RFIs + notes; Viewer/external adviser blocked
                  for (const r of ["admin", "approver", "reviewer"] as const) {
                          expect(mod.canCreateRfi(r)).toBe(true);
                          expect(mod.canCreateNote(r)).toBe(true);
                  }
                 for (const r of ["viewer", "external_adviser", null] as const) {
                         expect(mod.canCreateRfi(r as any)).toBe(false);
                         expect(mod.canCreateNote(r as any)).toBe(false);
                 }
           });
});

describe("Batch 5 — funder UI wiring", () => {
    it("funder DealDetail renders all three workflow panels", () => {
          expect(FUNDER_DETAIL).toMatch(/<FunderRfiPanel/);
          expect(FUNDER_DETAIL).toMatch(/<FunderNotesPanel/);
          expect(FUNDER_DETAIL).toMatch(/<FunderDecisionPanel/);
    });

           it("panels are role-gated by client-side hint (server is authoritative)", () => {
                 expect(FUNDER_PANEL).toMatch(/canCreateRfi\(role\)/);
                 expect(FUNDER_PANEL).toMatch(/canCreateNote\(role\)/);
                 expect(FUNDER_PANEL).toMatch(/canRecordDecision\(role\)/);
           });

           it("decision form requires reason before submit for final statuses", () => {
                 expect(FUNDER_PANEL).toMatch(/requiresDecisionReason\(status\)/);
                 expect(FUNDER_PANEL).toMatch(/A written reason is required/);
           });

           it("no funder page introduces notifications, billing, share-links, or PDF pipelines", () => {
                 for (const body of [FUNDER_PANEL, FUNDER_DETAIL]) {
                         expect(body).not.toMatch(/notification-dispatch/i);
                         expect(body).not.toMatch(/paystack|stripe|payfast|paddle/i);
                         expect(body).not.toMatch(/\binvoice\b/i);
                         expect(body).not.toMatch(/share[-_ ]?link/i);
                         expect(body).not.toMatch(/marketplace|discovery/i);
                         expect(body).not.toMatch(/white[-_ ]?label|funder\s+logo/i);
                 }
                 expect(FUNDER_PANEL).not.toMatch(/from\s+["'](?:pdfkit|pdf-lib|jspdf)["']/);
           });
});

describe("Batch 5 — admin UI wiring", () => {
    it("admin ReleaseDetail renders the admin workflow panels", () => {
          expect(ADMIN_DETAIL).toMatch(/<AdminRfiPanel/);
          expect(ADMIN_DETAIL).toMatch(/<AdminSharedCommentsPanel/);
          expect(ADMIN_DETAIL).toMatch(/<AdminDecisionHistoryPanel/);
    });

           it("admin panel exposes assign + answer controls but no decision recording", () => {
                 expect(ADMIN_PANEL).toMatch(/assignRfi\(/);
                 expect(ADMIN_PANEL).toMatch(/answerRfi\(/);
                 expect(ADMIN_PANEL).not.toMatch(/recordDecision\(/);
                 expect(ADMIN_PANEL).toMatch(/never record decisions on behalf/);
           });

           it("no admin page introduces notifications, billing, share-links, or marketplace", () => {
                 for (const body of [ADMIN_PANEL, ADMIN_DETAIL]) {
                         expect(body).not.toMatch(/notification-dispatch/i);
                         expect(body).not.toMatch(/paystack|stripe|payfast|paddle/i);
                         expect(body).not.toMatch(/\binvoice\b/i);
                         expect(body).not.toMatch(/share[-_ ]?link/i);
                         expect(body).not.toMatch(/marketplace|discovery/i);
                         expect(body).not.toMatch(/white[-_ ]?label|funder\s+logo/i);
                 }
           });
});

describe("Batch 5 — Batch 1–4 preservation", () => {
    it("does not modify existing Batch 3/4 RPC signatures", () => {
          const sql = allMigrations();
          // These RPCs exist from earlier batches and must not be replaced with
           // a different signature by Batch 5. NOTE: fw_admin_seal_pack_v1 is
           // intentionally excluded from this list — it was legitimately
           // extended in Batch 12 (Phase 2, audited sealed-pack supersession)
           // with two additional optional parameters. See file header comment.
           for (const legacy of [
                   "fw_admin_approve_funder_org_v1",
                   "fw_admin_reject_funder_org_v1",
                   "fw_admin_release_deal_v1",
                   "fw_admin_revoke_deal_release_v1",
                   "fw_funder_authorize_pack_download_v1",
                 ]) {
                   // No Batch 5 migration file should redefine them (only earlier
            // migrations may).
            const latestB5 = readdirSync(MIG_DIR)
                     .filter((f) => f.endsWith(".sql"))
                     .sort()
                     .slice(-1)[0];
                   const b5body = readFileSync(join(MIG_DIR, latestB5), "utf8");
                   expect(b5body, `latest migration must not redefine ${legacy}`).not.toMatch(
                             new RegExp(`FUNCTION public\\.${legacy}\\(`),
                           );
           }
    });

           it("fw_admin_seal_pack_v1's legitimate Batch 12 redefinition preserves the original 6-argument call shape", () => {
                 const sql = allMigrations();
                 const idx = sql.lastIndexOf("FUNCTION public.fw_admin_seal_pack_v1(");
                 expect(idx, "latest fw_admin_seal_pack_v1 definition present").toBeGreaterThan(-1);
                 const block = sql.slice(idx, idx + 2000);
                 expect(block).toMatch(/p_release_id uuid/);
                 expect(block).toMatch(/p_storage_bucket text/);
                 expect(block).toMatch(/p_storage_path text/);
                 expect(block).toMatch(/p_file_sha256 text/);
                 expect(block).toMatch(/p_manifest_sha256 text/);
                 expect(block).toMatch(/p_watermark_template text/);
                 // New params must be optional (DEFAULT) so existing 6-arg callers are unaffected.
                  expect(block).toMatch(/p_supersede boolean DEFAULT false/);
           });

           it("does not rename or drop any p5_batch3 enum", () => {
                 const sql = allMigrations();
                 expect(sql).not.toMatch(/DROP TYPE public\.p5_batch3_/);
                 expect(sql).not.toMatch(/ALTER TYPE public\.p5_batch3_funder_role RENAME/);
           });
});
