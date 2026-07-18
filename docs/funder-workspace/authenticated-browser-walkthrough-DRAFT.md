# Authenticated Browser Walkthrough — DRAFT

> **DRAFT — awaiting PR #26 deployment and live authenticated verification.**
> Do not treat any tick-box below as a passed test until a supervised
> authenticated run has been completed against the deployed preview.

Scope: Institutional Funder Evidence Workspace only (Admin console +
Funder-facing workspace). All routes below were read from the current
`src/App.tsx` on this branch.

---

## 1. Route list (verified in code)

### Shared / auth
| Purpose | Route |
| --- | --- |
| Login / sign-up | `/auth` |
| Landing (root) | `/` |
| Password reset | `/reset-password` |
| Logout control | Sidebar footer, "Sign out" button. Present in both `AdminShell` and `FunderShell`. |

### Admin Funder Workspace (role: `platform_admin`)
| Purpose | Route |
| --- | --- |
| Admin index (summary cards) | `/admin/funder-workspace` |
| Onboarding requests | `/admin/funder-workspace/onboarding` |
| Funder organisations list | `/admin/funder-workspace/organisations` |
| Organisation detail | `/admin/funder-workspace/organisations/:organisationId` |
| Releases list | `/admin/funder-workspace/releases` |
| **New release** | `/admin/funder-workspace/releases/new` |
| **Release detail** | `/admin/funder-workspace/releases/:releaseId` |
| Audit & usage | `/admin/funder-workspace/audit` |
| **Pilot console** | `/admin/funder-workspace/pilot` |

### Funder workspace (role: funder-org member)
| Purpose | Route |
| --- | --- |
| Funder index | `/funder/workspace` |
| Deals list | `/funder/workspace/deals` |
| Deal detail | `/funder/workspace/deals/:releaseId` |
| Activity | `/funder/workspace/activity` |
| Profile / team | `/funder/workspace/profile` |

All admin routes are wrapped in `RequireAuth role="platform_admin"
fallbackRoute="/desk"`. All funder routes are wrapped in `RequireAuth`
and additionally gated inside `FunderWorkspaceShell` (renders an
"Funder workspace unavailable" card when the caller is not a member of
an approved funder org).

---

## 2. Account-order list (recommended login order)

1. **Platform admin** — seeds pilot users via Pilot Console, creates the release.
2. **Funder reviewer (Pilot Funder Bank)** — opens deal, reads pack, raises RFI, records decision.
3. **Funder viewer (Isolation Test Fund)** — confirms cross-org isolation (must **not** see the release above).
4. **Platform admin** — revokes release, confirms audit trail.

Passwords must come from the Pilot Console output at run time. **Never
paste them into this file or any screenshot.**

---

## 3. Screenshot map

| # | Role | Route | Must show | Must NOT show | Filename | Redact |
|---|---|---|---|---|---|---|
| 1 | Admin | `/admin/funder-workspace` | Summary cards (Pending onboarding, Approved orgs, Active releases…), section grid | Any raw UUID in a card | `01-admin-index.png` | — |
| 2 | Admin | `/admin/funder-workspace/pilot` | Seeded user table with email, display name, role, org, temporary password, Copy buttons | Real customer emails | `02-pilot-console.png` | **Blur password column** |
| 3 | Admin | `/admin/funder-workspace/organisations` | Approved funder orgs list with human-readable names | Raw org UUIDs as primary label | `03-orgs-list.png` | — |
| 4 | Admin | `/admin/funder-workspace/releases/new` | Funder org select, canonical deal selector, evidence pack select, expiry, permission switches, consent selects | Free-text "deal reference" as the only identifier | `04-new-release-empty.png` | — |
| 5 | Admin | `/admin/funder-workspace/releases/new` (filled) | All fields populated, "Create release" enabled | Admin override reason field empty when consent is `pending`/`declined` | `05-new-release-filled.png` | Deal name if sensitive |
| 6 | Admin | `/admin/funder-workspace/releases` | New release visible at top, status badge, expiry indicator | Legacy `bilateral_match_id` header | `06-releases-list.png` | — |
| 7 | Admin | `/admin/funder-workspace/releases/:id` | Release header with funder org name + deal title, permissions, consent, revoke button | Signed download URLs in DOM | `07-release-detail.png` | Any signed URL |
| 8 | Admin | `/admin/funder-workspace/audit` | Chronological audit rows with actor, action, target | Actor UUID with no name resolution | `08-audit.png` | — |
| 9 | Funder reviewer | `/funder/workspace` | Org name banner, role label, welcome cards | Other funders' orgs | `09-funder-index.png` | — |
| 10 | Funder reviewer | `/funder/workspace/deals` | Deals table with human-readable deal title, status, expiry | Releases from other orgs | `10-funder-deals.png` | — |
| 11 | Funder reviewer | `/funder/workspace/deals/:id` | Deal header, evidence pack summary, RFI panel, notes/comments panel, decision panel | Internal admin notes; raw enum values | `11-funder-deal-detail.png` | — |
| 12 | Funder reviewer | Deal detail → RFI panel | Empty state + "New RFI" button; after create, RFI appears with status | Cross-org RFIs | `12-rfi-panel.png` | — |
| 13 | Funder reviewer | Deal detail → Notes | Comment composer, existing shared comments | Internal-only notes | `13-notes-panel.png` | — |
| 14 | Funder reviewer | Deal detail → Decision | Decision dropdown, reason field, success toast on submit | Decisions from other funders | `14-decision.png` | — |
| 15 | Funder viewer (2nd org) | `/funder/workspace/deals` | Empty state | Any deal from Pilot Funder Bank | `15-isolation-check.png` | — |
| 16 | Funder reviewer | `/funder/workspace/profile` | Org name, team members, roles | Other orgs' members | `16-profile-team.png` | Personal emails |
| 17 | Admin | `/admin/funder-workspace/releases/:id` after revoke | "Revoked" status badge, revoke reason visible in audit | Download button still active | `17-post-revoke.png` | — |
| 18 | Any | Legacy path e.g. `/funder/p5-batch3` | `LegacyBanner` visible, link back to canonical `/funder/workspace` | Duplicate primary nav | `18-legacy-banner.png` | — |

---

## 4. Button & field dictionary

| Control | Location | What it does | Visible to | Hidden from | Required fields / rules | Success state |
|---|---|---|---|---|---|---|
| **Prepare pilot logins** | Pilot Console | Seeds fake pilot users + temp passwords | platform_admin | all others (route-guarded) | none | Table of users rendered, "Copy" per row |
| **Create release** | New Release form | Calls `fw_admin_release_deal_v2` | platform_admin | all others | Funder org, canonical match, evidence pack + version, release reason (≥1 char), expiry (future date), consent selects; admin override reason required when either consent is not `granted`/`not_required` | Toast "Release created", redirect to release detail |
| **Generate pack** | Release detail / Evidence pack area | Requests a sealed pack build | platform_admin | funder + desk | Pack must be eligible | Version increments, "Sealed" badge |
| **Download pack** | Release detail (admin) / Deal detail (funder) | Fetches signed URL | admin: always; funder: only if `can_download_compiled_pack = true` | funders lacking permission | Release not revoked, not expired | File downloads; audit event written |
| **Create RFI** | Deal detail → RFI panel | Opens RFI against the release | funder reviewer | funder viewer, other orgs | Subject, question body | RFI appears with "Open" status |
| **Answer RFI** | Deal detail → RFI panel (admin side) | Posts an answer | platform_admin | funders | Non-empty answer | RFI moves to "Answered" |
| **Close RFI** | RFI row | Marks RFI resolved | RFI author + admin | others | RFI must be `answered` | Status → "Closed" |
| **Create internal note** | Release / deal detail | Admin-only note | platform_admin | funders, desk | Non-empty body | Note listed under "Internal notes" |
| **Create shared comment** | Deal detail → Notes | Comment visible to funder + admin | admin + funder reviewer | funder viewer only where scoped | Non-empty body | Comment appears in shared thread |
| **Record decision** | Deal detail → Decision panel | Persists a funder decision (progress / decline / approve) | funder reviewer | funder viewer | Decision value + reason | Toast "Decision recorded", panel becomes read-only or shows history |
| **Revoke release** | Release detail | Terminates access, keeps audit | platform_admin | funders | Non-empty reason (≥1 char, ≤1000) | Status → "Revoked", download disabled, audit row |
| **Sign out** | Shell footer (Admin + Funder) | `supabase.auth.signOut()` then redirect | authenticated users | — | — | Returned to `/auth` |

Field-level notes (from `src/lib/funder-workspace/validation.ts`):

- Release reason: 1–1000 chars, trimmed.
- Expiry: must parse as a future timestamp.
- Admin override reason: required when buyer or seller consent is not
  `granted` and not `not_required`.
- Rejection / revocation / linkage reasons: 1–1000 chars.

---

## 5. Walkthrough blockers (UI-only findings)

Confirmed by reading current source. Each item is a **UI concern only** —
no backend or migration touched.

1. **Free-text "Deal reference" field still present on New Release form**
   even though the canonical deal selector is now authoritative. Testers
   will not know whether to fill it. → Consider hiding when
   `match_id` is set, or relabeling as "Optional internal reference".
2. **Admin index summary cards** show `—` for every counter when
   `fetchAdminCounters` errors; the error toast is small. A non-technical
   tester may not notice load failed.
3. **Pilot Console** displays temporary passwords in plain text with a
   Copy button and no "Reveal / hide" toggle. Redaction guidance added
   to the screenshot map above.
4. **`FunderWorkspaceShell` "unavailable" state** looks identical to a
   generic empty state; a tester logging in as the wrong account will
   not know whether it is a permission problem or a data problem.
   Copy is fine, but a small "Signed in as: <email>" line would help.
5. **Legacy routes** (`/funder/p5-batch3/*`, `/funder/p5-batch4/*`,
   `/funder/p5-batch5/*` etc.) still resolve. `LegacyBanner` is present
   but easy to miss. Not fixable without route removal, which is out of
   scope this pass.
6. **Sidebar "Sign out" button** does not confirm before signing out.
   Low risk, but a non-technical tester who mis-clicks will lose their
   place mid-walkthrough.
7. **Release Detail** — some status transitions (e.g. `revoked`) rely on
   colour alone in `StatusBadge`; the label already reads "Revoked", so
   this is acceptable, but check contrast on projector screens.
8. **Funder Deal Detail** — RFI / Notes / Decision panels use tabs; on
   narrow viewports tabs wrap and the active-tab underline can be
   ambiguous. Confirm on tablet before the pilot.

No narrow UI fixes were applied in this pass — all findings above were
recorded but not auto-corrected, to keep this a pure audit.

---

## 6. Pass / fail checklist

Tick only after a supervised authenticated run.

**Admin setup**
- [ ] Log in as platform admin at `/auth`.
- [ ] Navigate to `/admin/funder-workspace/pilot` and press *Prepare pilot logins*.
- [ ] Confirm 6 users appear; capture screenshot **with passwords blurred**.
- [ ] Navigate to `/admin/funder-workspace/releases/new`.
- [ ] Select Pilot Funder Bank + canonical demo deal + evidence pack.
- [ ] Set expiry to `now + 14 days`.
- [ ] Set both consents to `granted` (or supply admin override reason).
- [ ] Press *Create release*; expect success toast + redirect to release detail.
- [ ] Confirm release visible on `/admin/funder-workspace/releases`.

**Funder review**
- [ ] Sign out, sign in as the seeded Pilot Funder Bank reviewer.
- [ ] Land on `/funder/workspace`; org name and role visible.
- [ ] Open `/funder/workspace/deals`; the new deal appears.
- [ ] Open deal detail; evidence pack summary loads.
- [ ] Raise an RFI ("Please confirm shipment date"). RFI listed as *Open*.
- [ ] Post a shared comment. Comment appears in thread.
- [ ] Record a decision (e.g. *Needs more info*). Toast confirms.

**Isolation check**
- [ ] Sign out, sign in as the Isolation Test Fund viewer.
- [ ] `/funder/workspace/deals` shows empty state (**no** Pilot Funder Bank deal).
- [ ] Direct-URL attempt to `/funder/workspace/deals/<releaseId>` blocks access.

**Admin closeout**
- [ ] Sign back in as platform admin.
- [ ] Answer the RFI, close it.
- [ ] Revoke the release with reason "Pilot walkthrough complete".
- [ ] Audit page shows: create, RFI open, RFI answer, RFI close, decision, revoke.

---

## 7. Stop-immediately conditions

Halt the walkthrough and record the state if **any** of the following occur:

- A funder account sees a release, RFI, note, or decision belonging to a
  different funder org.
- Any UUID, JWT, signed URL, or Supabase project reference is visible in
  the DOM outside the admin audit page.
- A "Download pack" click surfaces someone else's document.
- A page renders `undefined`, `null`, `NaN`, or a bare enum
  (`granted`, `pending`, etc.) as visible copy.
- The Pilot Console shows a real customer email.
- Any 5xx from the browser network tab on a funder-workspace route.
- Sign-out fails to return the user to `/auth`.

---

## 8. Cleanup reminders

- Revoke every release created during the walkthrough.
- Rotate / delete the pilot passwords produced by the Pilot Console.
- Delete screenshot files that still contain plaintext passwords or
  personal data before archiving.
- Do **not** commit screenshots to the repo; store in the pilot
  evidence folder outside version control.
- Sign every admin session out at the end of the run.

---

## Appendix — Files inspected while producing this draft

- `src/App.tsx` (routes 336–521)
- `src/pages/admin/funder-workspace/*` (Index, PilotConsole, NewRelease, Releases, ReleaseDetail, Organisations, Audit)
- `src/pages/funder/workspace/*` (Index, Deals, DealDetail, Profile, Activity, components/FunderWorkspaceShell)
- `src/components/shells/AdminShell.tsx`, `FunderShell.tsx`
- `src/lib/funder-workspace/validation.ts`, `permissions.ts`, `ui/*`
- `src/lib/constants.ts` (`ROUTES.AUTH = '/auth'`)

No migrations, RLS policies, RPCs, Edge Functions, workflows, or
production data were touched while producing this draft.
