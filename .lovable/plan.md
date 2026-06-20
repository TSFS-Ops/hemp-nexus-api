## POI Verification Guardrails / Draft-Only Mode

Most of the architecture already exists: `_shared/legitimacy.ts` (org gate), `_shared/poi-authority.ts` (user gate), `useOrgLegitimacy` + `VerificationRequiredBanner` + `DraftPoiBadge` UI, and gate wiring in `pois`, `poi-transition`, `poi-engagements`, `match`. This plan closes the remaining gaps the client's binding list demands.

### Gaps to close (backend)

1. **WaD progression gate** — `supabase/functions/wad/index.ts` and `supabase/functions/p3-wad/index.ts` currently do not call the legitimacy + authority gate. Add the same `checkUserPoiAuthority` → `checkOrgLegitimacy` pair (callsite `poi_mint`) around every WaD progression entrypoint (start, attest, finalise). Return 403 + `POI_ORG_VERIFICATION_REQUIRED` + `legitimacy.gate_blocked` audit row.
2. **Formal POI export gate** — `export-prepare` and `export-download` accept POI export jobs without the legitimacy gate. Add gate on POI-typed export requests; block download/preparation when the issuing org is not verified. Permit "draft" export only when the request is explicitly tagged `kind: "internal_draft"` (new flag) and watermark output.
3. **Facilitation / unknown-counterparty POI mint gate** — `facilitation-poi-conversion` issues formal POIs from admin-facilitated cases. Add legitimacy + authority gate against the *requesting* org so an unverified org cannot reach formal POI even via the facilitated route.
4. **Canonical reason code** — client requires `POI_ORG_VERIFICATION_REQUIRED`. Today we use `ORG_NOT_VERIFIED`. Add `POI_ORG_VERIFICATION_REQUIRED` as the public-facing alias exported from `_shared/legitimacy.ts`; emit it as `reason_code` in every gate-blocked audit row alongside the existing internal code (back-compat).
5. **Notification suppression on block** — wrap notification dispatch (`poi-engagements` outreach send, engagement reminders) so that when the gate denies, no email/in-app notification fires. Audit-only.

### Gaps to close (frontend)

6. **DraftPoiBadge coverage** — currently only on `MatchHeroCard`. Mount on POI list cards (`src/components/match/*` POI rows) and on the WaD progression card so the "Internal draft only / Not issued" label is visible everywhere a POI is shown.
7. **Action disabling** — audit POI action buttons (Send, Share, Export, Notify, Progress to WaD, Create engagement). Where they don't already check `useOrgLegitimacy`, disable + tooltip with the canonical blocked message.
8. **Draft export watermark** — when a draft preview is generated (new path), stamp every page with "INTERNAL DRAFT ONLY · NOT ISSUED · NOT COUNTERPARTY-FACING · SUBJECT TO ORGANISATION VERIFICATION".

### Tests

Add `src/tests/poi-verification-gate-coverage.test.ts` pinning:

- gate wired in: pois, poi-transition, poi-engagements, match, wad, p3-wad, export-prepare, export-download, facilitation-poi-conversion
- `POI_ORG_VERIFICATION_REQUIRED` exported and referenced
- forbidden-action allowlist (issue/send/share/notify/expose/export/engage/wad) — every name maps to a gated entrypoint

Add `scripts/check-poi-verification-gate-wiring.mjs` prebuild guard (added to RELEASE_GATE.md + package.json `prebuild`) that fails the build if any of the gated edge functions loses its `checkOrgLegitimacy` / `checkUserPoiAuthority` import.

### Audit

All blocked attempts already write `admin_audit_logs` with `action: "legitimacy.gate_blocked"`. Extend the metadata payload with `reason_code: "POI_ORG_VERIFICATION_REQUIRED"`, `attempted_action`, `org_verification_status`, `next_required_action`.

### No admin override

Explicit: no override path is added. The existing `platform_admin` role does not bypass the legitimacy check inside `checkOrgLegitimacy` — confirmed by reading the helper. We add a comment pinning that contract and a test asserting `platform_admin` calling against an unverified org still receives `POI_ORG_VERIFICATION_REQUIRED`.

### Files

**Edit**

- `supabase/functions/_shared/legitimacy.ts` (export `POI_ORG_VERIFICATION_REQUIRED_CODE`)
- `supabase/functions/wad/index.ts`, `supabase/functions/p3-wad/index.ts` (gate)
- `supabase/functions/export-prepare/index.ts`, `supabase/functions/export-download/index.ts` (gate + draft tag)
- `supabase/functions/facilitation-poi-conversion/index.ts` (gate against requester org)
- `supabase/functions/poi-engagements/index.ts` (notification suppression confirmation)
- `src/components/match/*` (mount DraftPoiBadge + disable buttons on blocked)
- `RELEASE_GATE.md`, `package.json` (new prebuild guard)

**Create**

- `scripts/check-poi-verification-gate-wiring.mjs`
- `src/tests/poi-verification-gate-coverage.test.ts`
- `evidence/poi-verification-gate-guardrails/README.md`

Acceptance: every gated entrypoint blocks unverified orgs at the server, the UI reflects draft-only status, blocked attempts are audited with `POI_ORG_VERIFICATION_REQUIRED`, no notifications fire on block, and the wiring guard prevents regression.  
  
Proceed with **POI Verification Guardrails / Draft-Only Mode**.

Do not require staging.  
Do not prepare client UAT.  
Build the full feature now.  
We will test internally after build completion.

Most of the architecture already exists:

- `_shared/legitimacy.ts` for the organisation gate
- `_shared/poi-authority.ts` for the user authority gate
- `useOrgLegitimacy`
- `VerificationRequiredBanner`
- `DraftPoiBadge`
- existing gate wiring in `pois`, `poi-transition`, `poi-engagements`, and `match`

This batch closes the remaining gaps required by the client-approved rule:

**Unverified organisations may prepare internal POI drafts, but they may not issue, send, notify, expose, export formal POIs, create formal engagements, or progress a POI into WaD until the organisation is verified and the issuing user is authorised.**

## **Backend gaps to close**

### **1. WaD progression gate**

Add the legitimacy and authority gate to:

- `supabase/functions/wad/index.ts`
- `supabase/functions/p3-wad/index.ts`

Apply the same gate pair:

- `checkUserPoiAuthority`
- `checkOrgLegitimacy`

Use callsite:

- `poi_mint`

The gate must run around every WaD progression entrypoint, including:

- start
- attest
- finalise

If blocked, return:

- HTTP 403
- `POI_ORG_VERIFICATION_REQUIRED`
- `legitimacy.gate_blocked` audit row

### **2. Formal POI export gate**

Add the legitimacy gate to:

- `supabase/functions/export-prepare/index.ts`
- `supabase/functions/export-download/index.ts`

For POI-typed export requests:

- block export preparation where the issuing organisation is not verified;
- block export download where the issuing organisation is not verified.

Permit draft export only where the request is explicitly tagged:

```ts
kind: "internal_draft"
```

Draft export must be watermarked and must not look like a formal platform-backed POI.

### **3. Facilitation / unknown-counterparty POI mint gate**

Add the legitimacy and authority gate to:

- `supabase/functions/facilitation-poi-conversion/index.ts`

The gate must check the **requesting organisation**, not the admin/facilitator organisation.

An unverified requesting organisation must not be able to reach formal POI issuance through the facilitated route.

### **4. Canonical reason code**

The client-required public reason code is:

```txt
POI_ORG_VERIFICATION_REQUIRED
```

Today the internal code may use:

```txt
ORG_NOT_VERIFIED
```

Add this as the public-facing alias exported from:

- `supabase/functions/_shared/legitimacy.ts`

Export:

```ts
POI_ORG_VERIFICATION_REQUIRED_CODE
```

All gate-blocked audit rows must emit:

```ts
reason_code: "POI_ORG_VERIFICATION_REQUIRED"
```

Keep the existing internal code for backwards compatibility if needed, but the public/client-facing and audit-facing reason code must be:

```txt
POI_ORG_VERIFICATION_REQUIRED
```

### **5. Notification suppression on block**

Confirm and enforce notification suppression in:

- `supabase/functions/poi-engagements/index.ts`

When the gate denies a formal POI action:

- no email notification must fire;
- no in-app notification must fire;
- no engagement reminder must fire;
- only the audit row should be written.

This must cover outreach send and engagement reminders.

## **Frontend gaps to close**

### **6. DraftPoiBadge coverage**

`DraftPoiBadge` is currently mounted only on `MatchHeroCard`.

Mount it anywhere a POI can be viewed or acted on, including:

- POI list cards;
- POI rows under `src/components/match/*`;
- WaD progression card;
- any engagement/progression panel where the POI state is visible.

Labels must make the position clear:

- “Internal draft only”
- “Not issued”
- “Organisation verification required before issuance”

### **7. Action disabling**

Audit all POI action buttons and controls.

This includes:

- Send
- Share
- Export
- Notify
- Progress to WaD
- Create engagement
- Any formal issue/mint action

Where any control does not already check `useOrgLegitimacy`, add the check.

When blocked:

- disable or hide the action;
- show the canonical blocked message as helper text or tooltip.

Use this exact message:

```txt
Verification required before issuing POI. You can continue preparing this POI as an internal draft, but your organisation must be verified before it can be issued, shared, sent to a counterparty, exported as a formal POI, or progressed into formal engagement.
```

### **8. Draft export watermark**

Where a draft preview/export path is generated using:

```ts
kind: "internal_draft"
```

stamp every page with:

```txt
INTERNAL DRAFT ONLY · NOT ISSUED · NOT COUNTERPARTY-FACING · SUBJECT TO ORGANISATION VERIFICATION
```

The watermark must be unavoidable and visible.

Do not allow unverified organisations to generate any POI document that looks formal, issued, counterparty-facing, or platform-backed.

## **Tests to add**

Create:

- `src/tests/poi-verification-gate-coverage.test.ts`

This test must pin that the gate is wired into:

- `pois`
- `poi-transition`
- `poi-engagements`
- `match`
- `wad`
- `p3-wad`
- `export-prepare`
- `export-download`
- `facilitation-poi-conversion`

The test must also confirm:

- `POI_ORG_VERIFICATION_REQUIRED` is exported;
- `POI_ORG_VERIFICATION_REQUIRED` is referenced by every blocked formal POI path;
- the forbidden-action allowlist is complete.

Forbidden actions must include:

- issue
- send
- share
- notify
- expose
- export
- engage
- progress to WaD

Every forbidden action must map to a gated backend entrypoint.

## **Regression guard**

Create:

- `scripts/check-poi-verification-gate-wiring.mjs`

Add it to:

- `RELEASE_GATE.md`
- `package.json` `prebuild`

The guard must fail the build if any gated edge function loses either of these imports:

- `checkOrgLegitimacy`
- `checkUserPoiAuthority`

The guarded functions are:

- `pois`
- `poi-transition`
- `poi-engagements`
- `match`
- `wad`
- `p3-wad`
- `export-prepare`
- `export-download`
- `facilitation-poi-conversion`

## **Audit requirements**

All blocked attempts must continue writing:

```txt
admin_audit_logs
```

with:

```txt
action: "legitimacy.gate_blocked"
```

Extend the metadata payload with:

```ts
reason_code: "POI_ORG_VERIFICATION_REQUIRED",
attempted_action,
org_verification_status,
next_required_action
```

At minimum, the audit record must identify:

- organisation;
- user;
- POI or trade request reference;
- attempted action;
- current verification status;
- reason code;
- timestamp;
- next required action.

Counterparties must not see:

- the draft POI;
- the blocked attempt;
- any related notification.

## **No admin override**

Do not add an admin override path.

The existing `platform_admin` role must not bypass the legitimacy check inside `checkOrgLegitimacy`.

Add a comment pinning this contract.

Add a test asserting that a `platform_admin` calling against an unverified organisation still receives:

```txt
POI_ORG_VERIFICATION_REQUIRED
```

## **Files to edit**

- `supabase/functions/_shared/legitimacy.ts`
- `supabase/functions/wad/index.ts`
- `supabase/functions/p3-wad/index.ts`
- `supabase/functions/export-prepare/index.ts`
- `supabase/functions/export-download/index.ts`
- `supabase/functions/facilitation-poi-conversion/index.ts`
- `supabase/functions/poi-engagements/index.ts`
- `src/components/match/*`
- `RELEASE_GATE.md`
- `package.json`

## **Files to create**

- `scripts/check-poi-verification-gate-wiring.mjs`
- `src/tests/poi-verification-gate-coverage.test.ts`
- `evidence/poi-verification-gate-guardrails/README.md`

## **Acceptance criteria**

This batch is complete only when:

1. Every formal POI entrypoint blocks unverified organisations at the server.
2. The UI reflects draft-only status everywhere POIs are shown.
3. Blocked attempts are audited with `POI_ORG_VERIFICATION_REQUIRED`.
4. No notification fires when a POI action is blocked.
5. Formal export is blocked for unverified organisations.
6. Draft export, if allowed, is explicitly tagged `kind: "internal_draft"` and visibly watermarked.
7. WaD progression is blocked at `wad` and `p3-wad`.
8. Unknown-counterparty/facilitation conversion is blocked for unverified requesting organisations.
9. `platform_admin` cannot override the gate.
10. The new wiring guard prevents regression.
11. All relevant tests pass.

Server-side enforcement is mandatory. UI disabling alone is not sufficient.