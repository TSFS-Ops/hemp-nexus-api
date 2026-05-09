# Batch C — Phase 3: Progression Gates, UI Surfaces, Notifications

**Status:** Phase 2b accepted. Phase 3 is a controlled progression-gate and surface-wiring phase. No fixtures, no client guide, no manual walkthrough until gates and UI are green.

**Invariants carried forward (must not regress):**
- `auth.getUser(token)` used positionally in `match-challenges`.
- `is_admin` called with `{ user_id: ... }` — never `_user_id`.
- Evidence upload path constructed server-side: `match_id/challenge_id/uuid-name`.
- Legacy `disputes` table and journey untouched.
- No rating emission code introduced.
- No forbidden challenge wording (per `src/lib/challenge-outcomes.ts`).

---

## 1. Where `CHALLENGE_OPEN` WILL be wired (the "hold")

A single shared guard `assertNoOpenChallenge(matchId, supabase)` (already in `supabase/functions/_shared/challenge-progression-guard.ts`) is invoked at the **first server-side mutation** of each surface below. Failure returns HTTP `409` with code `CHALLENGE_OPEN` and `{ challenge_id, status, raised_at }`.

| # | Surface | Edge function / RPC | Insertion point |
|---|---------|---------------------|-----------------|
| 1 | POI generation | `poi-transition` (mint path) | Before `atomic_generate_poi_v2` |
| 2 | POI state transitions | `poi-transition` (all non-terminal transitions) | After auth, before RPC dispatch |
| 3 | WaD creation | `wad` (create) | Before insert |
| 4 | WaD attestation | `attestation` | Before attest write |
| 5 | WaD seal | `wad` (seal) and `p3-wad` (seal) | Before seal RPC |
| 6 | Completion request / confirm | `match` (completion routes) | Before state change |
| 7 | Collapse / finality | `collapse` | Before collapse |
| 8 | Match-scoped token burn | `atomic_token_burn` callers (match-scoped only) | Wrapper layer; `purpose IN ('poi_mint','wad_seal','completion')` |
| 9 | Match-scoped settlement actions | settlement edge fns (match-scoped) | Before settlement write |
| 10 | Engagement issuance / renewal | `poi-engagements` (issue, renew) tied to a match | Before issue/renew write |
| 11 | Progression notifications | `notification-dispatch` | Suppress events of type `progression.*` for the match while open |

**Guard semantics (locked):**
- Returns `null` when no row in `match_challenges` for `match_id` is in `{ open, under_review }`.
- Returns `409 CHALLENGE_OPEN` otherwise.
- Platform-admin override only via `platform_admin_break_glass_progress` RPC, which is mandatory-audited and closes the challenge as `admin_override_recorded` in the same transaction.

---

## 2. Where `CHALLENGE_OPEN` must NOT apply (explicit allow-list)

Negative tests required for each:
- Standalone credit purchases (`credits-purchase`, Paystack flow) — never gated.
- Other matches for the same organisation — gate is strictly `match_id`-scoped.
- Read-only viewing of match, POI, WaD, evidence.
- Commenting on the challenge thread.
- Evidence upload to the open challenge (`match-challenges/upload-evidence`).
- Admin review actions on the challenge itself (transition `open → under_review`, record outcome).
- Legacy `disputes` flow — no shared code path, no shared table, no shared trigger.

---

## 3. UI surfaces

All copy uses neutral pause language; no forbidden challenge wording. Strings drawn from `src/lib/challenge-outcomes.ts` (extend with neutral status labels — no new wording invented in components).

- **Match page — Challenge Status Card**
  - Visible on any match with a non-terminal challenge.
  - Shows status (`open`, `under_review`), raised timestamp, raising-side role, neutral summary.
  - Renders inline `Progression paused` banner above progression CTAs.

- **Raise Challenge entry point**
  - Visible only to party `org_admin` and `platform_admin`.
  - Hidden for ordinary `org_member`, unrelated orgs, auditors.
  - Disabled when an open challenge already exists (one-open-per-match invariant, already DB-enforced).

- **Ordinary org_member view**
  - Read-only: status card, comments, evidence list — no raise, no withdraw, no outcome controls.

- **Admin Challenge Queue** (`/admin/challenges`)
  - Lists open + under_review challenges across orgs.
  - Actions: start review, record outcome, break-glass progress (re-auth required).

- **Unrelated org**
  - No challenge controls, no challenge data exposure beyond what RLS already permits.

- **Progression CTAs** (Mint POI, Seal WaD, Confirm Completion, Collapse, Burn for match action)
  - Disabled with neutral "Progression paused — challenge under review" tooltip when guard would 409.

---

## 4. Notification behaviour

Routed through `notification-dispatch`. Each event is templated and subject-clamped per `clampSubject`.

| Event | Recipients | Channel |
|-------|------------|---------|
| `challenge.raised` | Counterparty org_admins, platform admin queue | Email + in-app |
| `challenge.evidence_added` | Both party org_admins, platform admin if `under_review` | In-app, digest email |
| `challenge.comment_added` | Both party org_admins | In-app, digest email |
| `challenge.review_started` | Both party org_admins | Email + in-app |
| `challenge.withdrawn` | Both party org_admins | Email + in-app |
| `challenge.outcome_recorded` | Both party org_admins | Email + in-app |
| `progression.*` for that match | — | **Suppressed** while challenge is `open`/`under_review`; flushed when terminal |

Suppression implemented in `notification-dispatch` by short-circuit on guard check; suppressed notifications are recorded (audit only) and not retried after closure to avoid stale alerts.

---

## 5. Tests required before Phase 3 is "complete"

### 5a. Unit — progression guard
- Returns null when no challenge row.
- Returns null when only terminal challenges (`outcome_recorded`, `withdrawn`, `admin_override_recorded`, `closed_no_action`).
- Returns 409 for `open`.
- Returns 409 for `under_review`.
- Match-id scoping: open challenge on match A does not gate match B.

### 5b. Edge — each blocked surface (positive-block tests)
For each of surfaces 1–10 above: party org_admin attempts the action while a challenge is open → expects `409 CHALLENGE_OPEN`. Same action after `withdrawn` → succeeds.

### 5c. Edge — negative (must NOT block)
- Standalone credit purchase succeeds with open challenge on an unrelated *or related* match.
- POI mint on match B succeeds while match A has open challenge.
- Read of match, POI, WaD, evidence succeeds.
- Comment on challenge thread succeeds.
- Evidence upload to the open challenge succeeds (per Phase 2b matrix).
- Admin can transition challenge state.

### 5d. Notification suppression tests
- Trigger a progression notification while open → not dispatched, audit row written.
- Close challenge → subsequent progression notifications dispatch normally; suppressed ones are not replayed.

### 5e. Wording guard
- Static test: scan `src/components/**/Challenge*` and challenge-related strings for forbidden lexicon (re-uses existing list).

### 5f. Legacy disputes regression
- Snapshot test: legacy `disputes` table row count and a representative row hash unchanged after Phase 3 migration.
- Edge test: existing dispute lifecycle endpoints behave identically (unchanged status codes, unchanged payload shape).

### 5g. Break-glass regression
- Re-run Phase 2b break-glass proof: audit row mandatory; missing audit aborts transaction; challenge closes as `admin_override_recorded`.

---

## Deliverables at Phase 3 close
1. Files changed (edge fns, shared guard wiring, UI components, notification dispatch).
2. Migration(s), if any (expected: none beyond optional indexes).
3. Test results: 5a–5g all green, with counts per category.
4. Live proof script output for at least one representative surface from each of 5b and 5c.
5. Wording-guard report.
6. Legacy disputes hash diff (must be empty).
7. Confirmation: no rating emission code added; no forbidden wording introduced; `getUser(token)` and `is_admin({user_id})` invariants intact.

**Stop after Phase 3.** Fixtures, client guide, and manual walkthrough come only after this matrix is fully green.
