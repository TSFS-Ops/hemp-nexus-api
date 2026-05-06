import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const doc = new jsPDF({ unit: "pt", format: "a4" });
const W = doc.internal.pageSize.getWidth();
const M = 48;
let y = M;

const EMERALD = [4, 120, 87];
const SLATE = [15, 23, 42];
const MUTED = [100, 116, 139];

function ensure(h) {
  if (y + h > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; }
}
function h1(t) {
  ensure(40);
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...SLATE);
  doc.text(t, M, y); y += 22;
  doc.setDrawColor(...EMERALD); doc.setLineWidth(1.5);
  doc.line(M, y, M + 60, y); y += 16;
}
function h2(t) {
  ensure(28);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...EMERALD);
  doc.text(t, M, y); y += 16;
}
function p(t, opts = {}) {
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.size || 10);
  doc.setTextColor(...(opts.color || SLATE));
  const lines = doc.splitTextToSize(t, W - 2 * M);
  ensure(lines.length * 13 + 4);
  doc.text(lines, M, y); y += lines.length * 13 + 4;
}
function meta(t) { p(t, { color: MUTED, size: 9 }); }

// Cover header
doc.setFillColor(...SLATE); doc.rect(0, 0, W, 90, "F");
doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
doc.text("VERICRO  ·  IZENZO API REVIEW", M, 38);
doc.setFontSize(20);
doc.text("Counterparty & Pending Engagement", M, 62);
doc.setFont("helvetica", "normal"); doc.setFontSize(11);
doc.text("Implementation-Readiness Assessment vs Signed Decision Form", M, 80);
y = 110;

p("Date: 06 May 2026", { bold: true });
p("Prepared for: David Davies, James Davies and Daniel Davies");
p("Prepared by: Vericro — Mavis and Scooby");
p("Reference: Izenzo Client-Only Workflow Decision Form (signed 05/05/2026)");
y += 6;

h2("Purpose of this note");
p("This review compares the current Izenzo platform code against the signed Client Decision Form, focused only on the counterparty and Pending Engagement area requested. It is a readiness assessment, not an implementation. No code has been changed.");

h2("How to read the table");
p("Each item lists what already exists, whether the platform currently complies with the signed answer, what is missing, the type of change required, and where in the platform the work would land. Terms are kept in plain English where possible.");

// Helper to add an item
function item(code, title, body) {
  ensure(60);
  doc.setFillColor(241, 245, 249);
  const startY = y;
  doc.rect(M, y, W - 2 * M, 22, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...SLATE);
  doc.text(`${code}  —  ${title}`, M + 8, y + 15);
  y += 30;

  autoTable(doc, {
    startY: y,
    head: [["Question", "Finding"]],
    body,
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: SLATE, lineColor: [226, 232, 240] },
    headStyles: { fillColor: EMERALD, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 1: { cellWidth: W - 2 * M - 150 } },
    margin: { left: M, right: M },
    didDrawPage: () => { y = M; },
  });
  y = doc.lastAutoTable.finalY + 14;
}

doc.addPage(); y = M;
h1("1. Per-item readiness assessment");

item("CP-002 / DEC-002", "Counterparty name exists, email missing", [
  ["Existing support", "Yes — `poi_engagements` table allows `counterparty_email = NULL`. Admin Pending Engagements panel shows a no-contact warning. AddContactDialog provides an Add contact affordance. Notify/Send-outreach button is gated client-side via `isUsableOutreachEmail` and server-side by Zod email validation in the poi-engagements PATCH handler."],
  ["Compliant today?", "Partial."],
  ["What exists", "Outreach is genuinely blocked without a valid email; the dialog and warning copy are close to the wording the client approved."],
  ["What is missing", "The required audit events (`pending_engagement.no_contact_details_detected`, `…contact_details_added`, `…outreach_blocked_missing_email`) are not emitted. There is no internal admin notification when a name-only record is created. No formal `contact_state = no_contact` field — state is inferred from email being null."],
  ["Type of change", "Small code change + new audit events. Optional small schema addition (`contact_state`). Copy tweak (one extra line in warning). No new module."],
  ["Files / areas", "`supabase/functions/poi-engagements/index.ts`, `src/components/admin/AdminPendingEngagementsPanel.tsx`, `AddContactDialog.tsx`, audit-log writer, notification dispatch."],
  ["Risks", "Low. Mainly observability — without the named audit events, compliance evidence the client signed off on cannot be produced on demand."],
  ["Open questions", "Confirm the exact internal admin notification channel (email vs in-app vs both) and recipient list."],
]);

item("CP-003", "Counterparty email exists, name missing", [
  ["Existing support", "Partial — the PATCH handler accepts an optional `counterparty_name` field (max 200). There is no dedicated `contact_state = missing_name` flag and no UI block on outreach when name is absent."],
  ["Compliant today?", "No."],
  ["What exists", "Schema can store name; AddContactDialog captures email."],
  ["What is missing", "Outreach is not gated on counterparty name being present. No `pending_engagement.identity_incomplete_email_only_detected` or `…outreach_blocked_missing_counterparty_name` audit events. No 'identity incomplete' badge in the admin queue."],
  ["Type of change", "Small code change + new audit events + small UI addition (badge + gating)."],
  ["Files / areas", "Same as CP-002 plus the outreach send path in `poi-engagements/index.ts`."],
  ["Risks", "Low. Mostly additive."],
  ["Open questions", "Does 'name' mean person name, organisation name, or either? The signed answer says 'name, person, or organisation' — confirm whether matched-to-an-org satisfies the gate even if no person name is captured."],
]);

item("CP-006", "Name/email matches an already-registered organisation", [
  ["Existing support", "Yes — the PATCH handler resolves `counterparty_email → profiles.org_id` and returns a `binding` hint with one of `bound`, `no_match`, `already_bound`, `lookup_error`. Documented in `docs/poi-engagements-binding-contract.md`."],
  ["Compliant today?", "Partial."],
  ["What exists", "Unique exact-email auto-binding works; the reviewer dashboard shows the binding outcome; binding will not overwrite a deliberate prior binding."],
  ["What is missing", "Multi-match / shared-email / domain-match / partial-name-match collision detection is not implemented — the resolver only checks `profiles.org_id` for the supplied email and treats anything other than a unique hit as `no_match`. There is no `binding_review_required` admin queue, no `pending_engagement.binding_review_required` audit event, no `…outreach_blocked_binding_review_required` event, and no admin 'confirm binding' control."],
  ["Type of change", "Small-to-medium code change + new admin UI (binding-review queue) + new audit events. No new schema strictly required (status can ride on existing fields), but a `binding_review_required` boolean column would simplify filtering."],
  ["Files / areas", "`supabase/functions/poi-engagements/index.ts` (resolver), `src/types/poi-engagement.ts`, AdminPendingEngagementsPanel, possibly a new BindingReviewPanel."],
  ["Risks", "Medium. This is the highest-risk item in the batch — wrong binding can expose deal context to the wrong organisation."],
  ["Open questions", "Confirm the exact match-types to detect (exact, domain, partial name, conflicting name+email) and the priority order. Confirm whether shared-email cases (e.g. info@…) should be auto-rejected by a domain blocklist."],
]);

item("CP-009 / DEC-003", "Counterparty accepts after expiry", [
  ["Existing support", "Partial — `poi_engagements.expires_at` exists; lifecycle-scheduler expires `trade_orders` past their `expires_at`; the engagement status enum includes `expired`."],
  ["Compliant today?", "No."],
  ["What exists", "Expiry timestamp and an `expired` terminal state."],
  ["What is missing", "There is no `late_acceptance_pending_initiator_reconfirmation` status (the enum and `VALID_STATUS_TRANSITIONS` table treat `expired` as terminal with no outbound transitions). No counterparty-acceptance path that detects 'now > expires_at' and routes to a late-acceptance state. No initiator reconfirmation UI/email. No `pending_engagement.accepted_after_expiry`, `…late_acceptance_reconfirmed_by_initiator`, `…late_acceptance_declined_by_initiator` audit events. The 7-calendar-day expiry rule is not codified anywhere we could find."],
  ["Type of change", "Database/schema change (new enum value), small-to-medium code change in poi-engagements + lifecycle-scheduler, new initiator-facing email + UI confirmation, new audit events."],
  ["Files / areas", "Postgres enum migration, `supabase/functions/poi-engagements/index.ts`, `supabase/functions/lifecycle-scheduler/index.ts`, AcceptEngagementCard, notification dispatch templates."],
  ["Risks", "Medium. Touches the engagement state machine; needs careful migration of the existing enum."],
  ["Open questions", "Confirm the exact 7-day clock anchor (outreach-sent-at vs notification-sent-at vs created-at). Confirm whether reconfirmation creates a new engagement row or reopens the existing one (the signed answer allows either)."],
]);

item("CP-012", "Counterparty disputes being named", [
  ["Existing support", "Partial — a generic `disputes` table exists with `match_id`, `raised_by_org_id`, `reason`, `status`, `resolution_outcome`. There is an AdminDisputesPanel."],
  ["Compliant today?", "No."],
  ["What exists", "Generic dispute infrastructure and the documented Dispute Lock Policy that blocks commercial mutations during a dispute."],
  ["What is missing", "There is no counterparty-facing 'I dispute being named' affordance — the existing dispute flow assumes the raiser is an authenticated org member, not an unregistered/invited counterparty. No `disputed_named_counterparty` match status and no `on_hold_counterparty_dispute` engagement status. No counterparty-side outreach email links to a dispute action. No `pending_engagement.counterparty_disputed_being_named` audit event. Admin release/close logging would need to be added."],
  ["Type of change", "New dispute/exception sub-flow (counterparty-facing dispute capture from the outreach link) + database/schema change (new statuses, dispute reason enum) + new audit events + admin UI extensions."],
  ["Files / areas", "New unauthenticated counterparty-dispute edge route, `disputes` table migration, `match-state.ts`, `engagement-state.ts`, AdminDisputesPanel, outreach email templates."],
  ["Risks", "Medium-high. Counterparty-side capture without authentication is a sensitive surface (anti-abuse, identity confirmation, link-replay)."],
  ["Open questions", "Confirm how the disputing party authenticates the action from a token in the outreach email. Confirm what (if any) evidence the disputer must supply. Confirm SLA for admin review."],
]);

item("CP-015", "Initiator changes counterparty email after engagement created", [
  ["Existing support", "Partial — the poi-engagements PATCH handler accepts `counterparty_email` updates on existing rows and re-runs binding resolution; today the email is silently overwritten."],
  ["Compliant today?", "No — the platform currently does the opposite of the signed answer (silent edit allowed)."],
  ["What exists", "Audit trail of PATCH requests; binding hint on the response."],
  ["What is missing", "No block on direct email edits. No `cancelled_email_change_required` / `superseded_by_new_engagement` statuses. No automatic creation of a new engagement row carrying the corrected email. No invalidation of the old outreach link. No `pending_engagement.email_change_blocked_requires_new_engagement` or `…created_after_counterparty_email_change` audit events. No `billing_review_required` flag for the credit-already-burned case."],
  ["Type of change", "Database/schema change (new statuses, link-invalidation column or token version), code change to convert email-edit into cancel-and-recreate, new audit events, withdrawal email template, admin notification."],
  ["Files / areas", "`supabase/functions/poi-engagements/index.ts`, outreach link/token store, `engagement-state.ts`, AdminPendingEngagementsPanel, email templates."],
  ["Risks", "Medium. Behavioural change for admins who currently rely on inline email edits — needs migration messaging."],
  ["Open questions", "Confirm whether the old engagement should be visually 'merged' under the new one in the admin queue, or shown as two separate rows linked by `superseded_by`."],
]);

item("MT-009", "Match has org ID but no individual buyer/seller user/contact", [
  ["Existing support", "Partial — `matches.buyer_org_id` and `seller_org_id` exist; `getMatchRole` resolves viewer role from these slots. The Match Details page uses these to gate role-specific UI."],
  ["Compliant today?", "Partial."],
  ["What exists", "Org-level attachment is canonical; many downstream gates (POI mint, document upload) already require participant identity at the user level."],
  ["What is missing", "No first-class `organisation_attached_contact_required` status on the match. No 'Assign contact' admin/org-admin affordance bound to that status. No `match.organisation_attached_contact_required`, `…progression_blocked_missing_named_contact`, or `match.named_contact_assigned` audit events. The block on outreach/POI/WaD when no contact is assigned is implicit (downstream calls fail) rather than explicit."],
  ["Type of change", "Small code change + new audit events + small UI (assign-contact dialog and badge). Possibly a small schema field for the explicit status."],
  ["Files / areas", "`matches` table or a status helper, `match-state.ts`, MatchDetails / MatchHeroCard, AdminPendingEngagementsPanel."],
  ["Risks", "Low."],
  ["Open questions", "Confirm whether the org admin (not just Izenzo admin) may assign the contact for their own organisation."],
]);

item("DEC-001", "When an off-platform counterparty may be contacted", [
  ["Existing support", "Implicit — the entire Pending Engagement / outreach flow exists for unregistered counterparties. There is no explicit policy gate that says 'this is the moment the platform is allowed to email an off-platform party.'"],
  ["Compliant today?", "Cannot be assessed — the signed form lists this row in scope but the parsed PDF copy did not contain the page with the client's chosen behaviour for DEC-001 (the document parser stopped at page 50)."],
  ["What exists", "Outreach send path requires a valid email, an admin actor, rate-limit checks, legitimacy checks, and idempotency."],
  ["What is missing", "Cannot determine until the signed DEC-001 answer is shared in text form."],
  ["Type of change", "Likely copy/text + small code change (a single explicit policy check before the outreach send) + audit event. Possibly client clarification first."],
  ["Files / areas", "`supabase/functions/poi-engagements/index.ts` outreach branch, outreach email templates."],
  ["Risks", "Cannot be quantified without the signed answer."],
  ["Open questions", "Please share the signed DEC-001 answer in plain text (the parsed PDF cut off before reaching this row). Confirm the lawful basis chosen for first contact (e.g. legitimate interest, prior business relationship, public-domain contact details)."],
]);

item("DEC-004", "Who owns manual outreach", [
  ["Existing support", "Yes — every other in-scope row in the signed form names 'Izenzo admin' as the owner of manual follow-up, and the AdminPendingEngagementsPanel is built around that ownership model."],
  ["Compliant today?", "Partial — ownership matches the form's pattern, but there is no explicit 'owner' column on the engagement row, no 'assign to admin' workflow, and no SLA timer per owner."],
  ["What exists", "Admin queue, support_notes, contacted_at/contact_method, sla_reminder_sent_at."],
  ["What is missing", "Cannot fully assess until the signed DEC-004 answer is shared (same parser cut-off as DEC-001). If the answer simply confirms 'Izenzo admin' end-to-end, this is a copy/text change plus a short policy doc; if it splits ownership (e.g. Izenzo admin for unregistered, client org for registered) it becomes a small code change to record and surface the owner."],
  ["Type of change", "Likely copy/text or small code change. Possibly client clarification first."],
  ["Files / areas", "AdminPendingEngagementsPanel, support-notes / admin-notes fields, possibly a new `owner_role` column on `poi_engagements`."],
  ["Risks", "Low."],
  ["Open questions", "Please share the signed DEC-004 answer in plain text. Confirm whether ownership ever transfers (e.g. once the counterparty registers)."],
]);

doc.addPage(); y = M;
h1("2. Implementation grouping");

h2("Batch A — observability and copy (low risk, fast)");
p("CP-002, CP-003, MT-009. These are small code changes plus the new audit events the signed form requires, with minor UI copy and one Add-contact gating fix. No schema migrations. Can ship together because they all add new audit-event constants and touch the same admin panel.");

h2("Batch B — engagement state machine (medium risk)");
p("CP-009 and CP-015. Both add new engagement statuses and new transitions to the same state-machine table in `poi-engagements/index.ts` plus a Postgres enum migration. Doing them in one migration avoids two enum-alter rounds. Also pairs naturally because both end with an admin-visible 'requires reconfirmation / requires new engagement' card.");

h2("Batch C — binding-review queue (medium risk, dedicated work)");
p("CP-006 alone. The collision-detection logic, the new admin queue, and the binding-confirm control deserve their own batch and acceptance test pass — this is the row where wrong behaviour can leak deal context to the wrong organisation.");

h2("Out-of-scope / change-order candidates");
p("CP-012 (counterparty disputes being named) is a new dispute sub-module with an unauthenticated counterparty-facing surface, link-token security, and admin review SLA. It is materially larger than the other rows and should be scoped as a separate change order rather than rolled into a workflow-refinement batch.");

p("DEC-001 and DEC-004 cannot be sized until the signed text for those two rows is shared (the parser truncated the PDF before reaching them). Both are likely small once clarified, but should not be batched until then.");

h1("3. Recommendation on where to start");
p("Start with Batch A. It is the lowest-risk work, it produces the audit evidence the client signed for, and it gives Izenzo something visible inside a week without touching the state machine or the dispute model. While Batch A is in flight, send the two open questions on CP-006 and the two missing decision texts (DEC-001, DEC-004) back to Izenzo so Batches B and C can start with no ambiguity. Treat CP-012 as a separate change-order conversation.");

p(" ");
meta("This note is a readiness assessment only. No code, schema, secrets, or source material has been modified or shared. Findings are based on the current Izenzo codebase as inspected on 06 May 2026 against the signed Decision Form dated 05 May 2026.");

const out = "/mnt/documents/izenzo-counterparty-pending-engagement-review-2026-05-06.pdf";
doc.save(out);
console.log("Wrote", out);
