# Institutional Funder Evidence Workspace — Pilot Guide (DRAFT)

Status: **DRAFT.** Do not distribute externally. This guide reflects
the current UI. It is not final until PR #26 (disposable-DB CI,
migration fail-closed, readiness RPC returning all nine checks green)
has been merged and the real Supabase environment has been validated.

Audience: pilot funder users, Izenzo platform admins, and internal
reviewers who need to know what the workspace does and does not yet do.

---

## 1. Who does what

- **Platform admin (Izenzo)** — creates funder organisations, invites
  and manages funder users, creates releases against specific
  transactions, seals evidence packs, releases packs to a funder, and
  can suspend an organisation or deactivate a user.
- **Funder Admin** — manages the users inside their own funder
  organisation (once the backend RPC lands — the button is currently
  visible to platform admin only).
- **Funder Reviewer / Approver / Viewer** — receives released deals,
  reviews the sealed evidence pack, raises RFIs, adds notes, and
  records a decision (Approver only for the final decision).
- **External adviser** — narrower read-only role for a named third
  party attached to one funder organisation.

## 2. What a pilot funder sees at sign-in

Route: `/funder/workspace`.

Panels:
- Organisation name and logged-in user's role in the header.
- Assigned-deals counters.
- Recent activity summary.
- Explicit banner: "Released for authorised funder review only.
  Information shown here has been approved for release by Izenzo.
  Decisions recorded elsewhere do not affect other funders."

If the current user is not attached to any approved funder
organisation, the page shows a plain "Funder workspace unavailable"
card and asks them to contact Izenzo support. There is no other
funder-visible surface for unauthenticated or unassigned users.

## 3. Working an assigned deal

Route: `/funder/workspace/deals`.

Each row shows:
- Human deal reference.
- Human release status (Active / Expiring soon / Expired / Revoked /
  Draft). Colour-coded and labelled — never a raw enum.
- Expiry date, with a `in 5 days` cue and an amber colour cue at
  14 days or fewer.
- Pack status (Sealed / Generated / etc).

Selecting a row opens `/funder/workspace/deals/:releaseId`:
- Readable deal identity at the top.
  (Buyer and seller display names arrive with the backend projection —
  see follow-up 1 in the audit.)
- Sealed evidence pack section (metadata; download flow is validated
  against the backend under PR #26 before pilot).
- RFIs, notes, decision recorder.

## 4. Team management (admin — pilot)

Route: `/admin/p5-batch3/organisations` and
`/admin/p5-batch3/organisations/:organisationId`.

- **Invite user** — email + display name + role. Sends the invite via
  the existing admin RPC and lists the user under Pending invitations.
- **Change role** — inline role dropdown per user. Opens a
  confirmation dialog with the old role → new role summary. Optimistic
  UI; rolls back on failure.
- **Deactivate user** — opens a confirmation dialog that REQUIRES a
  written reason (at least three characters) before the confirm
  button is enabled. Optimistic UI; rolls back on failure.
- **Reactivate user** — one-click reactivation.
- **Resend invitation** — button is visible for pending users but
  displays a "Resend not yet available" notice. It intentionally does
  not fabricate a backend call. The resend RPC is on the follow-up
  list.
- **Suspend organisation** — opens a confirmation dialog that
  REQUIRES a written reason. Suspending an organisation instantly
  blocks every user in it from accessing releases. Reactivation
  restores access.
- **Audit** — `/admin/p5-batch3/audit` shows the most recent 200
  server-recorded events (invitations, role changes, deactivations,
  suspensions, releases, etc.). Read-only.

## 5. What the pilot must still validate against the real backend

These items are UI-complete but need a real Supabase run before the
pilot goes live. They are gated by PR #26.

- The nine readiness checks all return Ready.
- Migrations apply idempotently in a fresh disposable database.
- A real sealed PDF renders correctly, with the correct buyer/seller
  and evidence content, and the stored hash matches the actual bytes.
- Signed download URL enforces expiry, revocation and per-funder
  isolation.
- Funder A cannot access Funder B's pack.
- Email notifications are wired for invitation, approval, release,
  RFI, revocation and expiry.

## 6. Known gaps (transparent for pilot)

- Buyer and seller display names on the deal detail page — backend
  projection pending.
- Admin downloads audit view — backing RPC pending.
- Email notifications — currently in-app only.
- Bank-confidence source, deterministic finality linkage and
  deal-specific required-evidence checklist — data model decisions
  outstanding. The pack shows honest "unavailable" wording in the
  meantime.
- Some legacy `/funder/p5-batch*` routes remain reachable for
  compliance and history — every one now carries a "Legacy view"
  banner linking back to `/funder/workspace`.

## 7. What to report during pilot

For any issue please capture:

1. Full URL of the page.
2. Screenshot.
3. What you clicked and what you expected.
4. Any red error banner text (do not redact — it is safe).
5. Approximate time (so the audit trail can be cross-referenced).

Send to the Izenzo pilot channel. Do NOT email raw evidence packs
outside the platform — the sealed PDF is the audit-of-record.
