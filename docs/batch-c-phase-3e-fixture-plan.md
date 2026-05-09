# Batch C — Phase 3E Fixture Plan

Status: Plan only. Fixtures are seeded by the script
`supabase/tests/batch_c_phase3e_fixtures_seed.sql` (fixture-only, NOT a
migration). The script is idempotent — re-running it is safe.

No production logic, edge functions, migrations, RLS policies, outcome
labels, ratings, notifications, or legacy disputes are touched.

## Scope

Six demo matches, each pre-seeded with one Match Challenge in a specific
state, so reviewers can open the existing UI and observe the workflow
without authoring anything by hand.

| ID | Match label                | Challenge status     | Outcome                     | Override |
|----|----------------------------|----------------------|-----------------------------|----------|
| F-C-OPEN              | Demo · Open challenge        | `open`              | —                          | false |
| F-C-UNDER-REVIEW      | Demo · Under review          | `under_review`      | —                          | false |
| F-C-OUTCOME-RECORDED  | Demo · Outcome recorded      | `outcome_recorded`  | `corrected_and_proceed`     | false |
| F-C-CLOSED-NO-ACTION  | Demo · Closed no action      | `closed_no_action`  | `no_action_required`        | false |
| F-C-WITHDRAWN         | Demo · Withdrawn             | `withdrawn`         | `withdrawn_by_raiser`       | false |
| F-C-ADMIN-OVERRIDE    | Demo · Admin override        | `outcome_recorded`  | `admin_override_recorded`   | true  |

All six matches share the same demo commercial frame:

- Buyer org: **Batch A Counterparty Ltd** (existing test org)
- Seller org: **New Organisation** (existing test org `uat-billing-…`)
- Commodity: **Copper cathodes**
- Volume: **500 MT**
- Price: **USD 8,200 / MT**
- Incoterms: **CIF Rotterdam**

The buyer/seller assignment is reversed on a sub-set so reviewers see both
`buyer_org_admin` and `seller_org_admin` raise paths.

## Expected reviewer experience per fixture

### F-C-OPEN
- Match page renders `ChallengeStatusCard` (status: Open).
- Progression Paused Banner visible.
- Any progression action returns canonical `409 CHALLENGE_OPEN`.
- Buyer / seller org admins and platform admin can post comments and
  upload evidence (≤ 25 MB, SHA-256 fingerprint shown).
- Ordinary org members render the card and the comment thread but see
  no composer / uploader (read-only).

### F-C-UNDER-REVIEW
- Card status: Under review.
- Progression remains paused (`CHALLENGE_OPEN` still applies).
- Admin Challenge Queue lists the row under "Under review".
- Platform admin can record an outcome, close with no action, or apply
  Admin override closure.

### F-C-OUTCOME-RECORDED
- Card shows terminal outcome `Corrected — trade may proceed`.
- Progression Paused Banner is **absent**.
- `CHALLENGE_OPEN` no longer fires; other unrelated progression gates
  may still apply (those are out of 3E scope).

### F-C-CLOSED-NO-ACTION
- Card status: Closed — no action.
- No progression pause.

### F-C-WITHDRAWN
- Card status: Withdrawn.
- No progression pause.
- Outcome reads "Challenge withdrawn".

### F-C-ADMIN-OVERRIDE
- Card status: Outcome recorded · Admin override recorded.
- `break_glass_override_used = true` on the row.
- An accompanying audit record is required (see seed script — inserted
  via existing audit table; no new function).

## Demo account matrix

These are existing safe accounts. No new auth users are created.

| Email                                            | Role                         | Organisation                   | Should see                                                              | Should NOT do                                            |
|--------------------------------------------------|------------------------------|--------------------------------|-------------------------------------------------------------------------|----------------------------------------------------------|
| `trade@izenzo.co.za`                             | Buyer/Seller org admin       | Batch A Counterparty Ltd       | All six demo matches; can raise/comment/upload on relevant ones         | Cannot record outcomes; cannot apply admin override      |
| `test2@izenzo.co.za`                             | Ordinary org member          | Batch A Counterparty Ltd       | Same six matches (read-only); challenge cards + comment thread visible  | Cannot raise, comment, or upload                         |
| `uat-billing-1777478536038@test.izenzo.co.za`    | Counterparty org admin       | New Organisation               | Same six matches from the counterparty side                             | Same as above for own role                               |
| `james@izenzo.co.za`                             | Platform admin               | Pending verification (legacy)  | Admin Challenge Queue for all six; can record outcomes / override       | Should not act outside review remit                      |

Unrelated org users (any account whose `org_id` is not one of the two
above) must see **no** challenge rows on these matches — confirms RLS.

## Seeding

1. Open `supabase/tests/batch_c_phase3e_fixtures_seed.sql`.
2. Review the header (lists every UUID it touches).
3. Execute against the target environment as a privileged role.
4. The script is wrapped in a transaction and is idempotent
   (`ON CONFLICT DO NOTHING` for matches; deterministic challenge ids).

## Out of scope (3E)

- Evidence download, evidence delete, comment edit/delete.
- Notification UI changes, rating impact, legacy disputes, new server
  gates, schema migrations, edge function changes.
- Polishing demo data beyond what is needed to render the six states.
