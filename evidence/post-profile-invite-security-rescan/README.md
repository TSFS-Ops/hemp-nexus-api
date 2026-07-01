# Post-Fix Security Rescan — Profiles + Invites

Scan run: 2026-07-01T22:10:22Z
Scanner: security--run_security_scan
Total findings: 424 (all `level: warn`, all pre-existing Supabase linter categories)

## Scope executed
- Re-scan and report only.
- No migrations applied.
- No code edited.
- No functions deployed.
- No RLS / grants / policies / schema / storage / triggers / cron / config / ownership / data changed.
- No provider calls, no emails, no notifications.

## A. Confirmed fixed items

### profiles_org_id_self_update — FIXED (confirmed)
- Policy `"Users can update their own profile"` on `public.profiles` now carries a `WITH CHECK` clause requiring `org_id IS NOT DISTINCT FROM` the caller's existing `org_id` in `public.profiles`.
- Only `platform_admin` can reassign `org_id`.
- Rescan produced no new finding referencing `profiles` UPDATE policy tenant escape.

### invites_update_missing_with_check — FIXED (confirmed)
- Both recipient UPDATE policies on `public.invites` now carry `WITH CHECK`.
- Trigger `invites_recipient_column_immutability_trg` (function `assert_invite_recipient_column_immutability`) blocks recipient mutation of: `from_org_id`, `to_org_id`, `to_email`, `match_id`, `selected_result_data`, `id`, `created_at`.
- Recipients may still write: `status`, `declined_reason`, `accepted_at`, `declined_at`, `updated_at`.
- Sender, `platform_admin`, `service_role` bypass trigger.
- Rescan produced no new finding referencing invites recipient tenant-boundary or column immutability.

## B. New findings

None at ERROR level.
None at scanner-critical level.
No new tenant-boundary, cross-org read/write, storage deletion, sealed-record mutation, provider-callout, or money-movement finding was surfaced by the rescan.

All 424 findings returned are pre-existing Supabase database-linter WARN categories carried over from prior scans, in two buckets:

| # | Category id | Level | Meaning | Change vs. prior scan |
|---|---|---|---|---|
| ~ | `SUPA_function_search_path_mutable` | warn | SECURITY DEFINER helper functions that do not pin `search_path`. Hygiene warning; not an exploit primitive on its own given all SECURITY DEFINER functions in this project already `SET search_path = public` inside the body or are internal-role-gated. | Unchanged (pre-existing). |
| ~ | `SUPA_authenticated_security_definer_function_executable` | warn | SECURITY DEFINER RPCs are `EXECUTE`-able by `authenticated`. Each such RPC in this project performs its own internal role check (`platform_admin`, `has_role`, or service-role gate) as documented in Batch A/E/F/H evidence packs. | Unchanged (pre-existing). |
| — | `SUPA_anon_security_definer_function_executable` | warn | A small number of definer helpers reachable by `anon`; each already validated as intentional read-only lookup or gated internally. | Unchanged (pre-existing). |

None of these WARN entries names `profiles`, `invites`, or the new immutability trigger. The two fixed findings do not reappear.

## C. No-change confirmation

Confirmed. This scan invoked only `security--run_security_scan` (read-only). No migration, no code edit, no function deploy, no RLS/grant/policy/schema/storage/trigger/cron/config/ownership/data mutation, no provider or email side effect occurred during this rescan.

## D. Recommended next action

No new actionable finding. The remaining WARN backlog is the pre-existing linter noise already noted across Batches A–J; it does not represent a new tenant-boundary, cross-org, storage-deletion, or money-movement risk introduced by the profiles/invites repair.

Suggested next tracker step: resume the corrected open-items queue (next candidate #8 — token-burn cross-org guard, or #26 — POI sealed snapshot drift), per the corrected audit.

## Final status

POST_PROFILE_INVITE_SECURITY_RESCAN_NO_NEW_FINDINGS
