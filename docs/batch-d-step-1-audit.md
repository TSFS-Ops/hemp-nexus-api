# Batch D — Step 1: Pending Engagement & Counterparty Control Audit

**Status:** Audit only. No code, migrations, edge functions, UI, or fixtures
have been changed. **Awaiting approval before writing code.**

**Scope:** Inspect what exists today against the 9 client decisions in scope
for Batch D (CP-002, CP-003, CP-006, CP-009, CP-012, CP-015, MT-009, DEC-001,
DEC-004) drawn from the signed *Izenzo Client-Only Workflow Decision Form*
(05/05/2026, Daniel Davies — *Approved: Yes*).

Batch C (Challenge Workflow) is frozen and is **not** modified or proposed
for change here.

---

## 1. Executive summary (plain English)

The platform already has most of the *plumbing* for Pending Engagement
control, but several of the signed client decisions are only **partially**
enforced and one (CP-012, *counterparty disputes being named*) is not
modelled at all.

What is solid today:

- A single `poi_engagements` table with one **current engagement per match**
  (partial unique index `uq_poi_engagements_one_current_per_match`) and a
  rich engagement state machine
  (`pending → notification_sent → contacted → accepted | declined | expired`,
  plus the late-acceptance reconfirmation lane).
- A central, shared **engagement progression guard**
  (`supabase/functions/_shared/engagement-progression-guard.ts`, mirrored at
  `src/lib/engagement-progression-guard.ts`) that is consumed by
  `match`, `poi-transition`, `wad`, `p3-wad`, `attestation`, and `collapse`.
  This is the single chokepoint for "no POI / WaD / collapse without an
  accepted engagement".
- A signed contact-completeness rule
  (`src/lib/contact-completeness.ts` + `supabase/functions/_shared/contact-completeness.ts`)
  that already implements CP-002 and CP-003: outreach is blocked for both
  `email_missing` and `contact_incomplete`. Both surfaces (UI badge + edge
  function gate) share the same code paths.
- A late-acceptance / reconfirmation lane for CP-009 with dedicated columns
  (`original_expired_at`, `late_acceptance_recorded_at`,
  `reconfirmation_window_expires_at`, `late_acceptance_resolution`,
  `reconfirmed_at`, `reconfirmed_by_user_id`, `renewed_from_engagement_id`,
  `renewed_engagement_id`) and a partial unique index ensuring a single
  renewal chain. Lifecycle scheduler closes stale reconfirmation windows.
- A binding-hint contract (`src/types/poi-engagement.ts`) that
  distinguishes `bound`, `no_match`, `already_bound`, `lookup_error` and is
  surfaced to admins as a toast after a PATCH.
- An immutable outreach log (`engagement_outreach_logs`) with admin-only
  RLS, service-role-only insert, and structured `entry_type` /
  `actor_type` enums covering `contact_attempt`, `status_change`,
  `notes_edit`, `email_update`, `system_action`.

Where the signed decisions are **not yet fully enforced**:

- **CP-006 (registered-org binding):** today's auto-bind logic only uses
  exact-email match against `profiles`. There is **no admin "binding review"
  state** for ambiguous matches (shared mailbox, multiple-org email,
  conflicting org name, domain-only match). On ambiguity the system silently
  resolves to `no_match` or `lookup_error` and outreach is not blocked.
- **CP-009 (expiry window):** the engagement default is **30 days**
  (`now() + '30 days'::interval`), not the 7 calendar days specified in the
  signed form. Late-acceptance reconfirmation logic itself is implemented.
- **CP-012 (counterparty disputes being named):** no UI, RPC, edge function,
  status, or audit action exists for an invited counterparty to declare *I
  am not involved*. There is no automatic dispute-hold transition.
- **CP-015 (silent counterparty-email change):** the PATCH route on
  `poi-engagements/index.ts` rewrites `counterparty_email` in place. There
  is no "cancel old engagement + create new with audit + invalidate the old
  outreach link" flow. The old token/link remains live.
- **MT-009 (named authorised contact required):** `matches` carries
  `buyer_org_id` / `seller_org_id` only — there is **no
  `buyer_user_id` / `seller_user_id` / `authorised_contact_id` column** on
  `matches`, and no `organisation_attached_contact_required` engagement
  state. The progression guard does not require a named contact before POI
  / WaD.
- **DEC-001 / DEC-004 (off-platform contact / manual outreach ownership):**
  outreach can today only be sent through the admin send-outreach route, so
  ownership is *de facto* admin-only, but there is no explicit
  manual-outreach state model (`bounce_review`, `no_response`,
  `dispute_review`, `suppressed_or_test`) — the admin queue only
  distinguishes contact-completeness state, not operational state.

The recommended Batch D build is a tightly scoped layer on top of the
existing engagement table and progression guard — no broad refactor and no
Batch C touch points.

---

## 2. Current-state map

### 2.1 Data model

| Object | Purpose | Already supports Batch D? | Gap |
|---|---|---|---|
| `public.poi_engagements` | One current engagement per match. Holds counterparty email, org link, contact_type/name, expiry, late-acceptance lane, support notes, source. | Mostly | Missing dispute fields; missing email-change cancellation linkage; expiry default is 30d not 7d; no `binding_review_required` flag. |
| `engagement_status` enum | `pending, notification_sent, contacted, accepted, declined, expired, late_acceptance_pending_initiator_reconfirmation` | Partial | Missing `binding_review_required`, `disputed_being_named`, `cancelled_email_change`, `org_attached_contact_required` (or equivalent flags). |
| `counterparty_type` enum | unknown / org / named individual | Yes | — |
| `public.engagement_outreach_logs` | Append-only audit of every contact attempt, status change, notes edit, email update, system action. RLS admin-only; service-role-only insert. | Yes | Schema is sufficient. New `entry_type` values may be needed for `dispute_raised`, `binding_review_resolved`, `email_change_cancellation`. |
| `public.matches` | `buyer_org_id`, `seller_org_id` only. No `buyer_user_id` / `seller_user_id` / `authorised_contact_id`. | No | Cannot enforce MT-009 without adding a named-contact column or a side table. |
| `public.invites` | Generic invite table. | Likely re-usable for outreach link tokens — needs a path-specific check before re-using for engagement re-issue. | — |
| `public.counterparties` | Counterparty registry. | Reviewed — not currently the binding source for engagement auto-resolve (resolution is via `profiles.email`). | — |
| `engagement_outreach_logs.entry_type` | `contact_attempt, status_change, notes_edit, email_update, system_action` | Partial | Add `binding_review`, `dispute_raised`, `email_change_cancellation`, `late_acceptance_reconfirmed`. |

Indexes already in place that will support Batch D queries:
`idx_poi_engagements_contact_incomplete`,
`idx_poi_engagements_counterparty_email`,
`idx_poi_engagements_expires_at`,
`idx_poi_engagements_reconfirmation_window`,
`idx_poi_engagements_sla_scan`.

### 2.2 Creation paths

| Path | File | Required inputs today | Allows name-only? | Allows email-only? | Can trigger POI/WaD/burn before completeness? |
|---|---|---|---|---|---|
| Admin "Add engagement" | `src/components/admin/AdminPendingEngagementsPanel.tsx` → `POST /poi-engagements` | match_id + (email or contact_name); `counterparty_type` defaults `unknown`. | Yes (admin queue only) | Yes (admin queue only) | No — `decideEngagementProgression` blocks POI/WaD/collapse. |
| Eligibility soft-route | `discovery-eligibility` → engagement with `source='eligibility_soft_route'` | Inferred from search candidate. | Same as above | Same as above | No — same guard. |
| `AddContactDialog` (admin) | `src/components/admin/AddContactDialog.tsx` | Radio enforces "organisation needs name OR linked org" and "named_individual needs name". | — | — | — |

### 2.3 Outreach behaviour

Two routes on `supabase/functions/poi-engagements/index.ts`:

- `POST /poi-engagements/:id/preview-outreach` (lines 268–378)
- `POST /poi-engagements/:id/send-outreach` (lines 382–610)

Both apply the **same gate**:
- `isUsableContactEmail(...)` reject `null`, blank, malformed, `.invalid`
- `getContactState(engagement, match)` → if `isOutreachBlocked(state)` →
  fail with `CONTACT_EMAIL_MISSING` or `CONTACT_INCOMPLETE`
  (`contactBlockCode`).

Approved wording is rendered server-side, not from free-text input. Email
suppression / unsubscribe is handled by `handle-email-suppression`.

What is **not** blocked at the outreach gate today:
- Ambiguous registered-org binding (CP-006).
- Engagements whose status is `expired` *if* a fresh email is added without
  cancelling/replacing the engagement (covered indirectly by the unique
  partial index, but worth re-checking).
- Disputed-being-named (CP-012) — state does not exist.
- Engagements created against a match that has `buyer_org_id` /
  `seller_org_id` only and no named user/contact (MT-009).

### 2.4 Registered-organisation binding

Current behaviour in `poi-engagements/index.ts` ~lines 1024–1080:

- Auto-bind triggers only when the PATCH includes `counterparty_email`
  AND the engagement has no `counterparty_org_id` yet.
- Resolution = exact, lowercased, trimmed match against `profiles.email`,
  reading the user's `org_id`.
- Outcomes: `bound` (single match), `no_match` (no profile), `already_bound`
  (engagement already has an org link), `lookup_error` (transient DB error).
- **Multiple-match / shared mailbox:** if more than one profile shares the
  email, the resolver currently picks the first row returned (effectively
  non-deterministic) — *no admin review state is created and outreach is
  not blocked.* This is the CP-006 gap.
- **Domain-only match:** not implemented (no behaviour to lock down).
- **Name vs domain conflict:** not detected.

### 2.5 Expiry and late acceptance (CP-009)

- Default expiry: `expires_at = now() + '30 days'` (DB default on
  `poi_engagements.expires_at`). **Signed form requires 7 calendar days.**
- Lifecycle scheduler (`supabase/functions/lifecycle-scheduler/index.ts`)
  scans `expires_at < now()` to flip stale engagements to `expired`
  (lines 175–180) and closes stale reconfirmation windows (line 559).
- Late acceptance is fully modelled: status flips to
  `late_acceptance_pending_initiator_reconfirmation`; columns
  `original_expired_at`, `late_acceptance_recorded_at`,
  `reconfirmation_window_expires_at` are NOT NULL when in that state
  (CHECK constraint `poi_engagements_late_acceptance_required_fields_chk`).
- Progression guard returns `LATE_ACCEPTANCE_PENDING_INITIATOR_RECONFIRMATION`
  to block POI/WaD/collapse until the initiator reconfirms or declines.
- Resolutions modelled: `renewed_engagement_created`,
  `initiator_declined_renewal`, `reconfirmation_window_expired`.

### 2.6 Counterparty disputes being named (CP-012)

**Not implemented.** No status, RPC, edge function, UI action, or audit
event represents a named counterparty saying *I am not involved*.

### 2.7 Counterparty email change after engagement creation (CP-015)

- The PATCH `/poi-engagements/:id` route accepts `counterparty_email` in
  the same envelope as `contact_type`, `contact_name`, `admin_notes`,
  `support_notes`, `contact_method`, `contact_date` (Zod schema lines
  43–49 + 862–872). On change it **overwrites in place** (line 1028:
  `updates.counterparty_email = normalisedEmail`). An `email_update` row is
  written to `engagement_outreach_logs` with the previous status preserved.
- The previous outreach **link / token is not invalidated**, the previous
  engagement row is **not** cancelled, and a fresh engagement is **not**
  created. This is the CP-015 gap.

### 2.8 Named-contact requirement (MT-009)

- `matches` has only `buyer_org_id` and `seller_org_id` — no
  `buyer_user_id` / `seller_user_id` / `authorised_contact_id` columns.
- The progression guard relies entirely on engagement status; it does not
  require a named individual for outreach, POI, or WaD.
- The admin AddContactDialog supports `contact_type='named_individual'`
  with a required `contact_name`, but this is captured on the engagement
  (`poi_engagements.contact_name`), not on the match.
- No status such as `organisation_attached_contact_required` exists.
- `AdminPendingEngagementsPanel` shows the contact-completeness badge but
  does **not** gate match progression on a named-individual being assigned.

### 2.9 Manual outreach ownership (DEC-001 / DEC-004)

- Send-outreach is callable only through the admin route (`is_admin` is
  enforced). De-facto Izenzo-admin ownership is satisfied.
- Outreach actions modelled today: `Add contact`, `Send outreach`,
  `Record contact`, status edits, support-note edits.
- Manual operational states **not** distinctly modelled:
  `bounce_review`, `no_response`, `dispute_review`,
  `suppressed_or_test_review`, `binding_review`. These exist conceptually
  in the admin's head and via the contact-completeness badge, but they are
  not first-class statuses or queue filters.
- Notes are append-only via `engagement_outreach_logs` (good); but
  `support_notes` on `poi_engagements` is mutable (single-field overwrite)
  — verify whether the form's "manual notes immutable" requirement should
  re-route all admin notes through the log.

### 2.10 Audit and notification coverage

| Decision | Required audit action | Exists today? | Gap |
|---|---|---|---|
| CP-002 | Block-attempt log when send-outreach gate refuses for `CONTACT_EMAIL_MISSING` | Partial — error is returned to client, but no audit row is written when the gate fires. | Add `entry_type='system_action'` row capturing the block, requestId, gate code. |
| CP-003 | Same as CP-002 with `CONTACT_INCOMPLETE` | Partial | Same as above. |
| CP-006 | Binding-review-created + binding-resolved | Missing | Needs new entry_types and admin action audit. |
| CP-009 | Engagement-expired, late-acceptance-recorded, initiator-reconfirmed/declined | Yes (lifecycle-scheduler + guard) | Confirm 7-day default is enforced (currently 30d). |
| CP-012 | Dispute-raised, dispute-hold-applied, dispute-resolved | Missing entirely | All net-new. |
| CP-015 | Email-change-cancellation, new-engagement-created-from-cancelled | Partial — `email_update` log exists but does not capture the cancel/recreate flow. | New entry_type + linkage column on `poi_engagements`. |
| MT-009 | Named-contact-required-applied, named-contact-assigned | Missing | New columns on `matches` + audit rows. |
| DEC-001 | Outreach-blocked-no-eligibility | Existing (CONTACT_* gate covers this proxy) | Confirm acceptance test wording. |
| DEC-004 | Manual-outreach-state changes | Partial | Add explicit operational states. |

Notifications (Resend / in-app via `notification-dispatch`) currently fire
for accepted / declined / late acceptance. They do **not** fire for
binding review, dispute, email-change cancellation, or named-contact
required. These are net-new.

---

## 3. Decision-by-decision gap table

| # | Decision | Status today | Files of record |
|---|---|---|---|
| CP-002 | **Implemented** at outreach gate. Add audit-on-block for full evidence. | `src/lib/contact-completeness.ts`, `supabase/functions/_shared/contact-completeness.ts`, `supabase/functions/poi-engagements/index.ts` (lines 268–610) |
| CP-003 | **Implemented** at outreach gate. Same audit gap as CP-002. | Same as above |
| CP-006 | **Partial** — only exact-email→profile match, no ambiguity handling, no admin review state. | `supabase/functions/poi-engagements/index.ts` (lines 1019–1080), `src/types/poi-engagement.ts` |
| CP-009 | **Implemented** lane; expiry default is **30d, signed form says 7d**. | `poi_engagements.expires_at` default; `supabase/functions/lifecycle-scheduler/index.ts` (175–180, 559); `_shared/engagement-progression-guard.ts` |
| CP-012 | **Not implemented**. No UI, RPC, status, or audit. | — |
| CP-015 | **Partial** — PATCH overwrites email in place; no cancel/recreate; old link still live. | `supabase/functions/poi-engagements/index.ts` (lines 862–1191) |
| MT-009 | **Not implemented**. `matches` has org IDs only. No named-contact gate. | `supabase/migrations/*matches*` (column inventory: `org_id`, `buyer_org_id`, `seller_org_id`); `_shared/engagement-progression-guard.ts` |
| DEC-001 | **De-facto enforced** through the admin-only send-outreach route + completeness gate. | `supabase/functions/poi-engagements/index.ts` |
| DEC-004 | **Partial** — admin-only ownership exists; explicit operational states (`bounce_review`, `no_response`, `dispute_review`, `suppressed_or_test`, `binding_review`) not modelled. | `engagement_outreach_logs`, admin queue UI |

---

## 4. Progression risk table

Every risk listed below is a place where, today, an *incomplete /
ambiguous / expired / disputed / silently-redirected* engagement could
still allow downstream movement that the signed form forbids.

| # | Risk | File / function | Why it is risky | Decision violated | Recommended Batch D gate |
|---|---|---|---|---|---|
| R1 | Ambiguous binding silently picks first match | `poi-engagements/index.ts` ~1029–1078 | Wrong-org disclosure; deal context exposed to a third party. | CP-006 | Add `engagement_status='binding_review_required'`; block all outreach + POI; surface in admin queue. |
| R2 | 30-day expiry default vs signed 7-day | `poi_engagements.expires_at` DB default | Stale acceptances treated as fresh. | CP-009 | DB default → 7 days; backfill behaviour decided per-row, not retro-actively. |
| R3 | Counterparty cannot raise *not involved* | n/a | Continued nudges; reputational + consent risk. | CP-012 | New `disputed_being_named` status + counterparty-side action + dispute hold; guard returns new code. |
| R4 | Silent email change overwrites engagement | `poi-engagements/index.ts` PATCH `counterparty_email` | Original recipient receives nothing further; new recipient inherits trust of old engagement; old token still live. | CP-015 | PATCH path forks: if engagement already has an outreach event, must cancel + create new engagement; record `renewed_from_engagement_id` linkage; old outreach token invalidated. |
| R5 | Match progresses past discovery with org-only contact | `match`, `poi-transition`, `wad`, `attestation`, `collapse` | POI / WaD signed against an organisation the responsible person never authorised. | MT-009 | Add `requires_named_contact` check to `decideEngagementProgression`; new code `NAMED_CONTACT_REQUIRED`. |
| R6 | Audit silence on outreach blocks | poi-engagements outreach gate | Cannot prove to client that block happened. | CP-002 / CP-003 | Insert `engagement_outreach_logs` row with `entry_type='system_action'` whenever the gate fires. |
| R7 | Operational states collapsed into one bucket | admin queue panel | Admins cannot distinguish "bounced" from "no response" from "dispute review". | DEC-004 | Either expand `engagement_status` enum OR add `operational_state` text column with controlled vocabulary. |

---

## 5. Recommended Batch D implementation plan

### D1 — Data / status model updates

- Add to `engagement_status` enum (or, if you want to avoid an enum
  alteration, add a parallel `operational_state` text column with a CHECK
  constraint):
  - `binding_review_required`
  - `disputed_being_named`
  - `cancelled_email_change`
  - `org_attached_contact_required`
- Add columns to `public.poi_engagements`:
  - `cancelled_at`, `cancelled_reason`, `cancelled_by_user_id`,
    `cancellation_replacement_engagement_id`
  - `binding_candidates jsonb` (snapshot of ambiguous matches at the time
    of resolution)
  - `disputed_at`, `disputed_by`, `dispute_reason text`
- Add to `public.matches`:
  - `buyer_user_id uuid NULL REFERENCES auth.users(id)`
  - `seller_user_id uuid NULL REFERENCES auth.users(id)`
  - (or a dedicated `match_authorised_contacts` table if multi-contact is
    needed later)
- Change DB default on `poi_engagements.expires_at` from `now() + 30 days`
  to `now() + 7 days`.
- Add `engagement_outreach_logs.entry_type` values: `binding_review`,
  `dispute_raised`, `email_change_cancellation`, `outreach_blocked`.

**Risk level:** Medium. **Touches Batch C?** No. **Migration required:** Yes.

### D2 — Server-side gates

- Extend `_shared/engagement-progression-guard.ts` with new return codes:
  `BINDING_REVIEW_PENDING`, `DISPUTED_BEING_NAMED`,
  `NAMED_CONTACT_REQUIRED`. Mirror to `src/lib/engagement-progression-guard.ts`.
- Extend `_shared/contact-completeness.ts` (and src mirror) with a
  `binding_state` field returned alongside `ContactState`.
- Extend `poi-engagements/preview-outreach` and `send-outreach` to:
  - Block when `binding_state ∈ {ambiguous, conflicting, domain_only}`.
  - Block when engagement is in `disputed_being_named`.
  - Audit every block.
- Fork PATCH `counterparty_email` into a "cancel + create" flow once a
  contact attempt has been logged.
- Add `RPC raise_counterparty_dispute(engagement_id, reason text)` callable
  from a counterparty-side acceptance link without auth (rate-limited,
  token-validated).

**Risk level:** Medium. **Touches Batch C?** No.

### D3 — Admin queue / UI

- Extend `AdminPendingEngagementsPanel` with operational filters:
  *No contact*, *Missing name*, *Binding review*, *Late acceptance*,
  *Bounce review*, *No response*, *Dispute review*,
  *Suppressed / test review*.
- Add admin actions: *Resolve binding*, *Cancel + replace email*,
  *Apply dispute hold*, *Lift dispute hold*, *Assign named contact*.
- Add a Match Details ribbon for *Named contact required*.

**Risk level:** Low–Medium. **Touches Batch C?** No.

### D4 — Notifications and audit

- New `notification-dispatch` channels for: binding-review-required,
  dispute-raised, email-change-cancellation, named-contact-required.
- Required wording lifted verbatim from the signed form (CP-002 already
  uses the approved string — keep that pattern).
- Every gate fire writes one `engagement_outreach_logs` row with
  `entry_type='system_action'` or the new D1 entry types.

### D5 — Tests

- Vitest unit tests: contact-completeness with binding states;
  progression guard with new codes; cancel+create email-change flow.
- Deno tests on `poi-engagements`: ambiguous-binding 409; dispute 409;
  email-change cancellation 409 → 201; named-contact 409.
- New `src/tests/batch-d-*.test.ts` files (mirroring Batch B layout).

### D6 — Demo fixtures + walkthrough

- Seed engagements covering each state in
  `supabase/tests/batch_d_phase*_fixtures_seed.sql`.
- Author `docs/batch-d-walkthrough.md`, `docs/batch-d-cover-note.md`,
  `docs/batch-d-reviewer-checklist.md`. Run the new mandatory pre-send QA
  checklist before regenerating any DOCX (every link, every login, every
  match opened, every attachment opened, every walkthrough step followed
  exactly).

**Risk level:** Low. **Touches Batch C?** No (Batch C docs and fixtures
remain untouched).

---

## 6. Stop point

**Awaiting approval before writing code.** No migrations, edge function
changes, UI changes, fixtures, or DOCX regeneration have been performed in
this step. Batch C remains frozen and untouched.
