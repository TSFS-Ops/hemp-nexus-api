# Manual UAT Script — Governance Record (Phase 1)

For Daniel / HQ. Run against the **staging** tier (or any environment where you have a `platform_admin` session). Browser automation against an authenticated HQ session was not available to the audit agent, so this script is the proof of "fully visible". Each step has the visible element name and the test-id it carries in the source so it cannot be confused with a similar surface.

## Preconditions

- A `platform_admin` account in the target environment.
- A second non-HQ account (any org user) for negative checks.
- At least one match with: (a) one POI event, (b) one blocked event, (c) one demo-flagged event, (d) one corrected event, (e) one HQ-decision event recorded by any of the 18 atomic admin RPCs, (f) one governance waiver. If these are not present, seed via the existing admin UIs (Credit org, manual override, demo workspaces, etc.) before running.

## Steps

### A. Route + nav (positive)

1. Sign in as `platform_admin`. Land on `/desk`.
2. Navigate to `/hq` (HQ shell). Confirm the tab strip shows **Governance Records** (`HQ.tsx` tab id `governance-records`).
3. Click **Governance Records**. URL becomes `/hq/governance-records`. Page renders `governance-records-list` (test-id).
4. Confirm filter bar (search box, From, To) is present, plus the Phase 1 caption "Phase 1 · HQ-only view · existing audit sources · no export".

### B. List + open

5. Type a known match id fragment in **Search · match id · org · commodity · status**. Confirm rows filter client-side (testid `governance-record-list-row`).
6. Set **From** and **To** dates. Confirm range applied.
7. Click any list row. URL becomes `/hq/governance-records?match=<uuid>`. Detail view renders (`governance-record-detail`).
8. Confirm the **Back to Governance Records** button (`governance-back`) returns to the list with filters preserved.

### C. Top summary card

9. Confirm `Governance Record` heading + record ref like `GR-MATCH-XXXXXXXX` (`governance-record-ref`).
10. Confirm the **Demo/Test** or **Live** pill (`demo-test-live-label`) is present in the top-right of the card and matches the underlying match.
11. Confirm the deterministic full-story paragraph renders (`governance-full-story`).
12. Confirm all 13 summary fields render values OR "Not recorded" (none should show `null`/`undefined`/empty string):
    - Match ID, Buyer organisation, Seller organisation, Commodity / deal, POI status, Counterparty status, WaD status, Execution status, Finality status, Memory record (must show "Not wired in this build" with a tooltip), Credit / payment, Current risk flag, Verification posture, Demo / Test / Live, Last material event.

### D. HQ notes (manual notes)

13. Click **Add HQ note** (`hq-notes-add-button`). Dialog opens (`hq-notes-dialog`).
14. Pick a reason from the dropdown (`hq-note-reason`) other than `other`. Type a 25-char+ note. **Record** (`hq-note-submit`). Toast confirms; dialog closes; timeline refreshes within seconds.
15. Confirm the new row appears in the merged timeline as an `HQ note` category row.

### E. Corrections (append-only)

16. Locate an existing **event_store** row in the timeline that is not itself a correction. Confirm the **Correct this event** button (`correct-event-button`) is present (HQ-only).
17. Click it. The HQ-note dialog opens in correction mode; the original event id is shown in the dialog. Pick a reason. Type a 25-char+ note. **Record**.
18. Confirm the original row now shows an amber **Corrected** badge (`corrected-badge`) with `data-correction-event-id` attribute. Hover: tooltip shows correction event id, actor, timestamp, reason, and the phrase "Original event is preserved unedited."
19. Confirm a separate **HQ correction** category row appears in the timeline for the correction event.

### F. Blocked / Allowed / Manual review / Demo

20. Filter family = **HQ decision**. Confirm at least one row carries the `HQ decision` badge and the controlled paragraph `hq-decision-copy`.
21. Filter Allowed/Blocked = **Blocked**. Confirm rows show the destructive **Blocked** badge (`blocked-badge`) with reason code where present.
22. Filter Demo/Live = **Demo/Test only**. Confirm rows show the **Demo/Test** badge (`demo-badge`).
23. Filter Allowed/Blocked = **Manual review**. Confirm amber **Manual review** badge renders.
24. Click **Clear all** (`governance-filters-reset`). Filters reset, active count returns to 0.

### G. Event drawer

25. Click any timeline row. Drawer opens (`governance-event-drawer`).
26. Confirm rows for: Event source, Source row id, Action / type, Timestamp, Actor, Actor type, Previous state, New state, Status, Reason code, Posture, Policy version, Source function, Correlation id, Request id, Match id, POI id, Engagement id, WaD id, Payment reference, Org id, Source table.
27. Confirm **Safe metadata (redacted)** JSON is rendered (`safe-metadata`) and contains **no** secrets, tokens, raw provider payloads, or document URLs. Any sensitive keys must show `[redacted]`.

### H. Waivers / bypasses

28. Scroll to the **Governance waivers** card under the top summary. Confirm any existing waivers list with status badge (`active`/`consumed`/`expired`/`revoked`).
29. Click **Grant waiver** (or **Renew** on an existing row). Fill posture, scope, reason, note, expiry, max uses. Submit.
30. If the session is AAL1 only, expect an MFA-required toast (NOT a silent success). Step up MFA and retry. Success toast appears; new row appears in the waivers list and a `Waiver/Bypass grant` row appears in the merged timeline.

### I. Per-source row-cap warning

31. Open a Governance Record for a match that has >500 rows in any single source (production-busy matches). Confirm the amber **row-cap warning** banner (`row-cap-warning`) lists the affected source(s).

### J. Empty + error states

32. Filter to a query that returns no matches. Confirm "No matches found for this filter." renders.
33. Open a Governance Record for an anchor with no events. Confirm `no-event-copy` placeholder.
34. Apply filters that match no events on a populated record. Confirm `no-events-after-filters` placeholder.
35. (Optional) Force a 4xx (e.g. revoke RLS for the session). Confirm "Failed to load governance events." renders.

### K. Deep links from related screens

36. Open Match Details for the same match. Confirm the **Open Governance Record** button (`open-governance-record-link`). Click → arrives at `/hq/governance-records?match=<uuid>`.
37. Open Admin Pending Engagements panel (HQ → Engagements). Confirm `open-governance-record-link` is present on at least one row.
38. Open Admin Verification Queue panel. Confirm the same link appears.

### L. Non-HQ negative proof

39. Sign out. Sign in as a non-HQ org user.
40. Try to visit `/hq/governance-records` directly. Expect redirect to `/desk` (no detail content renders). This is enforced by `RequireAuth role="platform_admin" fallbackRoute="/desk"` in `src/App.tsx:219`.
41. Open Match Details on a match the user can see. Confirm the **Open Governance Record** button is **not rendered** (component returns `null` when `!isPlatformAdmin`).

## Acceptance

A run is accepted when **every** numbered step above passes. Capture screenshots for steps 7, 18, 21, 22, 25-27, 31, 40, 41 and attach to the proof pack. The screenshots together with the test-id confirmations constitute the visible-proof receipt pack.
