# P-4 Governance Record — Closeout Proof Pack

> **Scope:** documentation and proof packaging only. No new product features.
> **Status:** Repo-pinned evidence for everything claimed below. Live production
> readiness still requires running the release gate against the live tier
> (see `docs/launch-runbook.md`).

---

## 1. Governance Record UI

HQ-only Governance Records surface, mounted under `/hq` and wrapped by
`RequireAuth role="platform_admin"`; underlying tables additionally restrict
reads to `platform_admin` / `auditor` via RLS.

| Capability | Component / file | Status |
|---|---|---|
| HQ-only Governance Records page | `src/components/admin/governance/GovernanceRecordsPanel.tsx` (mounted in `/hq`) | Complete |
| Search / filter (free text, date range) | `GovernanceRecordsPanel` list mode | Complete |
| Top summary (status, POI state, demo flag, parties) | List row + `GovernanceRecordDetail` header | Complete |
| Merged timeline (matches + POI + engagements + trade requests) | `GovernanceRecordDetail` anchor resolver | Complete |
| POI timeline fix (chronological, no duplicates) | `useGovernanceEvents` (`src/lib/governance/use-governance-events.ts`) | Complete |
| Blocked-action highlight | Timeline row variant for `*_blocked` / `*_denied` events | Complete |
| Demo / test label | `Demo` badge on list row + detail header | Complete |
| Event detail drawer | `GovernanceRecordDetail` event drawer | Complete |
| Evidence / document status visibility | Surfaced where available via existing match evidence panels | Complete (read-only) |
| Non-HQ access blocked | `/hq` route guard + RLS on `event_store`, `audit_logs`, `admin_audit_logs` | Complete |

---

## 2. Canonical Governance Record writer

- `event_store` is the **canonical source** for new enterprise governance
  events (admin HQ decisions, atomic commercial primitives, legal hold,
  collapse, dispute open, WaD issuance).
- Write paths are **backend / `SECURITY DEFINER` only**. `EXECUTE` on every
  governance-writing RPC is locked to `service_role` (see
  `mem://security/secdef-stage-d1-lockdown`).
- Coverage on every canonical write: hash-chain link, idempotency key (5-minute
  window for admin HQ decisions, per-request for atomic primitives),
  `policy_version`, `posture_snapshot`, real UUID `aggregate_id`,
  `source_function`, `request_id`, `actor_user_id`, `actor_role`.
- Legacy audit sources (`audit_logs`, `admin_audit_logs`) remain **readable**
  for historical reconciliation but are **not rewritten** by new code paths
  except as best-effort mirrors explicitly called out in §7 caveats.

---

## 3. Manual HQ notes and corrections

- Manual HQ note creation: `admin-hq-note` → `event_store` row with
  `event_type='admin.hq_note_recorded'`, anchored to a real aggregate
  (match / poi / engagement / trade_request).
- Correction event creation: `admin-counterparty-corrections` and
  `admin-match-corrections` write `admin.hq_decision_recorded` events with
  `correction_of=<original_event_id>` in metadata.
- **Original event preserved.** Corrections never mutate or delete the
  original `event_store` row. The store is append-only.
- "Corrected by later HQ note" behaviour: the detail drawer renders an
  inline banner on any event whose `id` appears in a later event's
  `correction_of` field.
- AAL2 required for every correction endpoint via `assertAal2` (covered by
  `scripts/check-admin-aal2-coverage.mjs`).

---

## 4. Reason-code normalisation

- Current status: **WARN-only**. Reason codes are normalised on write and
  surfaced on read, but mismatched legacy codes do not block the action.
- Legacy / system / payment reason codes are normalised through a single
  table in `src/lib/policy/dec-007-pay-009-audit.ts` and equivalents.
- **Original reason preserved** in `metadata.reason_raw` alongside the
  normalised `reason_code`.
- Strict BLOCK mode is **not enabled**. Flipping WARN → BLOCK is explicitly
  deferred and gated on client sign-off (see §8).

---

## 5. Waiver / bypass lifecycle

- HQ grant / renew path: `admin-test-mode-bypass` writes to
  `admin_settings.test_mode_bypass` with audited `test_mode.bypass_used`
  events (see `mem://features/test-mode-compliance-bypass`).
- Expiry scheduler: `lifecycle-scheduler` cron sweeps expired bypass rows
  and emits `test_mode.bypass_expired` governance events.
- UI visibility: global `TestModeBanner` mounted in `App.tsx`; HQ panel
  surfaces current bypass scope, grantor, expiry.
- **Enforcement caveat:** waivers short-circuit IDV / sanctions / KYB /
  UBO / ATB checks for affected orgs. Wiring waivers into **POI / WaD /
  execution / finality progression gates** is **not yet proven** beyond
  the existing test-mode bypass paths and is **deferred** (see §8).
- Production safety: `is_test_mode_bypass_enabled` is refused in production
  via `is_production_environment` short-circuit.

---

## 6. MFA / AAL2 coverage

- Admin AAL2 drift guard: `scripts/check-admin-aal2-coverage.mjs` runs in
  prebuild and fails the build if any admin endpoint in the registry is
  missing `assertAal2`.
- Sensitive endpoint coverage: all 18 admin HQ endpoints listed in §7 call
  `assertAal2` before any business mutation.
- Known caveats: AAL2 is enforced **at the edge function boundary**. Direct
  service-role RPC calls bypass AAL2 by design (intended for cron / internal
  scheduler use only); `EXECUTE` is locked to `service_role` so this is not
  reachable from authenticated/anon contexts.

---

## 7. Admin HQ atomicity — final position

**18 of 18 sensitive admin endpoints are atomic on the canonical Governance
Record write path with live DB rollback proof.**

If the business action fails, no Governance Record event is written. If the
Governance Record event cannot be written, the business action rolls back.

| Group | Endpoints | Atomic RPC | Wiring test | Live proof |
|---|---|---|---|---|
| F1 — credit grants | `admin-credit-org` | `atomic_token_burn` family | `admin-credit-org-wiring.test.ts` | `batch_f1_atomic_credit_proof.sql` |
| F2 — refunds | `admin-refund-approve`, `admin-refund-decline` | `atomic_refund_decision_*` | `admin-refund-wiring.test.ts` | `batch_f2_atomic_refund_proof.sql` |
| F3 — payment disputes | `admin-payment-dispute-record`, `…-resolve-won`, `…-resolve-lost` | `atomic_payment_dispute_*` | `admin-payment-dispute-wiring.test.ts` | `batch_f3_atomic_payment_dispute_proof.sql` |
| F4 — billing / compliance / residency holds | 6 hold endpoints | `atomic_hold_*_with_governance` | `admin-f4-hold-wiring.test.ts` | `batch_f4_atomic_hold_proof.sql` |
| F5 — trade-request exceptions | `admin-trade-request-exception-hold-release`, `…-archive-override` | `atomic_trade_request_exception_*` | `admin-f5-trade-request-exception-wiring.test.ts` | `batch_f5_atomic_trade_request_exception_proof.sql` |
| F6 — corrections + manual overrides | `admin-counterparty-corrections`, `admin-match-corrections`, `admin-manual-overrides` | `admin_*_with_governance` | `admin-f6-corrections-wiring.test.ts`, `admin-f7-manual-overrides-wiring.test.ts` | `batch_f6_atomic_corrections_proof.sql`, `batch_f7_atomic_manual_overrides_proof.sql` |
| F7 — legal hold | `admin-legal-hold` (apply + release) | `atomic_legal_hold_apply`, `atomic_legal_hold_release` | `admin-f8-legal-hold-wiring.test.ts`, `admin-legal-hold-wiring.test.ts`, `legal-hold-audit-names-guard.test.ts` | `batch_f8_atomic_legal_hold_proof.sql` |

**Caveats:**
- **Legal-hold legacy mirror rows** (`audit_logs`, `admin_audit_logs`) are
  best-effort only and are written outside the atomic RPC. The canonical
  `legal_hold.applied` / `legal_hold.released` event in `event_store` is
  atomic; legacy mirrors are not.
- **Manual-override external side effects** (screening rerun, evidence
  regen) run **before** the atomic RPC and are best-effort. Failure of a
  side effect is recorded but does not roll back the override decision.

---

## 8. Deferred / excluded items

| Item | Status |
|---|---|
| Basic Memory Record build | **Deferred** |
| Governed-documentation foundation | **Deferred** unless separately approved |
| Full AI-served documentation layer | **Deferred** |
| Counterparty-visible Governance Record | **Deferred** (HQ-only in Phase 1) |
| PDF evidence pack | **Deferred** |
| External export of Governance Records | **Deferred** — existing internal CSV exports (audited via `auditedDownloadCSV`) remain in scope; no Governance-Record-specific export |
| Raw provider payload viewer | **Excluded** |
| SIEM / Splunk / Datadog export | **Excluded** |
| Payment webhook atomicity | **Out of scope** — sequential by design (provider retries + best-effort canonical emission with risk-item escalation) |
| Waiver / bypass enforcement wired into POI / WaD / execution / finality progression gates | **Deferred** beyond existing test-mode bypass paths |
| Reason-code WARN → BLOCK flip | **Deferred** |
| Taxonomy WARN → BLOCK flip | **Deferred** |

---

## 9. Tests / proof commands run

### Wiring tests (Vitest)

```bash
npm run test:regression
# plus targeted:
bunx vitest run src/tests/admin-credit-org-wiring.test.ts
bunx vitest run src/tests/admin-refund-wiring.test.ts
bunx vitest run src/tests/admin-payment-dispute-wiring.test.ts
bunx vitest run src/tests/admin-f4-hold-wiring.test.ts
bunx vitest run src/tests/admin-f5-trade-request-exception-wiring.test.ts
bunx vitest run src/tests/admin-f6-corrections-wiring.test.ts
bunx vitest run src/tests/admin-f7-manual-overrides-wiring.test.ts
bunx vitest run src/tests/admin-f8-legal-hold-wiring.test.ts \
                 src/tests/admin-legal-hold-wiring.test.ts \
                 src/tests/legal-hold-audit-names-guard.test.ts
```

All wiring tests **PASS** at the current commit.

### Live DB rollback proofs (SQL, all wrapped in `BEGIN … ROLLBACK`)

```bash
export GOVERNANCE_ROLLBACK_DATABASE_URL='postgres://…staging…'

# Per-batch atomic proofs:
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f1_atomic_credit_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f2_atomic_refund_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f3_atomic_payment_dispute_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f4_atomic_hold_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f5_atomic_trade_request_exception_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f6_atomic_corrections_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f7_atomic_manual_overrides_proof.sql
psql "$GOVERNANCE_ROLLBACK_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/batch_f8_atomic_legal_hold_proof.sql

# Cross-family rollback proof (6 atomic families):
npm run governance:rollback-proof
# → supabase/tests/governance_rollback_proof.sql
```

**All proofs:** `ALL ASSERTIONS PASSED` → `ROLLBACK`. Zero residue.

### Proof caveats

- All SQL proofs run inside `BEGIN; … ROLLBACK;`. They prove the
  transactional contract of the RPC; they do not assert anything about
  the live state of the production database.
- Wiring tests prove that edge functions invoke the atomic RPC and have
  no remaining split-commit `recordAdminHqDecision` calls on the happy
  path. They do not assert live deployment.
- CI gate `governance-rollback-proof` is wired in `.github/workflows/ci.yml`
  but **only runs when the repository secret
  `GOVERNANCE_ROLLBACK_DATABASE_URL` is configured**. Until then it remains
  a documented manual release gate.

---

## 10. Safe claim language

See `docs/p4-governance-record-safe-claim-language.md` for approved client-
facing wording and the explicit do-not-claim list.
