/**
 * Batch V-UI-Fix-4 -- Real person-IDV wiring and manual-review queue
 * alignment. Source-level guard tests (matching this repo's existing
 * convention for supabase edge-function and cross-cutting checks that
 * cannot run without a live Supabase instance).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { IDV_ROUTE_TABLE } from "@/lib/idv/route-table";

function read(rel: string): string {
    return readFileSync(rel, "utf8");
}

describe("Batch V-UI-Fix-4 -- IdvStart calls the new person-IDV function", () => {
    const src = read("src/pages/desk/idv/IdvStart.tsx");

           it("invokes idv-person-verify for the live route path", () => {
                 expect(src.includes('"idv-person-verify"')).toBe(true);
           });

           it("never invokes the legacy idv-verify function", () => {
                 expect(/["']idv-verify["']/.test(src)).toBe(false);
           });

           it("still opens manual review (not idv-person-verify) for provider_not_available", () => {
                 const manualBranchStart = src.indexOf('chosenRoute.kind === "provider_not_available"');
                 const liveBranchStart = src.indexOf('"idv-person-verify"');
                 expect(manualBranchStart).toBeGreaterThan(-1);
                 expect(liveBranchStart).toBeGreaterThan(-1);
                 expect(manualBranchStart).toBeLessThan(liveBranchStart);
                 const manualBranchBlock = src.slice(manualBranchStart, liveBranchStart);
                 expect(manualBranchBlock.includes('"idv-open-manual-review"')).toBe(true);
           });

           it("labels document types using the route table's own document_class (no hardcoding)", () => {
                 expect(src.includes("docTypeLabelSuffix")).toBe(true);
                 expect(src.includes('r.document_class === "full_idv"')).toBe(true);
                 expect(src.toLowerCase().includes("supporting only")).toBe(true);
                 expect(src.toLowerCase().includes("does not unlock controlled actions")).toBe(true);
           });

           it("South Africa and Nigeria both expose at least one full_idv live route (Home Affairs / NIN)", () => {
                 const za = IDV_ROUTE_TABLE.find(
                         (r) => r.document_country === "ZA" && r.document_type === "za_home_affairs_enhanced",
                       );
                 const ng = IDV_ROUTE_TABLE.find(
                         (r) => r.document_country === "NG" && r.document_type === "ng_nin",
                       );
                 expect(za?.document_class).toBe("full_idv");
                 expect(za?.can_unlock_controlled_actions).toBe(true);
                 expect(ng?.document_class).toBe("full_idv");
                 expect(ng?.can_unlock_controlled_actions).toBe(true);
           });

           it("Nigerian voter ID is supporting-only and does not unlock controlled actions", () => {
                 const voterId = IDV_ROUTE_TABLE.find(
                         (r) => r.document_country === "NG" && r.document_type === "ng_voter_id",
                       );
                 expect(voterId?.document_class).toBe("supporting_only");
                 expect(voterId?.can_unlock_controlled_actions).toBe(false);
           });
});

describe("Batch V-UI-Fix-4 -- idv-person-verify function boundaries", () => {
    const src = read("supabase/functions/idv-person-verify/index.ts");

           it("imports the VerifyNow adapter", () => {
                 expect(src.includes('from "../_shared/verifynow/adapter.ts"')).toBe(true);
                 expect(src.includes("verifyNowIdv")).toBe(true);
           });

           it("does not import or reference any legacy/company provider", () => {
                 const banned = [
                         "onfido",
                         "cipc",
                         "companies_house",
                         "dilisense",
                         "sanctions.io",
                         "sumsub",
                         "didit",
                         "complycube",
                       ];
                 const lower = src.toLowerCase();
                 for (const b of banned) {
                         expect(lower.includes(b), `must not reference ${b}`).toBe(false);
                 }
           });

           it("never calls VerifyNow for a route that does not resolve to a live route", () => {
                 const routeCheckIdx = src.indexOf('routeRes.kind !== "route"');
                 const verifyCallIdx = src.indexOf("await verifyNowIdv(");
                 expect(routeCheckIdx).toBeGreaterThan(-1);
                 expect(verifyCallIdx).toBeGreaterThan(-1);
                 expect(routeCheckIdx).toBeLessThan(verifyCallIdx);
           });

           it("records the result via the existing p5scr_record_idv RPC, never a raw insert", () => {
                 expect(src.includes('admin.rpc("p5scr_record_idv"')).toBe(true);
                 expect(src.includes('.from("p5scr_idv_records").insert(')).toBe(false);
           });

           it("authenticates the caller and checks subject ownership before acting", () => {
                 expect(src.includes("authed.auth.getUser()")).toBe(true);
                 expect(src.includes("subj.person_external_ref !== userId")).toBe(true);
           });

           it("returns only safe fields to the UI (no raw provider payload)", () => {
                 const returnBlockStart = src.indexOf("ok: true,\n      subject_id: subjectId,");
                 expect(returnBlockStart).toBeGreaterThan(-1);
                 const returnBlock = src.slice(returnBlockStart, returnBlockStart + 300);
                 expect(returnBlock.includes("raw_provider_payload")).toBe(false);
           });

           it("VerifyNow secrets are not referenced directly in this function (adapter-only)", () => {
                 expect(src.includes("VERIFYNOW_API_KEY")).toBe(false);
                 expect(src.includes("VERIFYNOW_MODE")).toBe(false);
           });
});

describe("Batch V-UI-Fix-4 -- admin manual-review queue reads the source of truth", () => {
    it("IdvReviewQueue reads OPEN idv_person cases from p5scr_manual_reviews", () => {
          const src = read("src/pages/admin/idv/IdvReviewQueue.tsx");
          expect(src.includes('.from("p5scr_manual_reviews")')).toBe(true);
          expect(src.includes('.eq("category", "idv_person")')).toBe(true);
          expect(src.includes('.is("decided_at", null)')).toBe(true);
          expect(src.includes('.from("p5scr_check_results")')).toBe(false);
    });

           it("IdvReviewCase reads current status from the gate-readable p5scr_idv_records table", () => {
                 const src = read("src/pages/admin/idv/IdvReviewCase.tsx");
                 expect(src.includes('.from("p5scr_idv_records")')).toBe(true);
                 expect(src.includes('.from("p5scr_check_results")')).toBe(false);
                 expect(src.includes("projected_gate_state")).toBe(true);
           });

           it("IdvStatusWidget (user-facing) reads from p5scr_idv_records, not an unwritten table", () => {
                 const src = read("src/components/idv/IdvStatusWidget.tsx");
                 expect(src.includes('.from("p5scr_idv_records")')).toBe(true);
                 expect(src.includes('.from("p5scr_check_results")')).toBe(false);
           });
});

describe("Batch V-UI-Fix-4 -- admin decisions project into the gate-readable status", () => {
    const src = read("supabase/functions/idv-manual-review/index.ts");

           it("projects the decision into p5scr_idv_records via p5scr_record_idv", () => {
                 expect(src.includes("mapDecisionToGateState")).toBe(true);
                 expect(src.includes('admin.rpc("p5scr_record_idv"')).toBe(true);
           });

           it("returns the projected_gate_state to the caller (no client-side guessing needed)", () => {
                 expect(src.includes("projected_gate_state: gateState")).toBe(true);
           });

           it("does not expose private notes, raw payloads or biometric data in the response", () => {
                 const returnIdx = src.lastIndexOf("return json({\n      ok: true,");
                 expect(returnIdx).toBeGreaterThan(-1);
                 const returnBlock = src.slice(returnIdx, returnIdx + 300);
                 expect(returnBlock.includes("notes_admin_only")).toBe(false);
                 expect(returnBlock.includes("raw_provider_payload")).toBe(false);
           });
});

describe("Batch V-UI-Fix-4 -- decision-to-gate-state mapping never widens release conditions", () => {
    const src = read("supabase/functions/_shared/idv-manual-review-shape.ts");

           it("only manual_review_accepted maps to a releasing state", () => {
                 const fnStart = src.indexOf("export function mapDecisionToGateState");
                 expect(fnStart).toBeGreaterThan(-1);
                 const fnSrc = src.slice(fnStart);
                 // Every decision other than manual_review_accepted must map to a
                  // still-blocking InternalIdvStatus -- never to "manual_review_accepted"
                  // or "idv_completed" a second time.
                  const releasingMentions = (fnSrc.match(/return "manual_review_accepted"/g) ?? []).length;
                 const completedMentions = (fnSrc.match(/return "idv_completed"/g) ?? []).length;
                 expect(releasingMentions).toBe(1);
                 expect(completedMentions).toBe(0);
           });

           it("waived_with_reason is deliberately conservative (does not auto-release)", () => {
                 const fnStart = src.indexOf("export function mapDecisionToGateState");
                 const fnSrc = src.slice(fnStart);
                 const waivedIdx = fnSrc.indexOf('case "waived_with_reason"');
                 expect(waivedIdx).toBeGreaterThan(-1);
                 const waivedBlock = fnSrc.slice(waivedIdx, waivedIdx + 200);
                 expect(waivedBlock.includes('return "manual_review_accepted"')).toBe(false);
           });
});

describe("Batch V-UI-Fix-4 -- WaD gate column fix", () => {
    const src = read("supabase/functions/_shared/idv-wad-seal-gate.ts");

           it("queries organisation_id, not the non-existent org_id column", () => {
                 expect(src.includes('.eq("organisation_id", orgId)')).toBe(true);
                 expect(src.includes('.eq("org_id", orgId)')).toBe(false);
           });

           it("fails CLOSED (denies the seal) on a genuine subject lookup error", () => {
                 expect(src.includes("subjectLookupFailed")).toBe(true);
                 const failIdx = src.indexOf("if (subjectLookupFailed)");
                 expect(failIdx).toBeGreaterThan(-1);
                 const block = src.slice(failIdx, failIdx + 250);
                 expect(block.includes("allowed: false")).toBe(true);
           });

           it("still exposes the stable IDV_REQUIRED_WAD_SEAL error code", () => {
                 expect(src.includes("IDV_REQUIRED_WAD_SEAL")).toBe(true);
           });
});

describe("Batch V-UI-Fix-4 -- VerifyNow secrets remain server-side only", () => {
    it("new/modified src/** files do not reference VERIFYNOW_API_KEY", () => {
          const files = [
                  "src/pages/desk/idv/IdvStart.tsx",
                  "src/pages/admin/idv/IdvReviewQueue.tsx",
                  "src/pages/admin/idv/IdvReviewCase.tsx",
                  "src/components/idv/IdvStatusWidget.tsx",
                ];
          for (const f of files) {
                  const c = read(f);
                  expect(c.includes("VERIFYNOW_API_KEY"), `${f} must not reference VERIFYNOW_API_KEY`).toBe(false);
                  expect(c.includes("verifynow/adapter"), `${f} must not import the adapter`).toBe(false);
          }
    });
});
