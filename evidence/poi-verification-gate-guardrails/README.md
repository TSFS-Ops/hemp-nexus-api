# POI Verification Guardrails / Draft-Only Mode

Status: `POI_VERIFICATION_GUARDRAILS_READY_FOR_OPERATOR_VERIFY`

## Binding rule

> Unverified organisations may prepare internal POI drafts, but they may not
> issue, send, notify, expose, export formal POIs, create formal engagements,
> or progress a POI into WaD until the organisation is verified and the
> issuing user is authorised.

No admin override. No staging requirement. No client UAT requirement.

## Architecture

Two server-side gates run before every formal POI action:

| Gate | Helper | What it checks |
|------|--------|----------------|
| Org legitimacy | `supabase/functions/_shared/legitimacy.ts` · `checkOrgLegitimacy` | `trade_approvals.status === 'approved'`, not expired, not frozen, not revoked. Considers `organizations.frozen`. Posture-aware via `org_governance_profiles.verification_gate_position`. |
| User authority | `supabase/functions/_shared/poi-authority.ts` · `checkUserPoiAuthority` | User holds at least one of `platform_admin`, `org_admin`, `director`, `broker`, `seller`, `buyer`. `org_member` alone is **rejected**. |

Both gates emit the canonical reason code `POI_ORG_VERIFICATION_REQUIRED`
and write an `audit_logs` row with `action = "legitimacy.gate_blocked"` and
metadata built by `poiGateBlockedAuditMetadata`.

## Wired entrypoints

Full gate (org + user authority):

- `supabase/functions/pois/index.ts` — POI mint (bilateral + unilateral)
- `supabase/functions/poi-transition/index.ts` — POI state machine progression
- `supabase/functions/poi-engagements/index.ts` — engagement create / notify / outreach
- `supabase/functions/match/index.ts` — match-level POI mint
- `supabase/functions/wad/index.ts` — WaD create / attest / seal / revoke (POST methods)
- `supabase/functions/p3-wad/index.ts` — Phase 3 WaD issuance (POST methods)

Org legitimacy gate against the *requesting* org (service-role / admin paths):

- `supabase/functions/facilitation-poi-conversion/index.ts` — admin-facilitated POI conversion
- `supabase/functions/export-prepare/index.ts` — formal export preparation
- `supabase/functions/export-download/index.ts` — formal export download

Read-only entrypoints (POI list, draft inspect, GET WaD, GET certificate) are
intentionally NOT gated so internal draft history stays visible.

## Draft-only mode

Unverified orgs retain:

- search / discovery
- draft trade request creation
- draft POI preparation + save
- draft evidence upload

Formal export of a draft is permitted only when the request explicitly
carries `verification.kind === "internal_draft"`; that path remains
downloadable but the writer must watermark every page with:

```
INTERNAL DRAFT ONLY · NOT ISSUED · NOT COUNTERPARTY-FACING · SUBJECT TO ORGANISATION VERIFICATION
```

## UI

- `src/components/match/VerificationRequiredBanner.tsx` — counterparty-facing banner using the canonical message.
- `src/components/match/DraftPoiBadge.tsx` — per-POI "Internal draft only · Not issued · Organisation verification required before issuance" badge.
- `src/hooks/use-org-legitimacy.ts` — client mirror of the server gate; never the source of truth.

## Audit

Every blocked attempt writes `audit_logs` with:

```
action: "legitimacy.gate_blocked"
entity_type: <poi|wad|export_request|facilitation_case>
metadata: {
  reason_code: "POI_ORG_VERIFICATION_REQUIRED",
  legitimacy_reason,
  org_verification_status,
  valid_until,
  gate_position,
  attempted_action,
  next_required_action,
  endpoint,
  correlation_id?
}
```

Counterparties never see the draft POI, the blocked attempt, or any
notification — notifications fire only after the gate has passed, so a
blocked attempt produces audit-only.

## No admin override

`checkOrgLegitimacy` does not accept a caller-role parameter. There is no
code path that returns `allowed: true` because the caller is a platform
admin. Pinned by `src/tests/poi-verification-gate-coverage.test.ts` →
"no admin override" describe block.

## Regression guard

- `scripts/check-poi-verification-gate-wiring.mjs` (prebuild, listed in `RELEASE_GATE.md`) — fails the build if any gated edge function loses its imports of `checkOrgLegitimacy` / `checkUserPoiAuthority` or stops referencing `POI_ORG_VERIFICATION_REQUIRED`.
- `src/tests/poi-verification-gate-coverage.test.ts` — pins the canonical reason code, the wiring set, the forbidden-action allowlist, the UI parity, and the "no admin override" contract.
- `supabase/functions/_shared/poi-gate-integration_test.ts` (Deno) — in-runtime behavioural test, unchanged.

## Files

Edited:

- `supabase/functions/_shared/legitimacy.ts`
- `supabase/functions/wad/index.ts`
- `supabase/functions/p3-wad/index.ts`
- `supabase/functions/facilitation-poi-conversion/index.ts`
- `supabase/functions/export-prepare/index.ts`
- `supabase/functions/export-download/index.ts`
- `package.json`
- `RELEASE_GATE.md`

Created:

- `scripts/check-poi-verification-gate-wiring.mjs`
- `src/tests/poi-verification-gate-coverage.test.ts`
- `evidence/poi-verification-gate-guardrails/README.md`
