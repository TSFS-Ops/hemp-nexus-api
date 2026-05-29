# 30 May Enterprise Readiness — Batch sequence

Your direction was **batched, smallest first**, **extend canonical where possible**, **SSO/SAML shell now + native Supabase SAML wired only when you hand me IdP metadata**, and **audit-and-surface the existing IDV** (no new provider work this round).

I am therefore splitting the 9 controls into 5 small batches. Only **Batch 4** is in scope for this turn. The remaining batches are listed so the sequencing is explicit and reviewable, but I will not start them until Batch 4 is accepted.

```text
Batch 4 (this turn)  → Enterprise Identity (SSO/SAML shell + SCIM lifecycle)
Batch 5              → Encryption/BYOK settings + Data Residency hardening
Batch 6              → SIEM/Audit Export MVP + Admin Export Controls
Batch 7              → Retention + Legal Hold gap-fill + DSAR export
Batch 8              → Tenant Boundary Evidence + IDV/KYB surface +
                       Enterprise Readiness Evidence page (claims gate)
```

Everything outside Batch 4 is **out of scope** for this turn. Do not raise it as a defect against Batch 4. The 24 May path is not touched.

---

# Batch 4 — Enterprise Identity (in scope)

Build the **organisation-level SSO/SAML configuration shell** and the **SCIM-style user lifecycle structure**, with full audit, status surface, and claims-control. No custom SAML implementation. Live SSO is only ever flipped on per-org after `supabase--configure_saml_sso` succeeds and a connection test is recorded.

## What gets built

### 1. Database — two new tables, both org-scoped, both `is_admin()`/`org_admin`-gated RLS

`public.org_sso_configs` (one row per organisation)

- `org_id`
- `provider` (`saml` | `oidc-placeholder` — only `saml` writeable in Batch 4)
- `metadata_url` (nullable)
- `metadata_xml_ref` (storage path, nullable)
- `verified_domains` (text[])
- `entity_id`, `acs_url` (populated from Supabase native SAML values when wired)
- `certificate_status` (`none` | `present` | `expiring` | `expired`)
- `supabase_sso_provider_id` (nullable — set only after `configure_saml_sso` succeeds)
- `status` (`not_configured` | `pending_metadata` | `configured_not_connected` | `live` | `failed` | `disabled`) — DB CHECK constraint
- `last_tested_at`, `last_test_result`, `failure_reason`
- `requested_by`, `reviewed_by`

`public.org_scim_user_states` (one row per (org, user))

- `org_id`, `user_id`
- `state` (`invited` | `active` | `suspended` | `deprovisioned`) — DB CHECK
- `source` (`manual` | `scim` | `sso_jit`)
- `external_id` (nullable — IdP user id when SCIM is live)
- `last_state_change_at`, `last_state_change_reason`

Plus: `org_id` indexes, `updated_at` triggers, GRANTs + RLS (org_admin/platform_admin read+write on own org; platform_admin full).

### 2. Canonical audit names (single SSOT module, prebuild parity guard)

New file `supabase/functions/_shared/identity-audit.ts` and mirror `src/lib/identity/identity-audit.ts`:

- `identity.sso_config_created`
- `identity.sso_metadata_updated`
- `identity.sso_domains_updated`
- `identity.sso_connection_tested`
- `identity.sso_enabled`
- `identity.sso_disabled`
- `identity.sso_failed`
- `identity.scim_user_provisioned`
- `identity.scim_user_suspended`
- `identity.scim_user_deprovisioned`

Prebuild guard `scripts/check-identity-audit-names.mjs` (same pattern as the existing `check-legal-hold-audit-names.mjs` / `check-ops-010-audit-names.mjs`) fails CI on drift.

### 3. Edge functions (platform_admin + org_admin only, AAL2-gated for sensitive ops)

- `org-sso-config` — `GET` / `PUT` org SSO config. Validates with Zod. Emits the relevant audit. Cannot set `status='live'` directly — only `org-sso-test-connection` can.
- `org-sso-test-connection` — invokes Supabase native SAML status check for the recorded `supabase_sso_provider_id`. Writes `last_tested_at` + `last_test_result`. On success may promote `status` to `live`. Emits `identity.sso_connection_tested` and either `identity.sso_enabled` or `identity.sso_failed`.
- `org-scim-user-lifecycle` — admin endpoint to set a user's state (`invited`/`active`/`suspended`/`deprovisioned`). Emits the matching `scim_user_*` audit. **This is the structure; no IdP SCIM webhook is wired in Batch 4.**

No custom SAML auth logic. No new `/auth/*` routes. AuthContext / RequireAuth / MFA / RBAC untouched.

### 4. Admin UI (HQ only — extends existing `src/pages/Hq*` surfaces)

- **HQ → Identity → Organisations** table: org name, SSO status badge, SCIM status, verified domains, last tested, claim allowed Y/N.
- **Org detail drawer**: form for metadata URL / XML upload, verified domains, "Test connection" button, status pill, audit-trail tail (last 20 identity events for that org).
- **User lifecycle panel** per org: list members with state badge, change-state action (gated, audited).
- Status pill rules (claims-control, enforced in one shared helper `src/lib/identity/sso-claim.ts`):
  - `not_configured` → grey "Not configured"
  - `pending_metadata` → amber "Pending metadata"
  - `configured_not_connected` → amber "Configured — not connected"
  - `live` → green "SSO live" (only after a successful test recorded)
  - `failed` → red "Failed"
  - `disabled` → grey "Disabled"
- **No marketing copy.** No "enterprise-ready", "bank-ready", "DFI-grade" language anywhere in the new UI.

### 5. Claims-control gate

Single helper `ssoClaimAllowed(config)` returns boolean. Anywhere the UI would otherwise say "SSO live" it must call this helper. Unit test asserts the helper only returns true when `status === 'live'` AND `last_test_result === 'pass'` AND `supabase_sso_provider_id IS NOT NULL`.

### 6. Tests

- Vitest: `src/tests/batch4-sso-claim-gate.test.ts` — claim helper truth table.
- Vitest: `src/tests/batch4-scim-state-transitions.test.ts` — valid/invalid state transition matrix.
- Deno: `supabase/functions/org-sso-config/index.test.ts` — Zod validation, RBAC denial for non-admin, audit emission, refusal to self-promote to `live`.
- Deno: `supabase/functions/org-scim-user-lifecycle/index.test.ts` — audit emission per transition.
- Prebuild: `scripts/check-identity-audit-names.mjs` runs in the existing `npm run build` chain.

### 7. Memory entries (added after migration + code land)

- `mem://features/enterprise-identity-sso-shell` — table shape, status vocabulary, claim helper, audit SSOT location.
- Update `mem://index.md` Memories section (Core untouched).

## What is explicitly NOT in Batch 4

- No custom SAML auth code.
- No SCIM HTTP endpoint exposed to IdPs (only the internal lifecycle structure + admin actions).
- No changes to login, MFA, AAL2, RequireAuth, RBAC, platform_admin, or the 24 May path.
- No encryption / residency / SIEM / retention / DSAR / IDV / evidence-page work — those are Batches 5–8.
- No `configure_saml_sso` call until you hand me real IdP metadata + verified domains for a specific org.

## Acceptance for Batch 4

1. Migration applied; new tables visible; RLS denies cross-org reads; GRANTs present.
2. Both edge functions deployed; Deno tests green.
3. Vitest green for claim helper + SCIM transitions.
4. Prebuild guard `check-identity-audit-names.mjs` green.
5. HQ → Identity page renders org list; status pills correct for seed data (all orgs start `not_configured`, claim not allowed).
6. No string `SSO live` or `SCIM live` anywhere in UI when `ssoClaimAllowed()` returns false (grep test).
7. Memory updated.

On all pass → `BATCH_4_CODE_READY` (live-SSO acceptance still requires you to provide IdP metadata for a pilot org and approve the `configure_saml_sso` call).

---

Reply **approve** to proceed with the migration, or tell me what to change.  
  
Approved to proceed with Batch 4 only.

The sequencing is accepted:

Batch 4 — Enterprise Identity: SSO/SAML shell + SCIM lifecycle

Batch 5 — Encryption/BYOK settings + Data Residency hardening

Batch 6 — SIEM/Audit Export MVP + Admin Export Controls

Batch 7 — Retention + Legal Hold gap-fill + DSAR export

Batch 8 — Tenant Boundary Evidence + IDV/KYB surface + Enterprise Readiness Evidence page

Batch 4 is the only authorised scope for this turn.

Please proceed on the basis of the following rules:

1. No custom SAML implementation.

Use only the Supabase-native SAML path when real IdP metadata is later provided. For now, build the org-level configuration shell, lifecycle structure, audit, status surface and claim gate.

2. Do not touch the 24 May path.

No changes to AuthContext, RequireAuth, MFA/AAL2, RBAC, platform_admin logic, POI, WaD, Memory, refund, legal hold, DSAR, IDV/KYB, residency, SIEM, admin export or tenant-boundary systems in this batch.

3. Treat Batch 4 as a control shell, not a live SSO claim.

The system may say:

- “SSO/SAML configuration path present”

- “Pending metadata”

- “Configured — not connected”

It may not say:

- “SSO live”

- “SCIM live”

- “Enterprise ready”

- “Bank ready”

- “DFI ready”

unless the exact control is actually wired, tested and evidenced.

4. Status promotion must be locked down.

`status = live` must not be writable through the normal config update path.

Only the connection-test path may promote to live, and only where:

- `supabase_sso_provider_id` is present;

- connection test passes;

- `last_test_result = pass`;

- `last_tested_at` is recorded.

5. RLS and role boundaries must be proven.

For the new tables, include evidence that:

- platform_admin can see all;

- org_admin can see only their own org;

- non-admin users are denied;

- cross-org reads/writes are denied.

6. SCIM wording must stay honest.

Because no external SCIM webhook is being exposed in Batch 4, label this as:

“SCIM lifecycle structure”

or

“SCIM-ready lifecycle states”

Do not call it “SCIM live”.

7. Canonical audit names must be protected.

The proposed SSOT audit modules and `check-identity-audit-names.mjs` guard are approved. Do not introduce identity audit event names outside the SSOT.

8. Acceptance evidence required before Batch 4 can be considered code-ready:

- migration file names;

- tables added;

- RLS policies added;

- edge functions added;

- UI routes/components added;

- audit event names added;

- tests added;

- prebuild guard result;

- staging verification steps;

- known limitations;

- confirmation that no 24 May path files were touched unless explicitly justified.

9. Final status wording:

When complete, report as:

`BATCH_4_CODE_READY — STAGING OPERATOR VERIFICATION REQUIRED`

Do not report Batch 4 as accepted until staging verification has passed.