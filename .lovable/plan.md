# Facilitation Phase 2 — Revised Plan (no code yet)

Revisions in response to feedback:

1. DNC source of truth is now a dedicated, enterprise-grade table — `ai_do_not_contact_rules` is **not** reused.
2. Compliance escalation authority is now explicitly split: `platform_admin` escalates and observes; `compliance_analyst` resolves. `platform_admin` does **not** resolve compliance escalations.

Everything else from the prior plan stands; deltas only are called out below.

---

## 1. Do-not-contact source of truth (revised)

**Decision:** `ai_do_not_contact_rules` is AI-outreach-experimental and will **not** govern real counterparty outreach. Phase 2 introduces a dedicated, enterprise-grade DNC register scoped to facilitation:

### 1.1 New table: `facilitation_do_not_contact_rules`

Columns:

- `id uuid pk`
- `rule_type text` — enum check: `email` | `domain` | `org_name`
- `value_raw text` — original input
- `value_norm text` — lowercased / trimmed / punycode-normalised; UNIQUE on (`rule_type`, `value_norm`) WHERE `status='active'`
- `match_severity text` — enum check: `block` (email, domain) | `warn` (org_name). Resolver derives default but column is the SSOT.
- `reason text NOT NULL`
- `source text` — `compliance` | `legal` | `requester` | `sanctions_feed` | `manual_admin`
- `status text` — `active` | `revoked`
- `created_by uuid` references `auth.users(id)` ON DELETE SET NULL
- `created_at timestamptz default now()`
- `revoked_by uuid`, `revoked_at timestamptz`, `revoked_reason text`
- `expires_at timestamptz null` (optional)

### 1.2 Access model

- `GRANT SELECT, INSERT, UPDATE ON public.facilitation_do_not_contact_rules TO authenticated;` then RLS:
  - `SELECT`: `platform_admin` OR `compliance_analyst`.
  - `INSERT`: `platform_admin` OR `compliance_analyst`.
  - `UPDATE` (revoke only — triggers enforce immutability of all other columns): `compliance_analyst` only. `platform_admin` cannot revoke.
  - `DELETE`: nobody. Register is append-only; revocation is a status flip.
- `GRANT ALL ... TO service_role` for the send edge function.

### 1.3 Audit trail

Every insert and every revoke writes an `event_store` row:

- `facilitation.dnc.rule_added`
- `facilitation.dnc.rule_revoked`

Append-only, included in the Phase 2 audit-name prebuild guard.

### 1.4 Resolver behaviour

`resolveOutreachGate(candidate)` consults this table only (not `ai_do_not_contact_rules`):

- exact `value_norm` match on `email` → `block`
- exact `value_norm` match on `domain` (of candidate email) → `block`
- normalised match on `org_name` → `warn`
- expired (`expires_at < now()`) or `status='revoked'` rows are ignored

Server-enforced in `facilitation-outreach-send`. UI is advisory only.

### 1.5 Management UI

- HQ → Facilitation → **"Do Not Contact"** sub-panel.
- `platform_admin` and `compliance_analyst` can add rules.
- Only `compliance_analyst` sees the **Revoke** action.
- No bulk import / CSV — single-rule entry only in Phase 2.

### 1.6 Negative confirmation

`ai_do_not_contact_rules` remains untouched by Phase 2. A new prebuild guard `check-facilitation-phase2-no-ai-dnc-coupling.mjs` fails the build if any file under `supabase/functions/facilitation-*` or `src/pages/hq/facilitation/**` references `ai_do_not_contact_rules`.

---

## 2. Compliance escalation authority (revised)

### 2.1 Roles and powers


| Action                                    | `platform_admin` | `compliance_analyst` |
| ----------------------------------------- | ---------------- | ------------------ |
| Escalate a candidate / case to compliance | ✅                | ✅                  |
| View escalation state and notes           | ✅                | ✅                  |
| Add an internal escalation note           | ✅                | ✅                  |
| **Resolve** the compliance escalation     | ❌                | ✅                  |
| Re-open a resolved escalation             | ❌                | ✅                  |
| Send outreach while escalation is open    | ❌                | ❌                  |


`platform_admin` cannot resolve. This is enforced server-side in `facilitation-outreach-escalate` and in the new `facilitation-outreach-escalation-resolve` edge function via role check on the JWT, not just UI hiding.

### 2.2 Override carve-out

The platform governance model does **not** currently grant `platform_admin` authority to override compliance decisions (no such override exists for `compliance_cases` today). Therefore Phase 2 introduces **no** override path. If the user later wants a break-glass override, it is a separate, audited governance change — not Phase 2 scope.

### 2.3 Audit trail

- `facilitation.outreach.escalated_to_compliance` — actor must be `platform_admin` or `compliance_analyst`
- `facilitation.outreach.escalation_resolved` — actor MUST be `compliance_analyst`; any other actor recorded against this event is a server bug and rejected by a DB CHECK on `event_store.metadata->>actor_role`
- `facilitation.outreach.escalation_reopened` — `compliance_analyst` only

All three are added to the Phase 2 audit-name prebuild guard.

### 2.4 Compliance case linkage

- Escalation creates a `compliance_cases` row with `source='facilitation_outreach'` and `facilitation_case_id` reference.
- The `compliance_cases` row's resolver policies are reused as-is — no new compliance RLS surface introduced.
- Closing the underlying `compliance_cases` row is what unblocks further outreach on the candidate. The send edge function checks this before every send.

---

## 3. Everything else (carried forward from prior plan, unchanged)

The following items were directionally approved and are retained verbatim:

- Approved-email outreach, one recipient per send, manual-send-only.
- Template registry with `draft / approved / archived` lifecycle; only `approved` templates sendable.
- Idempotency via `Idempotency-Key`, single-recipient enforced server-side.
- Suppression checks via existing `suppressed_emails`.
- Duplicate organisation checks (green / amber / red) with server-side resolver.
- Hard-block / warning resolver as the single source of truth.
- 11 canonical audit events (plus the 3 added in §2.3 and 2 added in §1.3 — total **16** canonical events, all guarded by `check-facilitation-phase2-audit-names.mjs`).
- Trader milestone redaction — coarse `outreach_state` only.
- New tables: `facilitation_outreach_templates`, `facilitation_outreach_candidates`, `facilitation_outreach_sends`, **plus** `facilitation_do_not_contact_rules` (this revision).
- New edge functions: `facilitation-outreach-candidate-add`, `facilitation-outreach-send`, `facilitation-outreach-escalate`, `facilitation-outreach-template-status`, **plus** `facilitation-outreach-escalation-resolve` (this revision, `compliance_analyst` only).
- Negative controls and prebuild guards as listed previously, **plus** `check-facilitation-phase2-no-ai-dnc-coupling.mjs` (this revision).
- No SLA cron, no reporting dashboard, no CSV, no PDF, no POI / WaD / token / payment mutation.

---

## 4. Updated CLIENT_UAT_READY criteria

Adds to the prior list:

8. DNC register lives in `facilitation_do_not_contact_rules`; no production code path reads `ai_do_not_contact_rules`; coupling prebuild guard passes.
9. Manual attestation recorded that a `platform_admin` JWT receives 403 from `facilitation-outreach-escalation-resolve`, and that a `compliance_analyst` JWT can successfully resolve.
10. Manual attestation that send is blocked while the linked `compliance_cases` row is open, and unblocked once `compliance_analyst` resolves it.

---

## 5. Confirmed out of scope

- Any `platform_admin` ability to resolve compliance escalations.
- Any reuse of `ai_do_not_contact_rules` for real outreach.
- Bulk DNC import, CSV, scheduled DNC sync from external sanctions feeds.
- Break-glass override of compliance decisions.

---

**Next step:** review and approve this revised plan, or send further edits. No Phase 2 code will be written until you explicitly approve.  
  
Approved.

Proceed with Facilitation Phase 2 exactly as revised.

Key approved decisions:

1. Use a dedicated `facilitation_do_not_contact_rules` table.
2. Do not reuse `ai_do_not_contact_rules` for real counterparty outreach.
3. `platform_admin` may escalate and observe compliance escalations, but must not resolve them.
4. Only `compliance_analyst` may resolve or reopen compliance escalations.
5. Keep outreach manual-send-only.
6. Use approved templates only.
7. Enforce one recipient per send.
8. Enforce idempotency.
9. Enforce duplicate checks, DNC checks, suppression checks, and compliance escalation checks server-side.
10. Keep the UI advisory only; the edge function must be the final gatekeeper.
11. Trader/requester visibility remains coarse only.
12. Add all Phase 2 audit events and prebuild guards.
13. Keep all Phase 2 negative controls in place.

Phase 2 remains explicitly out of scope for:

- SLA cron
- reporting dashboard
- CSV export
- audit-pack PDF
- bulk outreach
- inbound reply ingestion
- auto-onboarding
- payment mutation
- POI mutation
- WaD mutation
- token or credit mutation
- platform_admin compliance override
- any production dependency on `ai_do_not_contact_rules`

Please implement in this order:

1. migrations and RLS
2. SSOT resolver and shared validation
3. edge functions
4. email template registry
5. prebuild guards
6. HQ UI surfaces
7. trader milestone redaction update
8. headless verification pack
9. platform_admin + compliance_analyst manual operator verification
10. Phase 2 closeout evidence

Do not declare `PHASE_2_CLIENT_UAT_READY` until all headless tests, manual operator checks, negative controls, RLS checks, and release-gate evidence pass.