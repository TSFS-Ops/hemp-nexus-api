# Facilitation Phase 2 — Plan (no code yet)

Acknowledged. Phase 1 is formally closed as `PHASE_1_CLIENT_UAT_READY`. This document is the Phase 2 plan only. No implementation will start until you approve it.

Phase 2 extends the Phase 1 facilitation queue with **operator-driven, approved-email outreach** to candidate counterparties, plus duplicate-org and do-not-contact safety, and a compliance escalation path. Phase 2 remains **manual-send-only**. There is no SLA engine, no reporting dashboard, no CSV/PDF export, and no automated mutation of payments, POIs, WaDs, or tokens.

---

## 1. What WILL be built

### 1.1 Approved-email outreach (manual send only)

- New "Outreach" tab inside the existing Phase 1 facilitation case drawer (`/hq/facilitation` → case).
- Per case, a `platform_admin` can:
  - add one or more candidate counterparties (free-text name + email + optional registry id + optional note);
  - pick a pre-approved template;
  - preview the rendered email;
  - **click Send** to actually dispatch (one recipient per send, idempotent).
- No bulk send. No "send to all". No background job that auto-sends.

### 1.2 Email template approval

- A small **template registry** owned by `platform_admin`:
  - `status ∈ {draft, approved, archived}`;
  - only `approved` templates appear in the Send picker;
  - templates are React Email components in `supabase/functions/_shared/transactional-email-templates/` and registered in `registry.ts` (reusing the existing app-email infrastructure);
  - HQ UI lists templates, shows status, and lets an admin mark `draft → approved` or `approved → archived` (no inline rich-text editor in Phase 2 — template bodies are code-reviewed like Phase 1).

### 1.3 Manual-send-only flow

- Single edge function (e.g. `facilitation-outreach-send`) callable only by `platform_admin` JWT.
- Each invocation sends to exactly one recipient, with an `Idempotency-Key` header.
- Hard server-side guard: function rejects if `template.status != 'approved'`, if recipient is suppressed, if recipient is on the DNC list, or if a duplicate-org hard-block is active without an explicit override reason.

### 1.4 Duplicate organisation checks

- Before "Add candidate" is accepted, run a server-side duplicate probe against:
  - existing `organizations` (by normalised name + registry id + domain of email);
  - existing onboarded counterparties already linked to this requester.
- Result is surfaced as:
  - **green** = no match;
  - **amber warning** = soft match (admin can proceed, reason captured);
  - **red hard-block** = exact registry id / verified domain match → cannot send without compliance escalation.

### 1.5 Do-not-contact checks

- New `ai_do_not_contact_rules` usage (table already exists) becomes authoritative for outreach:
  - email address match → hard-block;
  - domain match → hard-block;
  - org name match (normalised) → amber warning.
- Hard-block is enforced **server-side** in the send edge function, not only in UI.

### 1.6 Compliance escalation

- "Escalate to compliance" action on a candidate or on the whole case.
- Creates a row in existing `compliance_cases` (link back to `facilitation_cases.id`), sets the candidate to `escalated`, and prevents further Send actions on that candidate until a `platform_admin` (or compliance role) records a resolution note.
- No new compliance dashboard — escalations are visible in the existing case drawer and in the existing compliance case list.

### 1.7 Hard-block / warning rules (single source of truth)

- One server-side resolver (e.g. `resolveOutreachGate(candidate)`) returns:
  - `{ status: 'allow' | 'warn' | 'block', reasons: string[] }`.
- UI mirrors the resolver output but **never** decides the gate itself.

### 1.8 Audit events for every Phase 2 action

Canonical, append-only events (added to existing `audit_logs` / `event_store` with a prebuild name-guard):

- `facilitation.outreach.template_approved`
- `facilitation.outreach.template_archived`
- `facilitation.outreach.candidate_added`
- `facilitation.outreach.candidate_updated`
- `facilitation.outreach.duplicate_check_run`
- `facilitation.outreach.dnc_check_run`
- `facilitation.outreach.gate_evaluated`
- `facilitation.outreach.email_sent`
- `facilitation.outreach.email_failed`
- `facilitation.outreach.escalated_to_compliance`
- `facilitation.outreach.escalation_resolved`

Every send writes both `gate_evaluated` and `email_sent` (or `email_failed`) with the same correlation id.

### 1.9 User visibility rules

- Requesting trader (case owner) sees: that outreach is "in progress" and a coarse status (`contacting`, `awaiting_response`, `no_response`, `escalated`, `closed`).
- Requesting trader does **not** see: candidate email addresses, template bodies, internal notes, gate reasons, duplicate-check details, DNC reasons, or the audit/event log.
- `platform_admin` sees everything in the case drawer.
- Enforced by RLS on the new tables plus a thin server view for the trader-facing milestone.

---

## 2. What will NOT be built in Phase 2 (negative controls)

These are explicit non-goals and will be asserted by tests + prebuild guards:

1. **No SLA cron.** No new pg_cron job, no new scheduled edge function, no timer-driven status changes. Prebuild guard greps cron snapshots and fails if a `facilitation-*` schedule appears.
2. **No reporting dashboard.** No new `/hq/reports/*` or analytics page. Prebuild guard fails on any new route under `src/pages/hq/reports/`.
3. **No CSV export.** No new endpoint or button that emits CSV. Prebuild guard greps for `text/csv` and `Content-Disposition: attachment` in any new `facilitation-*` function.
4. **No audit-pack PDF.** No PDF generation, no `application/pdf` response, no new pdf library import.
5. **No payment mutation.** Phase 2 code must not import `atomic_token_burn`, must not touch `token_ledger`, `token_balances`, `token_purchases`, `payment_disputes`, `refund_requests`, `clip_on_*`.
6. **No POI mutation.** Must not call `atomic_generate_poi_v2`, must not write to `pois`, `poi_engagements`, `poi_events`.
7. **No WaD mutation.** Must not write to `wads`, `wad_attestations`, `attestations`, `p3_wads`, `p3_attestations`, `collapse_ledger`.
8. **No token mutation.** Covered by (5) but called out separately for the audit pack.
9. **No auto-onboarding of the contacted counterparty.** Replies are handled out-of-band in Phase 2; no inbound webhook, no auto-link to `organizations`.
10. **No bulk send / mail-merge.** One recipient per send call, enforced server-side.

---

## 3. Tables / functions / UI surfaces touched

### 3.1 New tables (with RLS + GRANTs)

- `facilitation_outreach_templates` (id, name, subject, body_ref, status, created_by, approved_by, approved_at, archived_at, …) — `platform_admin` read/write; nobody else.
- `facilitation_outreach_candidates` (id, case_id → `facilitation_cases.id`, org_name_norm, registry_id, email, domain, status, gate_status, gate_reasons jsonb, escalated_compliance_case_id, …) — `platform_admin` read/write; case owner gets a redacted view via server function only.
- `facilitation_outreach_sends` (id, candidate_id, template_id, idempotency_key UNIQUE, message_id, status, error, sent_by, sent_at, …) — `platform_admin` read; insert via edge function (service_role) only.

All three follow the standard `CREATE TABLE → GRANT → ENABLE RLS → POLICY` order.

### 3.2 Reused / extended tables

- `facilitation_cases` — add `outreach_state` enum column (`none`, `contacting`, `awaiting_response`, `no_response`, `escalated`, `closed`). No other schema changes.
- `facilitation_case_events` — reused for case-level outreach events.
- `audit_logs` / `event_store` — reused for the 11 canonical event names.
- `ai_do_not_contact_rules` — read-only consumer.
- `compliance_cases` — escalation target.
- `suppressed_emails` — read-only consumer in the send path.
- `email_send_log` — written by the existing app-email pipeline; no schema change.

### 3.3 New edge functions

- `facilitation-outreach-candidate-add` — runs duplicate + DNC checks, writes candidate row, returns gate result.
- `facilitation-outreach-send` — re-runs the gate, then invokes existing `send-transactional-email` with `purpose: "transactional"` and an idempotency key.
- `facilitation-outreach-escalate` — opens/links a `compliance_cases` row.
- `facilitation-outreach-template-status` — approve/archive a template.

All four require `platform_admin` and write audit events. No new cron schedules.

### 3.4 Reused Phase 1 surfaces

- `/hq/facilitation` list (no change).
- Case drawer (Phase 1) — adds an "Outreach" tab and a "Templates" sub-panel.
- Existing requester milestone view — adds the coarse `outreach_state` only.
- Existing `send-transactional-email`, `process-email-queue`, `handle-email-suppression`, `handle-email-unsubscribe`.
- Existing `BackButton`, modal close/X standard, edge-invoke error handling.

### 3.5 New UI surfaces (HQ only)

- "Outreach" tab in the case drawer.
- "Templates" panel under HQ → Facilitation → Templates (list + approve/archive only).

No new trader-facing page is added.

---

## 4. New prebuild guards

Added to `package.json` `prebuild`:

1. `check-facilitation-phase2-audit-names.mjs` — fails if any `facilitation.outreach.*` event name in code is not in the canonical list, or vice-versa.
2. `check-facilitation-phase2-no-cron.mjs` — fails if `supabase/snapshots/cron.json` contains any job whose name matches `facilitation`.
3. `check-facilitation-phase2-no-mutation-paths.mjs` — fails if any file under `supabase/functions/facilitation-*` imports or references: `atomic_token_burn`, `atomic_generate_poi_v2`, `atomic_accept_bind`, `token_ledger`, `token_balances`, `pois`, `poi_engagements`, `wads`, `wad_attestations`, `collapse_ledger`.
4. `check-facilitation-phase2-no-export.mjs` — fails on `text/csv`, `application/pdf`, or `Content-Disposition: attachment` inside `supabase/functions/facilitation-*` and `src/pages/hq/facilitation/**`.
5. Reused: existing `check-facilitation-no-send-path.mjs` is updated to **allow** `facilitation-outreach-send` (the one authorised send path) and continue blocking every other send path under `facilitation-*`.

---

## 5. How it will be tested

### 5.1 Headless pack (extends Phase 1 Run-4 pack)

- Template lifecycle: draft → approved → send works; archived → send blocked.
- Duplicate hard-block: exact registry-id match → send 409.
- Duplicate soft-warn: name-only match → send allowed with `gate_status='warn'` and reason captured.
- DNC email match → send 409 `DNC_BLOCKED`.
- DNC domain match → send 409 `DNC_BLOCKED`.
- Suppressed recipient → send 409 `SUPPRESSED`.
- Idempotency: same `Idempotency-Key` replays return the original result, no second email.
- Escalation: candidate → `compliance_cases` row created, `escalated_to_compliance` audit present, further sends blocked.
- Audit completeness: every state transition produces exactly the expected canonical event names; prebuild guard passes.
- Negative controls: assert no cron job created, no CSV/PDF endpoint reachable, no calls to POI/WaD/token atomic functions.
- RLS: non-`platform_admin` JWT cannot read `facilitation_outreach_*` tables; case-owner trader sees only the coarse `outreach_state`.

### 5.2 Manual operator verification (mirrors Phase 1 attestation)

- Walkthrough by `platform_admin` on the preview environment, evidence captured under `evidence/facilitation-phase-2-operator-verification/`.

### 5.3 Negative-control evidence

- Snapshot of `cron.json` showing no new `facilitation` job.
- `rg` output proving no banned imports under `supabase/functions/facilitation-*`.
- HTTP probe showing `/hq/facilitation` exposes no CSV/PDF endpoint.

---

## 6. CLIENT_UAT_READY criteria for Phase 2

Phase 2 verdict flips to `PHASE_2_CLIENT_UAT_READY` only when **all** of these hold:

1. All headless tests in §5.1 pass on a clean run.
2. All four new prebuild guards pass; the updated `check-facilitation-no-send-path.mjs` passes.
3. Manual operator attestation recorded for: template approve, candidate add (green/amber/red), DNC block, duplicate block, send success, send idempotency, escalation, escalation resolution.
4. Trader milestone view confirmed to show only coarse `outreach_state` and no internal data.
5. Negative-control evidence committed under `evidence/facilitation-phase-2-operator-verification/negative-controls/`.
6. `RELEASE_GATE.md` updated with the Phase 2 closeout block; `evidence/.../summary.json` flipped.
7. No mutations observed on `pois`, `wads`, `token_ledger`, `token_balances`, `payment_disputes`, `refund_requests` during the full UAT window (verified by a read-only diff snapshot before/after).

---

## 7. Out of scope (deferred beyond Phase 2)

- SLA timers, escalation cron, reminder emails.
- Reporting dashboard, charts, CSV export, audit-pack PDF.
- Inbound reply ingestion / auto-onboarding of contacted counterparties.
- Bulk outreach, mail-merge, campaign tooling.
- Any payment / POI / WaD / token state changes triggered by outreach.

---

**Next step:** review and either approve this plan as-is, or send edits. No Phase 2 code will be written until you explicitly approve.  
  
Phase 2 plan reviewed.

I approve the direction, but please revise the plan before code starts.

Two items must be clarified and tightened first:

1. Do-not-contact source of truth

Please confirm whether `ai_do_not_contact_rules` is genuinely the correct canonical table for facilitation outreach do-not-contact rules.

If it is AI-specific, experimental, or not intended to govern real counterparty outreach, do not reuse it.

Preferred enterprise-grade option:

- create a dedicated `facilitation_do_not_contact_rules` table, or
- create a generic `do_not_contact_rules` table if the platform needs one shared DNC register.

The DNC table must support:

- email-level block
- domain-level block
- organisation-name warning
- reason
- created_by
- created_at
- status / active flag
- audit trail
- platform_admin/compliance-only write access

2. Compliance escalation authority

Please clarify who can resolve a compliance escalation.

Preferred enterprise-grade rule:

- platform_admin can escalate
- platform_admin can view escalation state
- compliance_admin / compliance role should resolve the compliance escalation
- platform_admin should only resolve if the existing platform governance model already allows platform_admin to override compliance decisions

Do not allow ordinary admin convenience to weaken the compliance control.

Everything else in the plan is directionally approved:

- approved-email outreach
- one recipient per send
- approved templates only
- idempotency
- suppression checks
- duplicate checks
- DNC checks
- hard-block / warning resolver
- audit events
- trader milestone redaction
- no SLA cron
- no reporting dashboard
- no CSV/PDF export
- no POI/WaD/token/payment mutation

Please return a revised Phase 2 plan with those two points resolved.

No Phase 2 code until the revised plan is approved.