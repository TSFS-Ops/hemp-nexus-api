# Batch C — Developer Verification Appendix

Internal reference. Not for client distribution.

## Key tests passed (Batch C scope)

- `src/tests/batch-c-phase1-schema-rls.test.ts` — schema + RLS proof
  for `match_challenges`, `match_challenge_comments`,
  `match_challenge_evidence`.
- `src/hooks/useChallengePermissions.test.ts` — role gating
  (buyer org admin / seller org admin / platform admin / member).
- `src/components/admin/challenges/AdminChallengePhase3C.test.tsx` —
  Admin Challenge Queue + review drawer flow.
- `src/components/admin/challenges/AdminOverrideStructured.test.tsx` —
  Admin Override Closure structured-fields validation.
- Live SQL proofs:
  - `supabase/tests/batch_c_phase1_live_proof.sql`
  - `supabase/tests/batch_c_phase2_live_proof.sql`
  - `supabase/tests/batch_c_phase3e_fixtures_seed.sql`
- Full suite at freeze: 79/79 Batch C tests pass; 1262 overall passes
  (3 pre-existing unrelated billing/token failures, out of scope).

## Seeded demo fixtures

Six matches are seeded by `batch_c_phase3e_fixtures_seed.sql`,
labelled `Demo · …`:

| Fixture id   | Label                    | Terminal? |
|--------------|--------------------------|-----------|
| `c03e0001`   | Demo · Open challenge    | No        |
| `c03e0002`   | Demo · Under review      | No        |
| `c03e0003`   | Demo · Outcome recorded  | Yes       |
| `c03e0004`   | Demo · Closed no action  | Yes       |
| `c03e0005`   | Demo · Withdrawn         | Yes       |
| `c03e0006`   | Demo · Admin override    | Yes       |

Override fixture (`c03e0006`) carries the four governance fields in
`audit_logs.metadata` under
`action='challenge.break_glass_override'`.

## Invariants preserved

- **No legacy disputes changes.** Tables, RLS, and edge routes for
  legacy disputes are untouched. `src/tests/uat/journey-3-disputes.test.ts`
  remains the legacy reference.
- **No rating emission.** No code in
  `supabase/functions/match-challenges/` or
  `src/hooks/useAdminChallengeMutations.ts` writes to ratings tables
  or emits rating signals. Verified by terminology guard.
- **No new migrations after the approved adjustment.** The last
  Batch C migration is the structured-override governance migration
  (`supabase/migrations/20260509171204_*.sql`). No further schema
  changes have been made.
- **No server work beyond approved scope.** Edge function changes
  since freeze are limited to a non-functional comment reword in
  `supabase/functions/match-challenges/index.ts` (rating-guard test
  false positive).
- **Challenge progression gate remains Open / Under review only.**
  The pause is asserted only while
  `status IN ('open','under_review')`. Terminal states
  (`outcome_recorded`, `closed_no_action`, `withdrawn`, plus
  `admin_override_recorded` outcome on a closed status) lift the
  pause. No new gates added.
- **Admin Override Closure is terminal, not a live bypass.** The
  override closes the Challenge and writes the audit row; it does not
  advance the match state machine.

## Storage of structured override fields

`audit_logs` row, `action = 'challenge.break_glass_override'`,
`entity_type = 'match_challenge'`, `entity_id = <challenge_id>`,
`metadata` JSONB with keys:

```
{
  "match_id": "...",
  "reason_category": "...",
  "internal_approval_reference": "...",
  "regulator_reference": "..." | "Not applicable",
  "written_reason": "...",
  "reason_length": <int>,
  "outcome_code": "admin_override_recorded"
}
```

Read surface: `src/hooks/useChallengeOverrideAudit.ts` (RLS-gated
read of `audit_logs`).

## Files of record

- `src/components/admin/AdminChallengeQueuePanel.tsx`
- `src/components/admin/challenges/AdminChallengeReviewDrawer.tsx`
- `src/components/admin/challenges/AdminOverrideDialog.tsx`
- `src/hooks/useAdminChallengeMutations.ts`
- `src/hooks/useChallengeOverrideAudit.ts`
- `src/hooks/useMatchChallenge.ts`
- `src/hooks/useChallengeComments.ts`
- `src/hooks/useChallengeEvidence.ts`
- `src/hooks/useChallengePermissions.ts`
- `src/lib/challenge-outcomes.ts`
- `src/lib/challenge-override-categories.ts`
- `supabase/functions/match-challenges/index.ts`
