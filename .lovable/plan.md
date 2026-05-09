# Batch C — Phase 3: Progression Gates, UI Surfaces, Notifications (Revised)

**Status:** Phase 2b accepted. Phase 3 split into sub-phases with hard stop points. Implementation begins with **Phase 3A only**; 3B and 3C require explicit approval after 3A reports green.

**Invariants carried forward (must not regress):**

- `auth.getUser(token)` used positionally in `match-challenges`.
- `is_admin` called with `{ user_id: ... }` — never `_user_id`.
- Evidence upload path constructed server-side: `match_id/challenge_id/uuid-name`.
- Legacy `disputes` table and journey untouched.
- No rating emission code introduced.
- No forbidden challenge wording (per `src/lib/challenge-outcomes.ts`).

---

## Sub-phase split (hard stops)

- **Phase 3A — Server-side gates + notification suppression.** Stop and report.
- **Phase 3B — Minimal UI: challenge status card, raise entry point, "Progression paused" banner.** Stop and report.
- **Phase 3C — Admin challenge queue + outcome controls.** Stop and report.

Each sub-phase ships its own test matrix. No sub-phase begins without explicit approval of the previous report.

---

## 1. Where `CHALLENGE_OPEN` WILL be wired (Phase 3A scope)

A single shared guard `assertNoOpenChallenge(matchId, supabase)` (already in `supabase/functions/_shared/challenge-progression-guard.ts`) is invoked at the **first server-side mutation** of each surface below. Failure returns HTTP `409` with code `CHALLENGE_OPEN` and `{ challenge_id, status, raised_at }`.


| #   | Surface                         | Edge function / RPC                              | Insertion point                                                  |
| --- | ------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| 1   | POI generation                  | `poi-transition` (mint path)                     | Before `atomic_generate_poi_v2`                                  |
| 2   | POI state transitions           | `poi-transition` (all non-terminal transitions)  | After auth, before RPC dispatch                                  |
| 3   | WaD creation                    | `wad` (create)                                   | Before insert                                                    |
| 4   | WaD attestation                 | `attestation`                                    | Before attest write                                              |
| 5   | WaD seal                        | `wad` (seal) and `p3-wad` (seal)                 | Before seal RPC                                                  |
| 6   | Completion request / confirm    | `match` (completion routes)                      | Before state change                                              |
| 7   | Collapse / finality             | `collapse`                                       | Before collapse                                                  |
| 8   | Match-scoped token burn         | `atomic_token_burn` callers (match-scoped only)  | Wrapper layer; `purpose IN ('poi_mint','wad_seal','completion')` |
| 9   | Match-scoped settlement actions | settlement edge fns (match-scoped)               | Before settlement write                                          |
| 10  | Engagement issuance / renewal   | `poi-engagements` (issue, renew) tied to a match | Before issue/renew write                                         |
| 11  | Progression notifications       | `notification-dispatch`                          | Suppress events of type `progression.*` for the match while open |


**Guard semantics (locked):**

- Returns `null` when no row in `match_challenges` for `match_id` is in `{ open, under_review }`.
- Returns `409 CHALLENGE_OPEN` otherwise.
- **Break-glass is not a bypass and not a live override.** It is the `platform_admin_break_glass_progress` RPC, which **closes** the challenge with terminal outcome `admin_override_recorded` in the same transaction as a mandatory `audit_logs` insert (transaction aborts if the audit insert fails). Only after that closure can progression proceed via the normal guard path. Required inputs: caller is `platform_admin`, reason ≥ 60 chars, mandatory audit. **No re-auth requirement is introduced in Phase 3** — that would be a separate, scoped piece of work.

---

## 2. Where `CHALLENGE_OPEN` must NOT apply (explicit allow-list)

Negative tests required for each:

- Standalone credit purchases (`credits-purchase`, Paystack flow) — never gated.
- Other matches for the same organisation — gate is strictly `match_id`-scoped.
- Read-only viewing of match, POI, WaD, evidence.
- Commenting on the challenge thread.
- Evidence upload to the open challenge (`match-challenges/upload-evidence`).
- Admin review actions on the challenge itself (transition `open → under_review`, record outcome, break-glass closure).
- Legacy `disputes` flow — no shared code path, no shared table, no shared trigger.

---

## 3. UI surfaces (Phase 3B + 3C — not implemented in 3A)

All copy uses neutral pause language; no forbidden challenge wording. Strings drawn from `src/lib/challenge-outcomes.ts`.

**Phase 3B (minimal):**

- **Match page — Challenge Status Card**: visible on any match with a non-terminal challenge; shows status, raised timestamp, raising-side role, neutral summary.
- **"Progression paused" banner**: rendered above progression CTAs on the match page when the guard would return `409`.
- **Raise Challenge entry point**: visible only to party `org_admin` and `platform_admin`; hidden for ordinary `org_member`, unrelated orgs, auditors; disabled when an open challenge already exists.
- **Ordinary org_member view**: read-only — status card, comments, evidence list — no raise/withdraw/outcome controls.

**Phase 3C (admin):**

- **Admin Challenge Queue** (`/admin/challenges`): lists `open` + `under_review` challenges across orgs; actions: start review, record outcome, break-glass closure (platform_admin + 60-char reason; mandatory audit; **no re-auth**).
- **Unrelated org**: no challenge controls, no challenge data exposure beyond what RLS already permits.
- **Progression CTAs**: disabled with neutral "Progression paused — challenge under review" tooltip when guard would 409.

---

## 4. Notification behaviour (Phase 3A scope)

Routed through `notification-dispatch`. Each event is templated and subject-clamped per `clampSubject`.


| Event                          | Recipients                                              | Channel                                                   |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------- |
| `challenge.raised`             | Counterparty org_admins, platform admin queue           | Email + in-app                                            |
| `challenge.evidence_added`     | Both party org_admins, platform admin if `under_review` | In-app, digest email                                      |
| `challenge.comment_added`      | Both party org_admins                                   | In-app, digest email                                      |
| `challenge.review_started`     | Both party org_admins                                   | Email + in-app                                            |
| `challenge.withdrawn`          | Both party org_admins                                   | Email + in-app                                            |
| `challenge.outcome_recorded`   | Both party org_admins                                   | Email + in-app                                            |
| `progression.*` for that match | —                                                       | **Suppressed** while challenge is `open` / `under_review` |


**Suppression rule (precise):**

- While a challenge is `open` or `under_review`, any `progression.*` notification scoped to that `match_id` is suppressed at dispatch time.
- Each suppression writes a stable audit row: action `challenge.progression_notification_suppressed`, metadata `{ match_id, challenge_id, notification_type, intended_recipient_group, suppressed_at }`.
- **Suppressed progression notifications are not replayed after closure.** Fresh `progression.*` notifications generated *after* the challenge reaches a terminal state may dispatch normally.

---

## 5. Tests required

### Phase 3A — server gates + suppression

**5a. Unit — progression guard**

- Returns null when no challenge row.
- Returns null when only terminal challenges (`outcome_recorded`, `withdrawn`, `admin_override_recorded`, `closed_no_action`).
- Returns 409 for `open`.
- Returns 409 for `under_review`.
- Match-id scoping: open challenge on match A does not gate match B.

**5b. Edge — each blocked surface (positive-block tests)**
For each of surfaces 1–10: party org_admin attempts the action while a challenge is open → expects `409 CHALLENGE_OPEN`.

After the challenge reaches a terminal state, each test re-runs and asserts only that the failure is **no longer `CHALLENGE_OPEN**` — the action may still fail for pre-existing guards (credits, missing POI prerequisites, engagement state, match state, etc.). Test code asserts `response.status !== 409 || body.code !== 'CHALLENGE_OPEN'`.

**5c. Edge — negative (must NOT block)**

- Standalone credit purchase succeeds with open challenge on a related or unrelated match.
- POI mint on match B succeeds while match A has open challenge.
- Read of match, POI, WaD, evidence succeeds.
- Comment on challenge thread succeeds.
- Evidence upload to the open challenge succeeds (per Phase 2b matrix).
- Admin can transition challenge state and execute break-glass closure.

**5d. Notification suppression tests**

- Trigger a `progression.*` notification while open → not dispatched; `challenge.progression_notification_suppressed` audit row written with full metadata.
- Close challenge (any terminal outcome) → newly generated `progression.*` notifications dispatch normally; previously suppressed notifications are **not** replayed.

**5e. Wording guard**

- Static test: scan challenge-related strings for forbidden lexicon (re-uses existing list).

**5f. Legacy disputes regression (revised — no row-hash dependency)**

- Static check: Phase 3 migrations contain no DDL/DML against `public.disputes` (grep all Phase 3 SQL files).
- Static check: no Phase 3 code edit touches the legacy disputes edge functions or client paths.
- Behavioural: existing `journey-3-disputes.test.ts` (and any disputes endpoint contract tests) still pass unchanged with byte-identical payload shape.

**5g. Break-glass regression**

- Re-run Phase 2b break-glass proof: missing audit aborts the transaction; on success the challenge row is `admin_override_recorded` (terminal) and the next progression call on the same match passes the guard.
- Negative: `platform_admin` with reason < 60 chars rejected.
- Negative: non-`platform_admin` rejected.

### Phase 3B (deferred)

- Snapshot/role-visibility tests for raise button, status card, paused banner.
- RTL test: ordinary org_member sees no raise/withdraw/outcome affordances.

### Phase 3C (deferred)

- Admin queue listing scoped to non-terminal challenges.
- Outcome control + break-glass form validation tests.

---

## Deliverables at Phase 3A close

1. Files changed (edge fns, shared guard wiring, notification dispatch).
2. Migration(s), if any (expected: none beyond optional indexes and the `challenge.progression_notification_suppressed` audit action being recognised).
3. Test results: 5a–5g all green, with counts per category.
4. Live proof script output for at least one representative surface from each of 5b and 5c.
5. Wording-guard report.
6. Legacy disputes static + behavioural proof (no row-hash).
7. Confirmation: no rating emission code added; no forbidden wording introduced; `getUser(token)` and `is_admin({user_id})` invariants intact; break-glass is closure-only, no re-auth introduced.

**Stop after Phase 3A.** 3B and 3C require explicit approval.  
  
This revised matrix is now much cleaner. I would approve **Phase 3A only**.

The important corrections are now in place:

- Break-glass is correctly framed as **terminal closure**, not a live bypass.
- No re-auth is being quietly introduced.
- Suppressed notifications are **not replayed**, which is the safer rule.
- “After terminal state” tests now correctly check only that the error is no longer `CHALLENGE_OPEN`.
- Legacy disputes regression is no longer tied to fragile row hashes.
- UI is deferred to 3B/3C, so 3A can stay focused on server gates and notification suppression.

The only tightening I would still request before code starts is this:

1. **Guard response shape must be one canonical shape everywhere.**  
Pick one and pin it:
  &nbsp;
  ```json
  {
    "error": "CHALLENGE_OPEN",
    "code": "CHALLENGE_OPEN",
    "message": "...",
    "challenge_id": "...",
    "challenge_status": "open",
    "raised_at": "..."
  }
  ```
  Do not let some functions return `error`, others `code`, others `challengeId`.
2. **Notification suppression must not send emails, but must not silently swallow failures to audit.**  
If suppression audit fails, the dispatcher should fail closed for that notification event. Otherwise you can lose the only trace that a notification was intentionally suppressed.
3. **Phase 3A must not introduce UI-visible copy except API messages.**  
This keeps wording scope tight. Any banners/cards/buttons wait for 3B.

I would send Lovable this:

```text
Approved for Phase 3A only.

Proceed with server-side progression gates and progression-notification suppression only. Do not start Phase 3B or 3C. No UI, no admin queue, no fixtures, no client guide.

Before implementation, lock these three final details:

1. Use one canonical CHALLENGE_OPEN response shape everywhere:
{
  error: "CHALLENGE_OPEN",
  code: "CHALLENGE_OPEN",
  message: "Progression is paused because an open challenge exists on this match.",
  challenge_id,
  challenge_status,
  raised_at
}

2. Notification suppression audit is mandatory. If a `progression.*` notification is suppressed because a challenge is open, write `audit_logs.action = "challenge.progression_notification_suppressed"` with metadata `{ match_id, challenge_id, notification_type, intended_recipient_group, suppressed_at }`. Do not dispatch the notification. Do not replay it after closure. If the audit insert fails, fail closed for that notification event.

3. Phase 3A must introduce no UI-visible surfaces except neutral API error messages. Challenge status cards, raise challenge buttons, paused banners, and admin queue are Phase 3B/3C only.

Then implement Phase 3A:
- wire `assertNoOpenChallenge` into the listed server-side match-scoped mutation surfaces only;
- leave standalone credit purchases and unrelated matches ungated;
- suppress only `progression.*` notifications scoped to the challenged match;
- keep legacy `disputes` untouched;
- keep rating emission absent;
- preserve `auth.getUser(token)` and `is_admin({ user_id })`.

At close, report the full 5a–5g test matrix, including live proof for at least one blocked surface and one allow-listed surface, notification suppression audit proof, wording guard, legacy disputes proof, and confirmation that no UI/fixtures/client guide were created.

Stop after Phase 3A.
```

After that, yes: let them proceed.