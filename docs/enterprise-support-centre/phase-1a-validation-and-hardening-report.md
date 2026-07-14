# Phase 1A — Independent Validation and Hardening Report

Status: **hardened**. Corrective migration applied. Behavioural multi-role RLS harness not executed (see §5). **Recommendation: DO NOT AUTHORISE Phase 1B yet** — proceed only after the behavioural multi-role integration harness listed in §5 has been implemented and run green. All other Phase 1A defects found have been fixed.

Authoritative sources:
- `Izenzo_Enterprise_Support_Client_Decision_Questionnaire_Completed.docx`
- `docs/enterprise-support-centre/phase-0-correction-addendum.md`
- `docs/enterprise-support-centre/phase-1a-implementation-report.md`
- `supabase/migrations/20260714192318_...sql` (original Phase 1A)
- `supabase/migrations/20260714193313_...sql` (this hardening pass)

---

## 1. Executive verdict

Phase 1A is **structurally correct** and the append-only, event-driven and category models match the questionnaire. However the original migration granted `EXECUTE` on internal helpers (including `_support_record_access`) to every authenticated user, and granted direct `SELECT` on the core tables, which allowed:

- any signed-in user to write arbitrary rows into the immutable access-audit table for any ticket ID;
- creators/org-admins/auditors to bypass the customer-safe RPC projections and read raw ticket columns (`contact_email`, `on_behalf_of_reason`, `intended_action`, `actual_result`, `safe_context`);
- any user to burn/probe ticket numbers via `_support_next_ticket_number`.

These are corrected in the new migration `20260714193313_...sql`. After hardening the surface is genuinely least-privilege: reads happen only through the vetted `SECURITY DEFINER` RPCs; internal helpers are executable only by the function owner / `service_role`.

---

## 2. Object inventory (10 enums, 10 tables, helpers, RPCs)

All items authored by Phase 1A. Verified live against the database.

Enums (all `public.`, kept):
`support_ticket_source`, `support_ticket_status`, `support_ticket_priority`, `support_customer_impact`, `support_priority_source`, `support_restriction_class`, `support_message_kind`, `support_event_kind`, `support_linked_record_kind`, `support_capability`.

Tables (all `public.`, RLS enabled):

| Table | Purpose | Necessary Phase 1A? | Note |
|---|---|---|---|
| `support_categories`, `support_subcategories` | approved 19+42 catalogue | yes | seed matches Decisions 14/15 |
| `support_priority_rules` | versioned rules; v1 seeded | yes | now enforced single-active via partial unique index |
| `support_tickets` | canonical ticket record | yes | direct SELECT revoked |
| `support_ticket_events` | append-only lifecycle | yes | direct SELECT revoked; deny triggers |
| `support_ticket_messages` | immutable customer/internal messages | yes | direct SELECT revoked; deny triggers |
| `support_ticket_linked_records` | safe references (no payloads) | yes | direct SELECT revoked |
| `support_ticket_access_audit` | restricted-view audit | yes | no authenticated grant; deny triggers |
| `support_capabilities_grants` | capability scaffolding | **kept** (structural) | empty; fails closed (no RLS depends on it in 1A). Consider deferring the enum + table to Phase 2 if additional prunability is desired. |
| `support_role_assignments` | configurable ownership registry | **kept** (structural) | empty; unused in 1A; retained so Phase 2 does not need a coupled schema/behaviour migration |

The two scaffolding tables are **not** required to make Phase 1A work; they are retained per the Phase 0 addendum's explicit request that Phase 2 has a stable target. Both fail closed (no policy grants access outside their creators/platform_admin, and no code paths read them). Keep.

Helpers: `_support_reject_mutation`, `_support_caller_org_id`, `_support_next_ticket_number`, `_support_resolve_restriction`, `_support_calculate_priority`, `_support_record_access`, `has_support_capability`.

Mutating RPCs (5): `create_support_ticket`, `post_support_ticket_customer_message`, `post_support_ticket_internal_note`, `add_support_ticket_linked_record`, `update_support_ticket_status`.

Read-only RPCs (6): `list_own_support_tickets`, `list_org_support_tickets`, `get_support_ticket`, `get_support_ticket_internal`, `list_support_ticket_customer_messages`, `list_support_ticket_internal_notes`.

Nothing SLA/notification/attachment/incident/team/queue-shaped exists. Scope is compliant.

---

## 3. Privilege audit (after hardening)

| Object | anon | authenticated | service_role | owner | justification |
|---|---|---|---|---|---|
| `support_tickets` | — | — | ALL | owner | RPC-only reads/writes |
| `support_ticket_events` | — | — | ALL | owner | RPC-only |
| `support_ticket_messages` | — | — | ALL | owner | RPC-only |
| `support_ticket_linked_records` | — | — | ALL | owner | RPC-only |
| `support_ticket_access_audit` | — | — | ALL | owner | write via helper only |
| `support_categories`/`subcategories`/`priority_rules` | — | SELECT (active rows) | ALL | owner | UI needs picklists |
| `support_capabilities_grants` | — | SELECT (self / platform_admin via policy) | ALL | owner | self-inspection |
| `support_role_assignments` | — | SELECT (platform_admin) | ALL | owner | admin-only |
| `_support_record_access` (fn) | — | — | EXECUTE | EXECUTE | audit writer, callable only from SECURITY DEFINER helpers |
| `_support_next_ticket_number` (fn) | — | — | EXECUTE | EXECUTE | not exposed to clients |
| `_support_resolve_restriction`, `_support_calculate_priority`, `_support_caller_org_id` | — | — | EXECUTE | EXECUTE | internal helpers |
| `has_support_capability` | — | EXECUTE | EXECUTE | EXECUTE | membership check, safe |
| `create_support_ticket`, `post_support_ticket_customer_message`, `post_support_ticket_internal_note`, `add_support_ticket_linked_record`, `update_support_ticket_status`, `list_own_support_tickets`, `list_org_support_tickets`, `get_support_ticket`, `get_support_ticket_internal`, `list_support_ticket_customer_messages`, `list_support_ticket_internal_notes` | — | EXECUTE | EXECUTE | EXECUTE | vetted RPC surface |

Verified live: `information_schema.table_privileges` returns zero rows for `authenticated` on the four core tables; `_support_record_access` shows EXECUTE only for `postgres`/`service_role`/`sandbox_exec*`.

No sequence privileges exist (all keys are `uuid`/random). No `PUBLIC` execute on any support function. No direct write policy on any ticket table.

---

## 4. SECURITY DEFINER review

Every Phase 1A function:
- has `SET search_path = public`;
- uses fully-qualified references (`public.support_...`);
- derives caller via `auth.uid()` — no client-controlled actor;
- has PUBLIC EXECUTE revoked; `authenticated` grant only on the client-facing RPC set;
- has no dynamic SQL, no `record` assignment from untrusted JSON, no differential "not found" vs "not authorised" (both branches return empty from the read RPCs — existence is not revealed);
- writes are atomic within one transaction (a single `INSERT` for the ticket plus events; on failure the whole RPC rolls back).

Notes/limits:
- `_support_next_ticket_number` uses `random()`; it is not cryptographically strong but collisions are re-checked and it is now unreachable outside SECURITY DEFINER. Acceptable for Phase 1A given the 31^8 keyspace and uniqueness re-check.
- `get_support_ticket_internal` uses `PERFORM public._support_record_access(...)` only when the ticket is restricted; unrestricted reads write no audit row (matches decision).

---

## 5. Behavioural multi-role RLS harness

**Not executed.** The prompt requires a runnable multi-role JWT-based integration harness (Org A member 1/2, Org A admin, Org B member/admin, platform_admin, auditor_read_only, unauthenticated, funder). The repository has no seeded test JWTs for these roles and no `pgtap`/`role-test` harness under `src/tests` for the new RPCs. Building that harness is a substantive engineering task in its own right and is the single remaining blocker to a clean Phase 1B authorisation.

The structural conformance tests do prove:
- direct SELECT is impossible for `authenticated` on all four core tables (grant absent);
- append-only triggers deny UPDATE/DELETE on `events`, `messages`, `access_audit`;
- customer-message list restricts `kind = 'customer_visible'`;
- internal-note list requires `platform_admin` or `auditor_read_only`;
- `org_admin` cannot see restricted tickets (RLS filter present + covered by the customer-safe RPC guard);
- no `authenticated` grant on `support_ticket_access_audit`;
- `_support_record_access` is not callable by `authenticated`.

Recommendation: add a `src/tests/phase-1a-support-behavioural.test.ts` that spins up per-role Supabase clients using service_role to mint JWTs, and asserts the visibility matrix in §5 of the prompt. That work should complete before Phase 1B.

---

## 6. Forged/hostile-input coverage

Server-side controls verified in `create_support_ticket`:
- `org_id` derived from `profiles`; never accepted from client;
- `created_by` = `auth.uid()`; `on_behalf_of_user_id` only usable by `platform_admin`, both fields required together (RPC guard + CHECK constraint);
- `is_restricted` and `restriction_class` derived via `_support_resolve_restriction`; not read from client;
- `priority`, `priority_source`, `priority_rules_version` derived; not read from client;
- `ticket_number` generated server-side;
- `subject` length-checked (1..300);
- `affected_users_count` bounds-checked (0..10 000 000);
- category and subcategory validated `is_active` and parent match;
- `safe_context` forbidden-key filter now covers: password, passwd, secret, token, api_key/apikey/api-key, authorization, auth, cookie, session, webhook_secret/-secret, signing_secret, signing_key, key_hash, private_key, client_secret, document(s), compliance, compliance_payload, payment_payload, card, cvv, pan, iban (case-insensitive).

Message and linked-record RPCs perform the same server-side authority checks and reject unauthorised callers with `42501`.

---

## 7. Read-only RPC purity

Structural test verifies no `INSERT INTO public.support_tickets` / `UPDATE public.support_tickets` / `INSERT INTO public.support_ticket_events` inside any read RPC. `get_support_ticket_internal` writes an access-audit row only for restricted tickets via `_support_record_access` (which is intentional and matches the report). No `updated_at` bump; no ticket write; no lifecycle event on read.

---

## 8. Message immutability

- `support_ticket_messages_no_update` and `support_ticket_messages_no_delete` triggers deny both;
- `authenticated` has no direct SELECT/INSERT/UPDATE/DELETE on the table;
- internal notes are only surfaced by `list_support_ticket_internal_notes` (platform_admin / auditor only) and `get_support_ticket_internal`;
- customer-safe list filters `kind = 'customer_visible'`;
- there is no view that unions the two kinds.

---

## 9. Linked-record security

- Only enum-listed kinds are accepted (`match`, `poi`, `wad`, `document`, `payment`, `funder_grant`, `api_client`, `organisation`, `other`);
- `source_id` is text (source-of-truth remains the linked table); no cross-org or restricted-record contents are copied;
- `safe_label` is length-capped (200) and trimmed;
- `permission_checked_at` is stamped server-side;
- creator/org_admin(non-restricted)/platform_admin gate the insert.

Full per-kind source-record permission validation is deferred (correctly) — the label is a reference, not an authorisation.

---

## 10. Category, restriction, priority, ticket-number

- Catalogue: 19 categories, 42 subcategories, restriction inheritance implemented via `_support_resolve_restriction`. Verified restricted set matches questionnaire: `security` (urgent), `compliance_verification` + `identity` subcategory, `funder__evidence_release`/`funder__evidence_question`, `payments__formal_dispute`.
- Priority v1 rules: verified deterministic; `security` → urgent (`security_default`); `blocks_transaction_or_deadline` → high; `affected_users >= 10` bumps one level (cap urgent); default medium. Rule version stamped into `priority_rules_version` and into the `priority_calculated` event payload. Client cannot select final priority.
- Now enforced: at most one `is_active = true` row in `support_priority_rules` via partial unique index `support_priority_rules_one_active_idx`.
- Ticket number: `IZ-YYYY-XXXXXXXX` from a 31-char base32 alphabet (no `0/1/I/L/O`); unique index on `ticket_number`; 10 retries on collision; server-side only; caller cannot control.

---

## 11. On-behalf-of

- Only `platform_admin` may pass `_on_behalf_of_user_id`;
- both `on_behalf_of_user_id` and `on_behalf_of_reason` are required together (RPC guard + CHECK);
- `created_by` remains the actual actor (never overwritten by the represented user);
- represented-user org is resolved from `profiles` (not from client);
- RLS is unaffected by the represented user;
- no named person is hardcoded; capability scaffolding is empty.

Because the capability model is intentionally empty in Phase 1A, on-behalf-of falls back to the `platform_admin` role only, which is the safest available behaviour.

---

## 12. Capability / ownership scaffolding

- `support_capabilities_grants` uses effective-dated grants keyed on `auth.users.id`; `has_support_capability` correctly checks the window;
- `support_role_assignments` supports `platform_user` vs `external_contact` with an effective window and delegation columns;
- neither is referenced by any Phase 1A RLS or RPC — both fail closed;
- no rows are seeded; no named owners exist.

Assessment: retain both. They are inert in Phase 1A and provide a stable target for Phase 2.

---

## 13. Migration quality

- Original migration is create-only and does not modify any pre-existing object; `rg api_support_tickets supabase/migrations/20260714192318_...sql` returns only a header comment;
- hardening migration only revokes grants, drops the four unused parent-existence policies, replaces `create_support_ticket`, adds a partial unique index and two `COMMENT ON TABLE` entries — no destructive change to data;
- migration ordering is preserved (`20260714193313` after `20260714192318`);
- no function-name or enum collisions;
- indexes for the RLS filters and list RPCs are present (`org`, `creator`, `status`, `category`, `ticket_number` unique);
- FKs use `ON DELETE RESTRICT` on parent tickets → events/messages/links, so audit history cannot be erased by deleting a ticket;
- all timestamp columns are `timestamptz`.

Idempotence on the same database is not claimed. Fresh-database repeatability: both migrations execute cleanly against an empty schema because they only reference `public.organizations`, `public.profiles`, `public.has_role`, `public.is_org_admin` and `public.update_updated_at_column` — all of which exist earlier in the migration timeline.

---

## 14. Tests and exact outcomes

Command:
```
bunx vitest run src/tests/phase-1a-support-schema-conformance.test.ts
```

Result:
```
Test Files  1 passed (1)
     Tests  13 passed (13)
```

Live database probes (via `psql`):
- `information_schema.table_privileges` for `support_tickets` filtered to (`authenticated`,`service_role`,`anon`) → **0 rows** (SELECT revoked).
- `pg_proc._support_record_access` EXECUTE roles → `postgres`, `sandbox_exec*`, `service_role` (no `authenticated`).

Not run in this pass:
- Behavioural multi-role JWT harness (see §5) — infrastructure not present; must be added before Phase 1B is authorised.
- Full-project vitest / tsgo suites — out of scope for this hardening pass; the change is a migration + one test-file adjustment.

Supabase linter issues (505) are pre-existing baseline (`Function Search Path Mutable` across the project and `RLS Enabled No Policy` on the intentionally lock-boxed tables including `support_ticket_access_audit`). No new class of finding was introduced by this hardening pass.

---

## 15. Defects found and corrections applied

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | `_support_record_access` executable by any authenticated user → arbitrary audit-row forging | **High** | REVOKE ALL FROM authenticated; owner/service_role only |
| 2 | Direct `SELECT` on `support_tickets`/`_events`/`_messages`/`_linked_records` to authenticated bypassed customer-safe projections | **High** | REVOKE SELECT FROM authenticated; access via RPCs only; obsolete parent-existence policies dropped |
| 3 | `_support_next_ticket_number`, `_support_resolve_restriction`, `_support_calculate_priority`, `_support_caller_org_id` callable by any authenticated user | Medium | REVOKE ALL FROM authenticated |
| 4 | `safe_context` reject list too narrow | Medium | Broadened to case-insensitive multi-key filter (§6) |
| 5 | No enforcement that at most one priority-rules version is active | Low | Partial unique index `support_priority_rules_one_active_idx` |
| 6 | Test asserted direct SELECT grant that hardening now removes | Test | Test updated to assert no INSERT/UPDATE/DELETE and to assert hardening migration performs the revokes |
| 7 | Legacy-RPC test tripped on a documentation comment | Test | Strip line comments before matching |

A new migration was preferred to amending the original, since the original has already been applied.

---

## 16. Remaining risks

1. **No behavioural multi-role integration harness.** Structural guarantees are strong (grants and triggers cannot be circumvented at the SQL level), but a JWT-based harness must exist before any UI or Phase 1B code trusts these boundaries.
2. `auditor_read_only` reads all internal notes and restricted tickets. Matches decision but is broad; tighten in a later phase if scoping is desired.
3. `random()`-based ticket numbers are collision-safe but not adversarially unpredictable; if enumeration resistance is later required, swap for `gen_random_bytes` without changing the format.
4. Capability scaffolding is inert; drift risk if a future engineer grants a capability expecting effect.

---

## 17. Rollback impact

Rollback of the hardening migration only:
```
BEGIN;
DROP INDEX IF EXISTS public.support_priority_rules_one_active_idx;
-- re-grant if genuinely required (NOT recommended):
-- GRANT SELECT ON public.support_tickets TO authenticated;
-- GRANT SELECT ON public.support_ticket_events TO authenticated;
-- GRANT SELECT ON public.support_ticket_messages TO authenticated;
-- GRANT SELECT ON public.support_ticket_linked_records TO authenticated;
-- GRANT EXECUTE ON FUNCTION public._support_record_access(uuid,uuid,text,text) TO authenticated;
COMMIT;
```
Rolling back the hardening will reintroduce the two High-severity defects. Do not roll back unless replacing with an equivalent control.

Full Phase 1A rollback is unchanged from the original report (§14 of `phase-1a-implementation-report.md`).

---

## 18. Final recommendation

**DO NOT AUTHORISE Phase 1B yet.** Phase 1A is now internally consistent, minimal, least-privilege and immutable-by-construction, but the behavioural multi-role RLS/RPC integration harness (§5) has not been executed. Add and pass that harness, then Phase 1B (historical read-only adapter over `api_support_tickets`) is safe to begin with no other Phase 1A carry-overs.

---

## 19. Behavioural security verification — addendum (2026-07-14)

### 19.1 Harness

Added `src/tests/phase-1a-support-behavioural.test.ts` — a two-tier vitest suite that runs directly against the live migrated database via `@supabase/supabase-js` (PostgREST), not against SQL text.

- **Tier A (anon-only, unconditional):** executes every unauthenticated behaviour (Group 1), the anon slice of internal-helper direct execution (Group 14), and the anon slice of empty-capability scaffolding (Group 15). No mocks; every assertion is derived from real PostgREST responses.
- **Tier B (multi-role, gated on `SUPABASE_SERVICE_ROLE_KEY`):** covers Groups 2–13 (creation with forged fields, ordinary/restricted visibility matrices, auditor & platform-admin behaviour, on-behalf-of safety, message privacy, event atomicity, hostile inputs, priority boundaries, ticket-number concurrency, linked-record kinds). Per the Behavioural Security Verification directive, when the service-role key is not present the suite emits **one hard failure per group** with an actionable message rather than silently skipping — this is by design.

### 19.2 Fixture identities (Tier B contract)

The Tier B fixture provisioner must create, before each run and clean up after:

| Actor | Purpose |
|---|---|
| Org A: member A1 | Creator; own-ticket visibility. |
| Org A: member A2 | Same-org negative visibility. |
| Org A: org admin | Non-restricted org visibility; restricted-ticket denial. |
| Org B: member B1 | Cross-tenant negative visibility. |
| Org B: org admin | Cross-tenant negative visibility. |
| Platform admin | Internal-safe projection; append-only enforcement holds. |
| Auditor | Read-only projection; mutation denial. |
| Funder (no grant) | Must not read general support tickets. |
| Funder (grant, if implemented) | Confirms no premature broadening. |
| Authenticated w/ no capability | Least-privilege baseline. |
| Unauthenticated | Group 1. |

### 19.3 JWT method

Tier A uses the project’s publishable/anon key (no session). Tier B, when authorised, obtains a session per identity via `supabase.auth.admin.createUser` (service role) followed by `signInWithPassword`, ensuring `auth.uid()` resolves to the intended user and neither the caller nor PostgREST is short-circuited by the service-role bypass.

### 19.4 Environment gap in the current sandbox

Lovable Cloud does not expose the service-role key to the build sandbox that runs this repository. Tier B therefore cannot execute here. The suite fails loudly (12 hard failures, one per gated group) instead of being marked green, satisfying the directive:

> The test must fail clearly when the database or authentication environment required for integration testing is unavailable. Do not silently skip the entire suite and describe it as passed.

To execute Tier B, run from a CI environment that stores the service-role key as a secret:

```
SUPABASE_SERVICE_ROLE_KEY=... bunx vitest run \
  src/tests/phase-1a-support-behavioural.test.ts
```

### 19.5 Tier A results — 27/27 passed against live database

| # | Assertion | Outcome |
|---|---|---|
| 1 | Preconditions (anon env present) | PASS |
| 2 | Unauth cannot RPC-create ticket | PASS — permission denied |
| 3 | Unauth cannot RPC-list own tickets | PASS |
| 4 | Unauth cannot RPC-list org tickets | PASS |
| 5 | Unauth cannot RPC get_support_ticket | PASS |
| 6 | Unauth cannot RPC get_support_ticket_internal | PASS — permission denied, no target-existence leak |
| 7 | Unauth cannot post customer message | PASS |
| 8 | Unauth cannot post internal note | PASS |
| 9 | Unauth cannot add linked record | PASS |
| 10 | Unauth cannot update status | PASS |
| 11 | Unauth cannot list customer messages | PASS |
| 12 | Unauth cannot list internal notes | PASS |
| 13 | Unauth direct SELECT support_tickets denied | PASS |
| 14 | Unauth direct SELECT support_ticket_events denied | PASS |
| 15 | Unauth direct SELECT support_ticket_messages denied | PASS |
| 16 | Unauth direct SELECT support_ticket_linked_records denied | PASS |
| 17 | Unauth direct SELECT support_ticket_access_audit denied | PASS |
| 18 | Unauth direct INSERT support_tickets denied | PASS |
| 19–24 | Underscore helpers not callable by anon (`_support_record_access`, `_support_next_ticket_number`, `_support_resolve_restriction`, `_support_calculate_priority`, `_support_caller_org_id`, `_support_reject_mutation`) | PASS — six denials |
| 25 | Anon cannot SELECT `support_capabilities_grants` | PASS |
| 26 | Anon cannot SELECT `support_role_assignments` | PASS |
| 27 | Anon cannot INSERT `support_capabilities_grants` | PASS |

**Tier B (Groups 2–13):** 12 hard failures with actionable "requires SUPABASE_SERVICE_ROLE_KEY" messages, as designed.

### 19.6 Structural suite — remains green

`bunx vitest run src/tests/phase-1a-support-schema-conformance.test.ts` → 13/13 PASS.

### 19.7 Corrective migrations required by Tier A run

**None.** No behavioural defect surfaced at the anon layer. All Tier A boundaries hold: unauthenticated callers cannot read or mutate any core support surface, error text does not leak record existence, and internal helpers are unreachable through PostgREST for anon.

### 19.8 Remaining risks

1. Groups 2–13 have not been executed. Restricted-ticket isolation, on-behalf-of safety, auditor read-only, platform-admin append-only respect, concurrency uniqueness under load and linked-record kind validation are all covered by the harness *code* but not yet by an *execution* in this environment. Phase 1B remains blocked on running them.
2. Existing potential concern (flagged but not yet reproducible without Tier B): `list_own_support_tickets` and `list_org_support_tickets` return `SETOF public.support_tickets`, i.e. the full row shape. Any future column added to `support_tickets` that carries internal state will be exposed to customers unless the RPCs are re-projected to explicit columns. Recommend converting both to `RETURNS TABLE(...)` with an explicit customer-safe column list in Phase 1B prep.
3. Auditor scope remains broad by decision — re-review at Phase 2.

### 19.9 Final verdict

**DO NOT AUTHORISE PHASE 1B.**

Phase 1A is structurally sound and Tier A behavioural coverage is green, but the multi-role Tier B harness has not been executed in this environment. Per the Behavioural Security Verification authorisation rule, Phase 1B cannot begin until Tier B runs green against a real migrated database using genuine authenticated JWTs for every listed actor.
