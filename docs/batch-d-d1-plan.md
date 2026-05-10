# Batch D — D1 Plan: Data, Status & Audit Foundation

**Status:** Planning only. No code, migrations, edge functions, UI,
fixtures, or DOCX have been changed. Batch C remains frozen.
**Awaiting approval before D1 implementation.**

References: `docs/batch-d-step-1-audit.md` and the signed
*Izenzo Client-Only Workflow Decision Form* (05/05/2026, Daniel Davies —
*Approved: Yes*).

---

## 1. Executive summary (plain English)

D1 lays the **foundation tiles** that everything else in Batch D will
stand on. Until the data model, statuses, and audit vocabulary are
correct, the UI, notifications, fixtures, and walkthroughs cannot be
built honestly — they would be decorating a structure that cannot yet
record what the signed form requires.

D1 is deliberately limited to:

- the columns, enums, defaults, indexes, and check constraints we will
  need;
- the audit action names and required metadata;
- one safe migration plan that is backwards-compatible with Batch C.

D1 explicitly does **not** include UI changes, the cancel-and-recreate
flow itself (that is server work in D3), notifications wiring (D4),
fixtures (D6), or any DOCX. It also does not touch Batch C, legacy
disputes, or rating emission.

In one line: **D1 makes the database able to *describe* every state the
signed form requires, so D2/D3 can *enforce* them.**

---

## 2. Proposed database / status changes

### 2.1 Strategic choice — enum vs. parallel column

We propose **option B: add a parallel `operational_state` text column on
`poi_engagements` with a CHECK constraint**, and only add
**two** new values to the `engagement_status` enum:
`disputed_being_named` and `cancelled_email_change`.

Layman's trade-off:

- *Expanding the enum* is the tidiest model but every new value forces
  an `ALTER TYPE`, requires every consumer (edge functions, RLS, the
  progression guard, the UI) to handle it, and an enum value can never
  be removed without a destructive migration. Operational states like
  *bounce review* and *no response* change shape over time — they are
  **operational**, not **lifecycle**.
- *A parallel `operational_state` column with a CHECK list* keeps the
  lifecycle enum (`pending → accepted/declined/expired`) clean and
  business-stable, and lets us add or rename operational states with a
  single CHECK swap. It also reflects reality: an engagement can be
  `notification_sent` *and* `bounce_review` at the same time — those are
  two orthogonal facts.

The two genuinely-lifecycle states (`disputed_being_named`,
`cancelled_email_change`) **do** belong in the enum because they are
terminal-or-near-terminal and they change what the progression guard
returns.

### 2.2 New / changed columns and constraints

> Every change below is **additive** and backwards-compatible. No
> existing column is renamed or dropped. The current
> `engagement_outreach_logs` schema is retained verbatim.

#### 2.2.1 `engagement_status` enum

| Value | Type | Reason | Decision |
|---|---|---|---|
| `disputed_being_named` | enum value | Terminal-pending status when a counterparty rejects being named on the trade. The progression guard must return a new code so POI/WaD/burn are blocked. | CP-012 |
| `cancelled_email_change` | enum value | Terminal status applied to the *old* engagement when an email-change cancel-and-recreate occurs. Allows the unique partial index `uq_poi_engagements_one_current_per_match` to keep working unchanged (it already excludes `expired` and `declined`; we add `cancelled_email_change` to that excluded list — see 2.2.4). | CP-015 |

Backwards compatibility: existing rows are unaffected. Any consumer that
switches over `engagement_status` must add cases for both values; the
audit lists every such call site (see §11).

#### 2.2.2 `poi_engagements` — new columns

All nullable, all default `NULL`. Each is documented with the decision
it serves.

| Column | Type | Default | Reason | Decision |
|---|---|---|---|---|
| `operational_state` | `text` | `NULL` | Parallel queue/operational bucket — see 2.2.3 for the controlled list. | DEC-004, CP-006 |
| `operational_state_set_at` | `timestamptz` | `NULL` | When the current operational_state was applied. | DEC-004 |
| `operational_state_set_by` | `uuid` | `NULL` | Admin who set the operational state (NULL when set by system). | DEC-004 |
| `binding_candidates` | `jsonb` | `NULL` | Snapshot of all profile/org rows the resolver considered when CP-006 ambiguity was detected. Captured at resolution time so a later admin review is reproducible. Schema: `[{org_id, org_name, profile_id, email, match_strength}]`. | CP-006 |
| `binding_resolution` | `text` | `NULL` | One of: `auto_bound`, `admin_bound`, `admin_marked_unbound`, `admin_marked_no_match`, `admin_marked_unsafe`. NULL when CP-006 review never fired. | CP-006 |
| `binding_resolved_at` | `timestamptz` | `NULL` | — | CP-006 |
| `binding_resolved_by` | `uuid` | `NULL` | Admin user. NULL for `auto_bound`. | CP-006 |
| `disputed_at` | `timestamptz` | `NULL` | When CP-012 dispute was raised. | CP-012 |
| `disputed_by_email` | `text` | `NULL` | Email of the counterparty who raised the dispute (token-validated; need not be a registered profile). | CP-012 |
| `disputed_by_user_id` | `uuid` | `NULL` | Set only when the counterparty was a registered profile. | CP-012 |
| `dispute_reason` | `text` | `NULL` | Free-text up to 1000 chars. CHECK on length. | CP-012 |
| `cancelled_at` | `timestamptz` | `NULL` | Set when an engagement is cancelled (any reason). | CP-015 |
| `cancelled_reason` | `text` | `NULL` | One of: `email_change`, `disputed_being_named_admin`, `superseded_by_admin`, `withdrawn_by_initiator`. CHECK enumerates allowed values. | CP-015, CP-012 |
| `cancelled_by_user_id` | `uuid` | `NULL` | Admin or initiator. | CP-015 |
| `replacement_engagement_id` | `uuid` | `NULL` | FK back to `poi_engagements(id) ON DELETE SET NULL`. Points from the cancelled row to the new row. **Inverse** of `renewed_engagement_id` (which already exists for late-acceptance renewals). Keeping them as two separate columns avoids overloading semantics across CP-009 and CP-015. | CP-015 |
| `previous_counterparty_email` | `text` | `NULL` | Captured on cancel so the audit can show "old → new" in one place. | CP-015 |

CHECK constraints (additive):

- `poi_engagements_operational_state_chk` — see 2.2.3.
- `poi_engagements_binding_resolution_chk` — enumerates the five values
  in `binding_resolution`.
- `poi_engagements_cancelled_reason_chk` — enumerates the four values
  in `cancelled_reason`.
- `poi_engagements_dispute_required_fields_chk` —
  `engagement_status <> 'disputed_being_named' OR
   (disputed_at IS NOT NULL AND
    (disputed_by_user_id IS NOT NULL OR disputed_by_email IS NOT NULL))`.
- `poi_engagements_cancelled_required_fields_chk` —
  `engagement_status <> 'cancelled_email_change' OR
   (cancelled_at IS NOT NULL AND cancelled_reason = 'email_change' AND
    replacement_engagement_id IS NOT NULL AND
    previous_counterparty_email IS NOT NULL)`.

Indexes (additive):

- `idx_poi_engagements_operational_state` btree
  `(operational_state, created_at DESC) WHERE operational_state IS NOT NULL`
  — supports admin queue filters.
- `idx_poi_engagements_disputed` btree
  `(disputed_at DESC) WHERE engagement_status = 'disputed_being_named'`.
- `idx_poi_engagements_replacement` btree
  `(replacement_engagement_id) WHERE replacement_engagement_id IS NOT NULL`.

#### 2.2.3 `operational_state` controlled list

Implemented as a CHECK on `poi_engagements.operational_state`:

```
operational_state IN (
  'contact_missing',           -- no usable email, no usable name
  'contact_incomplete',        -- partial: name without email or vice versa
  'binding_review_required',   -- CP-006 ambiguous match
  'ready_for_outreach',        -- gates passed, awaiting send
  'no_response',               -- outreach sent, SLA elapsed
  'bounce_review',             -- delivery bounce / suppression detected
  'late_acceptance_review',    -- companion to CP-009 lifecycle status
  'disputed_being_named',      -- companion to CP-012 lifecycle status
  'named_contact_required',    -- MT-009 (engagement-side mirror)
  'suppressed_or_test_review', -- recipient is suppressed or .invalid placeholder
  'cancelled_for_email_change' -- companion to CP-015 lifecycle status
)
```

Rationale: every operational queue filter the admin team will need maps
1:1 to a CHECK value. We deliberately keep `accepted`, `declined`, and
`expired` *out* of `operational_state` because those are lifecycle
statuses already.

#### 2.2.4 `uq_poi_engagements_one_current_per_match` partial unique index

Existing definition excludes `expired` and `declined`. Extend the
exclusion list to include `cancelled_email_change` and
`disputed_being_named` so a replacement engagement can be created
without violating the "one current per match" invariant.

#### 2.2.5 `public.matches` — MT-009 named contact

Add two nullable columns now (no enforcement yet — enforcement is D2):

| Column | Type | Default | Reason |
|---|---|---|---|
| `buyer_authorised_user_id` | `uuid REFERENCES auth.users(id) ON DELETE SET NULL` | `NULL` | Named buyer-side contact required before POI/WaD. |
| `seller_authorised_user_id` | `uuid REFERENCES auth.users(id) ON DELETE SET NULL` | `NULL` | Named seller-side contact required before POI/WaD. |

We **recommend the columns approach** over a side table — see §7.

Indexes:
- `idx_matches_buyer_authorised_user` btree `(buyer_authorised_user_id)`
- `idx_matches_seller_authorised_user` btree `(seller_authorised_user_id)`

Backwards compatibility: nullable + no DB enforcement in D1. The MT-009
gate becomes active in D2.

#### 2.2.6 `engagement_outreach_logs` — new `entry_type` values

Extend the existing CHECK list (additive only):

```
entry_type IN (
  'contact_attempt', 'status_change', 'notes_edit',
  'email_update', 'system_action',                 -- existing
  'binding_review',          -- CP-006
  'binding_resolved',        -- CP-006
  'dispute_raised',          -- CP-012
  'dispute_lifted',          -- CP-012
  'email_change_cancellation', -- CP-015
  'replacement_engagement_created', -- CP-015
  'outreach_blocked',        -- CP-002 / CP-003 audit-on-block
  'named_contact_assigned',  -- MT-009
  'operational_state_changed' -- DEC-004
)
```

No new audit table is needed. `engagement_outreach_logs` is already
admin-only RLS and service-role-only insert, which is the correct
posture for every D1 audit event.

---

## 3. Expiry change (CP-009)

### 3.1 New default

```
ALTER TABLE public.poi_engagements
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');
```

Affects only **new rows**. Lifecycle scheduler logic at
`supabase/functions/lifecycle-scheduler/index.ts:175-180` is unchanged
because it scans `expires_at < now()` regardless of original window.

### 3.2 Should existing live pending engagements be changed retroactively?

**Recommendation: No. Do not retroactively shorten live engagements.**

Reasons:

- Counterparties who received a 30-day invitation made a reasonable
  reliance on that window. Shortening it without a fresh notification is
  a consent issue.
- The 30-day rows are by definition pre-signature; the signed form is
  forward-looking.
- The reconfirmation lane (already implemented) already protects the
  initiator: a counterparty accepting after expiry must trigger a
  reconfirm. So the absence of retroactive shortening does not create
  governance risk on the *deal* side.

If the client later wants the 30-day rows aligned, the **safe** path is:

1. Identify rows where `expires_at > now() + interval '7 days'` AND
   `engagement_status IN ('pending','notification_sent','contacted')`.
2. Send a courtesy "your invitation expiry has been shortened" email
   via `notification-dispatch`.
3. Update `expires_at = now() + interval '7 days'` and write an
   `engagement_outreach_logs` row with `entry_type='system_action'`,
   `notes='expiry shortened to 7-day signed default'`.

This stays **out of D1**. We will surface it as an optional
post-approval one-shot if the client requests it.

---

## 4. CP-006 binding review model

| Resolver outcome | `binding_resolution` set to | `engagement_status` | `operational_state` | Outreach allowed? | Progression allowed? |
|---|---|---|---|---|---|
| Clean exact email match → exactly one profile, exactly one org | `auto_bound` | unchanged | `ready_for_outreach` (or unchanged if already past send) | Yes | Yes |
| No match | *NULL* (resolver did not fire a review) | unchanged | `ready_for_outreach` if name+email present | Yes | Yes (subject to other gates) |
| Multiple profiles match the email | *NULL until admin acts* | unchanged | `binding_review_required` | **No — blocked** | **No — guard returns new code `BINDING_REVIEW_PENDING`** |
| Shared mailbox (e.g., `info@`, `sales@`, `accounts@`) — heuristic list | *NULL until admin acts* | unchanged | `binding_review_required` | **No — blocked** | **No** |
| Domain-only hint (email domain matches an org but no profile email matches) | *NULL until admin acts* | unchanged | `binding_review_required` | **No — blocked** | **No** |
| Conflicting org name vs. profile org | *NULL until admin acts* | unchanged | `binding_review_required` | **No — blocked** | **No** |
| Admin manually binds to org X | `admin_bound` | unchanged | clears (set to `ready_for_outreach`) | Yes | Yes |
| Admin marks "no safe binding" | `admin_marked_unbound` | unchanged | clears | Yes (treat as unregistered) | Yes |
| Admin marks "do not contact — unsafe" | `admin_marked_unsafe` | `disputed_being_named` *or* `cancelled_email_change` depending on reason | sticks | No | No |

`binding_candidates` JSONB is captured at the moment the resolver
detects ambiguity. It is **immutable thereafter**; admin actions write
new rows to `engagement_outreach_logs` instead of mutating it.

The shared-mailbox heuristic is a small, versioned list shipped in
code (`supabase/functions/_shared/shared-mailbox-list.ts` — created in
D2, not D1). D1 only needs the columns to exist.

---

## 5. CP-012 disputed-being-named model

State + audit:

- Lifecycle status: `engagement_status = 'disputed_being_named'`.
- Operational mirror: `operational_state = 'disputed_being_named'`.
- Required fields when dispute is set: `disputed_at`,
  `dispute_reason`, and at least one of `disputed_by_user_id` or
  `disputed_by_email`. Enforced by
  `poi_engagements_dispute_required_fields_chk`.

Who can trigger:

- The named counterparty themselves, via a token-validated link sent in
  the original outreach email. Endpoint design lives in D2; D1 only
  guarantees the columns and audit vocabulary exist.
- An Izenzo admin acting on a phone/email report from the counterparty.

What gets blocked the moment dispute is set:

- `decideEngagementProgression` returns new code `DISPUTED_BEING_NAMED`
  → blocks POI mint, WaD seal, attestation, collapse, and credit burn
  on the parent match.
- `preview-outreach` and `send-outreach` return 409 with code
  `DISPUTED_BEING_NAMED`.
- The counterparty record is no longer auto-bound to any registered org
  even if a clean email exists.

What admin sees later:

- Admin queue filter `Disputed being named` returns rows where
  `engagement_status = 'disputed_being_named'`. Hero card shows
  `disputed_at`, `disputed_reason`, `disputed_by_email`, and the
  contact-attempt history.
- Admin can `Lift dispute` → writes `dispute_lifted` audit row;
  `engagement_status` flips back to its pre-dispute value (captured in
  the audit row metadata) **only with platform-admin role**.

Audit rows written:

| Action | `entry_type` | Required metadata |
|---|---|---|
| Counterparty raises dispute | `dispute_raised` | `disputed_by_email`, `dispute_reason`, `actor_type='counterparty'`, source IP hash |
| Admin raises dispute on behalf | `dispute_raised` | `disputed_by_email`, `dispute_reason`, `actor_type='admin'`, `admin_user_id`, `admin_email` |
| Admin lifts dispute | `dispute_lifted` | `actor_type='admin'`, `admin_user_id`, `admin_email`, `notes` (mandatory) |

---

## 6. CP-015 email-change cancellation model

### 6.1 When a simple in-place edit is allowed

Only when the engagement has **never had an outreach event**:

```
NOT EXISTS (
  SELECT 1 FROM engagement_outreach_logs
   WHERE engagement_id = :id
     AND entry_type IN ('contact_attempt','email_update','system_action')
     AND new_status IN ('notification_sent','contacted')
)
AND engagement_status = 'pending'
```

In that window, the email is functionally a draft and can be
overwritten. An `email_update` audit row is still written.

### 6.2 When cancel-and-recreate is required

Whenever any outreach has been issued, recorded, or attempted, OR when
`engagement_status` is anything other than `pending`. The cancel +
recreate is one server-side transaction (designed in D3, gated by D1
columns), in this order:

1. Validate that no terminal block applies (no active
   `disputed_being_named`, no live POI mint in flight).
2. Insert the new `poi_engagements` row in `pending` with the new
   email. Capture its id.
3. Update the old row:
   - `engagement_status = 'cancelled_email_change'`
   - `cancelled_at = now()`
   - `cancelled_reason = 'email_change'`
   - `cancelled_by_user_id = :actor`
   - `replacement_engagement_id = :new_id`
   - `previous_counterparty_email = :old_email`
   - `operational_state = 'cancelled_for_email_change'`
4. Invalidate the old outreach token (mechanism: token rows in
   `invites`/equivalent will be flagged `revoked_at = now()`; concrete
   row design lives in D2 once we audit the existing token table).
5. Write two audit rows:
   - on the old engagement: `entry_type='email_change_cancellation'`
     with metadata `{old_email, new_email, replacement_engagement_id}`.
   - on the new engagement:
     `entry_type='replacement_engagement_created'` with metadata
     `{cancelled_engagement_id, old_email, new_email}`.

The existing `uq_poi_engagements_one_current_per_match` partial unique
index, after the 2.2.4 change, will permit step 2 to succeed because
the old row's status is now in the excluded list.

### 6.3 Linkage view

The replacement chain becomes navigable in both directions:
`renewed_from_engagement_id` / `renewed_engagement_id` (CP-009 reuse)
remain reserved for **late-acceptance renewals**.
`replacement_engagement_id` is reserved for **CP-015 email changes**.
Keeping the two semantics separate avoids ambiguous joins in audit
queries.

---

## 7. MT-009 named authorised contact model

Three options were considered:

| Option | Pros | Cons |
|---|---|---|
| **A. `buyer_authorised_user_id` / `seller_authorised_user_id` on `matches`** | Simplest; one query to gate; no joins; matches today's `buyer_org_id` / `seller_org_id` pattern; existing RLS policies on `matches` cover it for free. | Only one named contact per side — multiple-contact scenarios need a future migration. |
| B. `match_authorised_contacts` side table | Multi-contact ready; richer history. | Net-new RLS surface; every consumer must learn a new join; harder to gate at the progression guard. |
| C. Reuse `poi_engagements.contact_name` only | Zero schema change. | Engagement-scoped, not match-scoped — a fresh engagement loses the assignment; cannot represent the buyer side independently. |

**Recommendation: Option A.** It mirrors the existing org-id pattern,
satisfies the signed form (one named contact per side is the explicit
ask), keeps the progression guard simple, and leaves the door open for
later migration to a side table without breaking callers.

D1 only adds the columns and indexes (see 2.2.5). The progression
guard is *not* changed in D1; it gains the `NAMED_CONTACT_REQUIRED`
return code in D2.

---

## 8. Manual outreach operational states

Implemented as the controlled `operational_state` text column +
CHECK described in 2.2.3 — **not** as a new enum.

Reasons (layman):

- These states change shape with operations (today we want
  `bounce_review`; tomorrow we may want `vendor_review`). A CHECK list
  swap is a one-line migration; an enum value rename is destructive.
- Enums force every consumer to compile-time-handle every value. A text
  column with CHECK lets server logic treat unknown values as a
  forward-compatible "ignore" case.
- The lifecycle is `engagement_status`. The operational queue is
  `operational_state`. Keeping them orthogonal matches how the admin
  team actually triages.

D1 ships the column + CHECK + index. Setters and resolvers are D2/D3.

---

## 9. Audit actions

All written to `engagement_outreach_logs`. All inserts via
service-role. All consumed by `lifecycle-scheduler` reports and the
admin queue.

| Action | `entry_type` | Required metadata (in `notes` JSON or columns) |
|---|---|---|
| Outreach blocked — email missing | `outreach_blocked` | `gate_code='CONTACT_EMAIL_MISSING'`, `request_id`, `surface='preview-outreach'\|'send-outreach'`, `actor_type='admin'`, `admin_user_id`, `admin_email` |
| Outreach blocked — contact incomplete | `outreach_blocked` | `gate_code='CONTACT_INCOMPLETE'`, rest as above |
| Binding review created | `binding_review` | `binding_candidate_count`, `resolver_reason='multiple_profiles'\|'shared_mailbox'\|'domain_only'\|'name_conflict'`, `previous_status` |
| Binding review resolved | `binding_resolved` | `binding_resolution` (one of the five values), `org_id` if bound, `admin_user_id`, `admin_email`, `notes` (mandatory free-text reason ≤ 500 chars) |
| Late acceptance recorded | (existing flow — no change) | — |
| Initiator reconfirmed | (existing flow — no change) | — |
| Initiator declined renewal | (existing flow — no change) | — |
| Counterparty disputed being named | `dispute_raised` | as in §5 |
| Email changed and old engagement cancelled | `email_change_cancellation` | `old_email`, `new_email`, `replacement_engagement_id`, `previous_status`, `actor_type`, `admin_user_id` (if admin) |
| Replacement engagement created | `replacement_engagement_created` | `cancelled_engagement_id`, `old_email`, `new_email` |
| Named contact required | `system_action` | `gate_code='NAMED_CONTACT_REQUIRED'`, `match_id`, `side='buyer'\|'seller'`, `previous_status` |
| Named contact assigned | `named_contact_assigned` | `match_id`, `side`, `assigned_user_id`, `assigned_user_email`, `admin_user_id`, `admin_email` |
| Manual outreach state changed | `operational_state_changed` | `previous_operational_state`, `new_operational_state`, `notes` (mandatory if new state ∈ {bounce_review, no_response, suppressed_or_test_review}) |

The existing CHECK constraint
`engagement_outreach_logs_admin_actor_required` already enforces
`admin_user_id IS NOT NULL AND admin_email IS NOT NULL` for
`actor_type='admin'`. The dispute-raised counterparty path uses
`actor_type='counterparty'` (the existing CHECK
`engagement_outreach_logs_counterparty_actor_required` is satisfied
because we will populate `admin_user_id` with the counterparty's
auth uid where available; for unauthenticated dispute clicks we will
relax that CHECK in D2 only after explicit approval — flagged as a
follow-up risk, not a D1 task).

---

## 10. D1 migration plan

One migration file, one transaction. Order:

1. **Schema additions on `poi_engagements`** (columns 2.2.2). All
   nullable, all default NULL — zero impact on existing reads.
2. **Schema additions on `matches`** (columns 2.2.5). Same.
3. **CHECK constraints**:
   - `poi_engagements_operational_state_chk`
   - `poi_engagements_binding_resolution_chk`
   - `poi_engagements_cancelled_reason_chk`
   - `poi_engagements_dispute_required_fields_chk`
   - `poi_engagements_cancelled_required_fields_chk`
4. **Enum extensions**:
   - `ALTER TYPE engagement_status ADD VALUE 'disputed_being_named'`
   - `ALTER TYPE engagement_status ADD VALUE 'cancelled_email_change'`
   *(Postgres requires these to run outside a transaction block — they
   will be in their own migration file run before the others.)*
5. **Replace partial unique index** `uq_poi_engagements_one_current_per_match`
   to add the two new excluded statuses. Use
   `CREATE UNIQUE INDEX CONCURRENTLY` first, then
   `DROP INDEX CONCURRENTLY` on the old index, then rename, to avoid
   any window where the invariant is unenforced.
6. **Default change** on `poi_engagements.expires_at` from 30d to 7d.
7. **`engagement_outreach_logs.entry_type` CHECK swap** — drop and
   recreate with the extended list (2.2.6).
8. **New indexes** (2.2.2 + 2.2.5).

Backwards compatibility: every change is additive or replaces a CHECK
with a strict superset. No column is renamed or dropped. No RLS policy
is altered. Existing reads and writes from Batch C, lifecycle-scheduler,
poi-engagements, the progression guard, and the admin panel continue
to compile and run unchanged.

Backfill: **none**. All new columns are nullable. Existing rows leave
`operational_state` NULL and the admin queue treats NULL as "not yet
classified" (a deliberate distinct UI state).

Rollback: Each step is individually reversible; the enum additions are
not removable (Postgres limitation), so the enum step is the
point-of-no-return. We ship the enum migration only after every other
piece of D1 has passed code review.

Risks:

- *Enum additions are irreversible.* Mitigation: only add the two
  values whose removal would never make sense (a disputed state and a
  cancelled state).
- *Index swap window.* Mitigation: `CONCURRENTLY` + same-transaction
  rename (per Postgres docs).
- *Existing 30-day live rows look longer than the new default.*
  Documented behaviour, not a defect (see §3.2).

---

## 11. Tests required for D1

D1 is schema-only, so the test surface is small and precise. **All tests
must run green before D1 is accepted.**

SQL / migration tests (live against staging DB):

- `supabase/tests/batch_d1_schema_proof.sql` — asserts every new
  column, CHECK, index, default, and enum value exists with the
  expected definition.
- Asserts `poi_engagements_dispute_required_fields_chk` rejects an
  insert where `engagement_status='disputed_being_named'` but
  `disputed_at IS NULL`.
- Asserts `poi_engagements_cancelled_required_fields_chk` rejects an
  insert where `engagement_status='cancelled_email_change'` but
  `replacement_engagement_id IS NULL`.
- Asserts `operational_state` CHECK rejects unknown values.
- Asserts `engagement_outreach_logs.entry_type` CHECK now accepts the
  new values and still accepts every existing value.
- Asserts the new partial unique index permits two rows on the same
  match when one is `cancelled_email_change`.

Vitest unit tests (no behavioural changes — drift guards):

- `src/tests/batch-d1-types-drift.test.ts` — imports
  `src/integrations/supabase/types.ts` and asserts the new columns and
  enum values are present (catches a stale types regeneration).
- `src/tests/engagement-progression-guard-d1-noop.test.ts` — asserts
  the guard still returns its existing codes for every existing
  status; D1 must not change runtime behaviour.

CI guard:

- `scripts/check-edge-function-paths.mjs` already runs in prebuild and
  is unaffected.
- `npm run build` must pass with no TS errors after types
  regeneration.

No edge-function tests change in D1. Edge-function behaviour is D2.

---

## 12. Acceptance criteria

D1 is complete when **all** of the following are true:

1. The migration file applies cleanly to a fresh staging DB and to the
   current live staging DB with no data loss and no enum/check errors.
2. Every column, CHECK, default, index, and enum value listed in §2 is
   verifiable via `psql \d public.poi_engagements`,
   `psql \d public.matches`, and a `pg_enum` query for
   `engagement_status`.
3. `supabase/tests/batch_d1_schema_proof.sql` passes end-to-end.
4. `src/integrations/supabase/types.ts` regenerates cleanly and the two
   drift tests in §11 pass.
5. `npm run build` is green; no behavioural test in Batch B or Batch C
   regresses (full vitest suite green).
6. The progression guard returns *exactly* the same codes for *exactly*
   the same inputs as before D1 (the noop test).
7. No edge function source file has been modified.
8. No UI file has been modified.
9. No fixture or DOCX has been modified or regenerated.
10. Memory entry drafted (not yet committed) describing the D1 schema
    surface for future agents.

When all ten are true, D1 can be marked done and D2 (server-side gates)
can begin against this schema.

---

**Awaiting approval before D1 implementation.**
