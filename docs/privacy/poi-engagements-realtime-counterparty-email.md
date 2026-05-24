# Privacy Issue 4 — `poi_engagements` Realtime `counterparty_email` exposure

**Status:** DEFERRED — design decision required before any code, RLS, or publication change.
**Owner:** Product + Compliance (jointly).
**Do not implement from this note alone.** This is a design memo. No code, RLS, or Realtime publication changes are authorised by this document.
**Blocker constraint:** CP-006 is still OPEN; touching `poi_engagements` Realtime risks regressing CP-003 / CP-006 / CP-012 / CP-015 fixtures and live engagement screens.

---

## 1. Current risk

- `public.poi_engagements` is in the `supabase_realtime` publication (verified via `pg_publication_tables`).
- The table contains `counterparty_email` (free-form email captured at engagement initiation, used for outreach to the named counterparty contact).
- Current SELECT RLS on `poi_engagements` allows match participants from **both** the initiating org and the invited counterparty org to read full engagement rows.
- Consequence: Realtime row-change payloads (`INSERT` / `UPDATE` / `DELETE`) broadcast the full row — including `counterparty_email` — to **every** subscriber whose RLS predicate evaluates true. Today that includes members of both sides of the match.

**Is this definitely a leak?** Partly ambiguous, partly clear:

- **Clear leak:** if product intent is "the email the initiating org typed in to reach a specific human at the counterparty org is private to the initiating org and to platform_admin." Then any read by the counterparty org is a confidentiality breach (the counterparty org may not even know which of its staff was being contacted).
- **Ambiguous:** if product intent is "both sides agree the named contact is shared context once the engagement exists." Then current behaviour is by design, but it is undocumented and the field name `counterparty_email` reads as if it is one-sided.
- **Additional concern regardless of intent:** Realtime row payloads do not perform column-level masking. Even if the UI never *renders* the field for the opposite side, the bytes are on the wire and visible in DevTools / network inspector.

This is the core product-design question that must be answered before any technical fix.

---

## 2. Why "Fix All" is unsafe

A naive auto-fix (e.g. dropping the table from `supabase_realtime`, or tightening SELECT RLS to initiating-org-only) would likely:

- Break **`AdminPendingEngagementsPanel`** live updates (admins rely on Realtime to see engagement state changes without polling).
- Break **`engagement-read-model`** consumers in `MatchHeroCard`, `PendingEngagementSection`, `SealedEngagement`, `InboundReview`, `DealPipeline` — these read engagement rows directly via `from("poi_engagements")`.
- Break **`AcceptBindCard`** and other match engagement surfaces where the invited side must see *that an engagement exists* (even if not its email).
- Break CP-003 / CP-006 / CP-012 / CP-015 seeded fixtures (`seed-cp003-controlled-prod`, `seed-cp009-controlled-prod`, `seed-cp012-controlled-prod`, `seed-cp015-controlled-prod` and their `unseed-` counterparts) which write and assert on engagement rows including `counterparty_email`.
- Break cross-party engagement status visibility (the invited side losing the ability to see that they have been engaged at all).
- Risk regression in `admin-engagement-delivery-status`, `batch-e-outreach-blocked-live-proof`, `batch-f-by-match-response-hardening-live-proof`, `burn-poi-reconciliation` edge functions — these read engagement rows server-side via `service_role` so they are *probably* safe, but each must be audited before any RLS change.

---

## 3. Current dependencies

### Tables / publications
- `public.poi_engagements` — base table, in `supabase_realtime` publication.
- `counterparty_email` column — written on engagement create, read by Realtime subscribers and by REST reads.

### Client / read-model files referencing `poi_engagements`
- `src/lib/engagement-read-model.ts` — primary read model (`.from("poi_engagements")` at L123).
- `src/lib/engagement-state.ts` — engagement state derivation.
- `src/lib/engagement-wording.ts` — copy generation that references engagement fields.
- `src/lib/batch-d-events.ts` — event derivation.
- `src/components/match/MatchHeroCard.tsx`
- `src/components/match/PendingEngagementSection.tsx`
- `src/components/match/MatchDocuments.tsx`
- `src/components/desk/match/SealedEngagement.tsx`
- `src/components/desk/DealPipeline.tsx`
- `src/components/desk/inbound/InboundReview.tsx`
- `src/components/admin/AdminPendingEngagementsPanel.tsx`
- `src/components/admin/AdminEngagementForensicsPanel.tsx`
- `src/components/admin/AdminOutreachBlocksPanel.tsx`
- `src/components/admin/UserDetailDrawer.tsx`
- `src/pages/HQ.tsx`
- `src/types/poi-engagement.ts` (type definitions)

### Edge functions referencing `poi_engagements`
- `admin-engagement-delivery-status`
- `admin-user-journey`
- `batch-e-outreach-blocked-live-proof`
- `batch-f-by-match-response-hardening-live-proof`
- `burn-poi-reconciliation`
- `seed-cp003-controlled-prod` / `unseed-cp003-controlled-prod`
- `seed-cp009-controlled-prod` / `unseed-cp009-controlled-prod`
- `seed-cp012-controlled-prod` / `unseed-cp012-controlled-prod`
- `seed-cp015-controlled-prod` / `unseed-cp015-controlled-prod`

### Realtime subscription call sites (`.channel(...).on("postgres_changes", ...)`)
Confirmed `.channel(` consumers in `src/`:
- `MatchesList.tsx`
- `MaintenanceBanner.tsx`
- `admin/SystemStatusBadge.tsx`
- `admin/AdminPendingEngagementsPanel.tsx`
- `developer/LiveActivityFeed.tsx`
- `notifications/SidebarNotificationItem.tsx`
- `notifications/NotificationBell.tsx`

> Note (unverified — worth checking): not every `.channel(` listed above necessarily subscribes to `poi_engagements`; a precise audit per file is required before the migration step.

### Tests touching `counterparty_email`
- `src/tests/cp-015-match-email-change-history.test.tsx`
- `src/tests/cp-015-email-change-wording.test.tsx`
- `src/tests/cp-fixtures-admin-ui-proof.test.tsx`
- `src/tests/cp-003-ui-outreach-block.test.ts`
- `src/tests/cp-003-pending-engagement-audit.test.ts`
- `src/tests/uat/journey-rls-proof.test.ts`

---

## 4. Design options

### Option A — Redacted public Realtime view

Publish a redacted view (`poi_engagements_public_v`, no `counterparty_email`) to Realtime; keep full table reads behind admin / service-role paths.

- **Pros:** Cleanest privacy boundary. Realtime payloads physically cannot carry `counterparty_email`. Aligns with the pattern already used in Privacy Batch 2 (`org_colleagues_v`).
- **Cons:** Supabase Realtime publishes tables, not arbitrary views. Requires either (a) a real table mirror maintained by trigger, or (b) dropping `poi_engagements` from the publication and adding the view's underlying table. Non-trivial.
- **Breakage risk:** Medium. Every Realtime subscriber must be migrated to the new channel.
- **Files likely affected:** all `.channel(` call sites subscribing to `poi_engagements` (audit pending — see §3 note), `engagement-read-model.ts` (subscribe path only; REST reads unchanged), new migration adding the mirror table + triggers.
- **Tests required:** Realtime payload assertion (no `counterparty_email`), parity test (mirror stays in sync with base), admin live-update test, CP fixture green-run.

### Option B — Side-aware read model (`SECURITY DEFINER` RPC or `SECURITY INVOKER` view)

Keep `poi_engagements` private at the column level via a wrapper that only returns `counterparty_email` when `auth.uid()`'s org is the initiating org or has `platform_admin`.

- **Pros:** No change to publication. UI continues to subscribe to row-level changes; sensitive field is masked at read time.
- **Cons:** **Does not solve the Realtime leak.** Realtime sends the raw row before any view/RPC runs. This option only fixes REST reads, not the broadcast payload. Useful only as a *complement* to Option A or C, not a standalone fix.
- **Breakage risk:** Low for REST. Zero benefit for Realtime payload privacy.
- **Files likely affected:** `engagement-read-model.ts` and components that select `counterparty_email`.
- **Tests required:** RPC/view returns null for opposite side, returns value for initiating org and platform_admin; existing REST consumers unaffected.

### Option C — Disable user-facing Realtime for raw `poi_engagements`

Remove `poi_engagements` from `supabase_realtime`. Admin Realtime kept via separate admin-scoped channel (e.g. broadcast channel emitted by an edge function, or admin-only mirror table). Users move to REST + targeted refetch / Supabase channel on a derived notifications row.

- **Pros:** Smallest attack surface. Privacy issue eliminated by removing the leaky transport. Already partly the pattern used by `NotificationBell` / `SidebarNotificationItem`.
- **Cons:** User-side engagement screens lose instant updates; need to add polling (e.g. React Query `refetchInterval`) or a notification-driven invalidation. Worse UX for buyer-side "is the seller responding?" surfaces.
- **Breakage risk:** Medium. Every consumer of the user-side engagement Realtime subscription must switch to polling or notification-driven invalidation. Admin panels need a parallel admin-only channel.
- **Files likely affected:** all user-side `.channel(` subscribers to `poi_engagements`, `AdminPendingEngagementsPanel` (move to admin-scoped channel), migration to drop from publication.
- **Tests required:** Publication assertion (`poi_engagements` not in `supabase_realtime` for anon/authenticated roles), admin panel still updates, user UI refetches engagement state on notification, CP fixtures green.

---

## 5. Recommended implementation sequence (after product decision)

1. **Product decision first.** Decide whether `counterparty_email` is initiating-org-only, both-party-visible by design, or admin-only. Without this, no technical option is correct.
2. **Build the chosen read model.**
   - If Option A: create mirror table + triggers + view, add to publication.
   - If Option B (as complement): create `SECURITY INVOKER` view or `SECURITY DEFINER` RPC.
   - If Option C: build admin-only channel transport, build user-side notification-driven invalidation.
3. **Migrate subscribers.** Move every `.channel(...).on("postgres_changes", { table: "poi_engagements" })` to the new transport. One PR per surface (admin panel, match hero, deal pipeline) to keep blast radius small.
4. **Remove raw `poi_engagements` from `supabase_realtime`** only after every subscriber is migrated and CI proves no UI still subscribes to the raw table.
5. **Add Realtime privacy tests** (see §6) and a prebuild guard that fails CI if `poi_engagements` is re-added to the publication, or if any new `.channel(` subscriber references it.

---

## 6. Required tests

- Initiating org can read all allowed engagement fields via REST.
- Opposite (invited) org **cannot** receive `counterparty_email` in any Realtime payload, if the product decision is initiating-org-only.
- `platform_admin` can read full details via REST and via admin Realtime channel.
- `AdminPendingEngagementsPanel` still receives live updates after the migration.
- CP-003, CP-006, CP-012, CP-015 fixtures still pass end-to-end.
- No Realtime payload observed on the user-side channel contains `counterparty_email` (assertion via test harness that captures the raw payload, not the rendered UI).
- Service-role edge functions (`admin-engagement-delivery-status`, `admin-user-journey`, `batch-e-*`, `batch-f-*`, `burn-poi-reconciliation`, all `seed-*` / `unseed-*`) unaffected — direct `service_role` reads bypass RLS by definition and must continue to function.
- Prebuild guard: `pg_publication_tables` snapshot test asserts `poi_engagements` membership matches the agreed end-state.

---

## 7. Decision required

> **Product decision needed:**
> **Who is allowed to see `counterparty_email`, and through which surfaces?**
>
> Choose one (or define a hybrid):
> - **(I) Initiating-org-only** — counterparty_email is private outreach metadata of the initiating org. Invited org sees engagement exists but not the email. Platform_admin sees all. → Implies Option A or C.
> - **(II) Both-party-visible by design** — both orgs agree the named contact is shared context. → Implies *no privacy issue*, but requires explicit documentation, renaming `counterparty_email` to `named_contact_email`, and updating onboarding/legal copy to disclose this. No code change beyond docs + rename.
> - **(III) Admin-only** — neither side sees the email in-product; only platform_admin via the forensics panel. → Implies Option C plus column-level masking in REST.

Until product chooses, **no RLS, no Realtime publication, and no read-model change should ship.**

---

## Appendix — verification evidence

- `pg_publication_tables` confirms `poi_engagements` is in `supabase_realtime` (queried 2026-05-24).
- `information_schema.columns` confirms `counterparty_email` column exists on `public.poi_engagements`.
- File references in §3 enumerated from `rg -ln "poi_engagements" src/ supabase/functions/` on 2026-05-24.
- `.channel(` consumer list enumerated from `rg -ln "\.channel\(" src/` on 2026-05-24; per-file confirmation of which channels subscribe to `poi_engagements` is **unverified — worth checking** during implementation.
