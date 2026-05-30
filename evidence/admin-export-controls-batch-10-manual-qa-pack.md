# Admin Export Controls — Batch 10 · Production-Safe Manual QA Pack

**Audience:** Non-technical testers (e.g. Daniel, David).
**Environment:** The live / published Izenzo platform (`https://trade.izenzo.co.za`).
**Status of system under test:** Batches 1–9 complete. Batch 7C live smoke remains blocked (no staging backend); the internal smoke runner correctly refuses the production-tier backend and must remain refused throughout this QA.

---

## 1. Purpose

This QA pack proves that the Admin Export Controls **access, gating, request, approval, list, and preview surfaces** behave correctly in the published system, **without** triggering any actual export generation, download, or data-leaving behaviour.

This QA does **not** prove file export generation, because generation/download is intentionally **not built yet**. It proves only:

- access control (platform_admin gating)
- MFA / AAL2 gate behaviour
- request workflow
- approval workflow
- list visibility (read-only)
- legal-hold safe-summary indicator
- redaction preview rendering
- the **no-generation boundary** (nothing leaves the platform)

If at any point during this QA you see a real file download, a real "Download / Generate / Prepare / Destroy" button, a real temporary link, a CSV/PDF/JSON file, or any raw legal-hold reason / raw sanctions / raw PEP / raw adverse-media payload — **stop immediately and escalate**. That is a blocker.

---

## 2. Roles required

| Tester | Role needed | Purpose |
|---|---|---|
| Tester A | `platform_admin` with MFA/AAL2 **enrolled and elevated** | Drives all positive paths |
| Tester B | A second `platform_admin` with MFA/AAL2 enrolled | Approves Tester A's request (self-approval must be blocked) |
| Tester C | Any non-admin (broker / buyer / supplier / org_admin / demo) | Negative-visibility test |
| Tester D | `platform_admin` **not currently AAL2-elevated** (fresh login, no MFA step) | MFA-gate test |

If you only have one platform admin, skip the self-approval test and note "single-admin environment" in the results table.

---

## 3. What NOT to test

Do **not** attempt, request, or escalate creation of any of the following — these are intentionally not built in the current system:

- file generation
- CSV / PDF / JSON output
- Blob downloads
- `Content-Disposition` responses
- download anchors
- signed URLs / temporary links
- storage uploads
- prepare-export jobs
- destroy-export actions

Do **not** ask engineering to "just enable" generation for the test. The whole point of this QA is to prove the surface is safe **without** those surfaces existing.

Do **not** test against any environment marked `staging` — there isn't one. Test only against the live published HQ surface.

Do **not** modify, retry, or "kick" any cron job, retention policy, cold-storage path, or DATA-004 surface.

---

## 4. Safety boundaries

| Boundary | Why it matters |
|---|---|
| Production guard on Batch 7C smoke runner stays refused | Confirms the dangerous "real smoke" path cannot run against live data |
| No download / signed link / file appears anywhere in the export controls UI | Confirms no data can leave via this surface |
| Raw legal-hold reasons / sanctions / PEP / adverse-media payloads never appear | Confirms the redaction contract is intact |
| Non-admin users cannot see any export-control surface | Confirms RBAC gating is intact |
| MFA-unelevated admin cannot use request / approval / list / preview where AAL2 is required | Confirms the AAL2 gate is intact |

---

## 5. Click path (step-by-step)

### A. Platform admin visibility

1. Tester A signs into the live platform.
2. Complete MFA / AAL2 elevation.
3. Navigate to **HQ** (`/hq`).
4. Open the **Governance Records** tab.
5. Confirm the following sub-tabs are visible:
   - `records`
   - `memory`
   - `export-requests`
   - `export-preview`
6. Confirm each sub-tab renders without console errors visible to the user.

**Expected:** All four sub-tabs render. The Export Requests list panel and Export Preview panel both show the safety badges: `Preview only — no file generated`, `No download link`, `No temporary link`, `AAL2 required`.

### B. Non-admin visibility

1. Tester C signs in.
2. Try to navigate to `/hq` directly.
3. Confirm `/hq` is not reachable, or it shows an "access denied" / not-platform-admin state.
4. Confirm the Governance Records tab and export-requests / export-preview sub-tabs are not visible.

**Expected:** No export-control surfaces are visible. No crash, no blank screen, no leaked data.

### C. MFA / AAL2 behaviour

1. Tester D signs in but does **not** complete MFA elevation.
2. Navigate to HQ → Governance Records → Export Requests.
3. Attempt a list refresh.
4. Navigate to Export Preview, enter a Governance Record id, and attempt the preview.

**Expected:** Each gated action returns the project-standard `MFA_REQUIRED` message. No data is returned. No file appears.

### D. Request flow

1. Tester A (platform_admin, AAL2 elevated) opens Governance Records → Export Requests.
2. Submit a new Governance Record export request for a known Governance Record id, leaving redaction mode at its default.
3. Observe the response.

**Expected:** Request is accepted, enters `awaiting_approval` (or the displayed equivalent of "awaiting approval"). Default redaction mode is `redacted_client_safe` (the safest of the four modes). **No file, no download link, no temporary link appears.**

### E. Approval flow

1. Tester A attempts to approve their own request.
2. Tester B (different platform_admin) opens the same request and approves it.

**Expected:**
- Self-approval is blocked with a clear message.
- Tester B's approval succeeds.
- Status transitions only to `approved` (or the displayed equivalent).
- **No file, no download link, no temporary link appears.**

### F. List view

1. Tester A refreshes Export Requests.
2. Inspect the row created in Step D / approved in Step E.

**Expected:** The request appears with status, redaction mode, and (if applicable) a **safe-summary legal-hold indicator** only. No raw legal-hold reason or notes appear. No file/download/temporary link appears.

### G. Redaction preview

1. Tester A opens Export Preview.
2. Enter the same Governance Record id used in Step D.
3. Run the preview.

**Expected:** The redacted payload renders, the manifest renders (allowed / removed / masked / forbidden-blocked field lists), and the safety badges remain visible. No raw sensitive payloads appear. No file/download/temporary link appears.

### H. Negative safety scan (do this on every panel in C–G)

Tester confirms the following are **absent everywhere** in the export-control surfaces:

- Download button
- Generate export button
- Prepare export button
- Destroy export button
- CSV export button
- PDF export button
- JSON export button
- Temporary link / signed link
- Visible file path
- Visible storage object / bucket reference
- Raw legal-hold reason
- Raw sanctions / PEP / adverse-media payload
- Raw upstream API response

If any one of these appears: **STOP. Escalate as a blocker.**

---

## 6. Screenshot checklist

Capture and label these screenshots (PNG, full panel visible, no personal data outside the platform UI):

| # | Filename suggestion | What to capture |
|---|---|---|
| 1 | `b10-req-before.png` | Export Requests panel before submit |
| 2 | `b10-req-success.png` | Request success state |
| 3 | `b10-approve-self-blocked.png` | Self-approval blocked state |
| 4 | `b10-approve-success.png` | Second-admin approval success state |
| 5 | `b10-list-approved.png` | List row showing approved request + safe-summary legal-hold indicator |
| 6 | `b10-preview.png` | Redaction preview panel with manifest |
| 7 | `b10-mfa-required.png` | MFA / AAL2 required state |
| 8 | `b10-non-admin-blocked.png` | Non-admin denied state |
| 9 | `b10-safety-badges.png` | Close-up of the `Preview only` / `No download link` / `No temporary link` / `AAL2 required` badges |

Store screenshots in a shared evidence folder named `batch-10-qa-YYYY-MM-DD/`.

---

## 7. Acceptable error messages

These messages are **expected** and are not blockers:

- `MFA_REQUIRED` (when Tester D triggers a gated action)
- `NOT_PLATFORM_ADMIN` (when Tester C triggers a gated action)
- Self-approval refused / "cannot approve your own request"
- "No Governance Record export requests" (empty state on the list panel)
- Validation errors when an invalid UUID is entered into the preview panel

These messages are **blockers**:

- Any 5xx server error visible to the tester
- Any uncaught client-side exception (white screen / "Something went wrong")
- Any download or "ready to download" wording
- Any temporary / signed URL appearing
- Any raw legal-hold reason / raw sanctions / raw PEP / raw adverse-media payload
- Any indication that the Batch 7C smoke runner ran against live data

---

## 8. Escalate immediately if you see

- A file actually downloads
- A "Download" / "Generate" / "Prepare" / "Destroy" button appears
- A temporary link or signed link is rendered
- A non-admin user can see the HQ Governance Records → Export sub-tabs
- An admin without AAL2 can complete a gated action
- Self-approval succeeds
- Status changes to anything other than the documented states
- Any raw sensitive payload appears in the preview or list view
- The Batch 7C smoke runner stops refusing the production-tier backend

---

## 9. Pass / fail table

| # | Scenario | Tester role | Expected result | Actual result | Pass / Fail | Screenshot filename | Notes |
|---|---|---|---|---|---|---|---|
| A | Platform admin sees all four sub-tabs | platform_admin (AAL2) | All sub-tabs render | | | `b10-safety-badges.png` | |
| B | Non-admin denied at `/hq` | non-admin | Access denied / not visible | | | `b10-non-admin-blocked.png` | |
| C1 | MFA-unelevated admin blocked from list | platform_admin (no AAL2) | `MFA_REQUIRED` | | | `b10-mfa-required.png` | |
| C2 | MFA-unelevated admin blocked from preview | platform_admin (no AAL2) | `MFA_REQUIRED` | | | | |
| D | Request created, enters awaiting approval | platform_admin (AAL2) | Status = awaiting approval; default redaction mode = `redacted_client_safe`; no file | | | `b10-req-success.png` | |
| E1 | Self-approval blocked | platform_admin (AAL2) | Refusal message | | | `b10-approve-self-blocked.png` | |
| E2 | Second-admin approval succeeds | second platform_admin (AAL2) | Status = approved; no file | | | `b10-approve-success.png` | |
| F | List shows approved row + safe legal-hold summary only | platform_admin (AAL2) | Row visible; no raw legal-hold reason | | | `b10-list-approved.png` | |
| G | Preview renders redacted payload + manifest | platform_admin (AAL2) | Preview + manifest; no raw payload; no file | | | `b10-preview.png` | |
| H | Negative safety scan clean across C–G | all | No forbidden surfaces visible | | | | |

---

## 10. What this QA pack does NOT change

- No runtime behaviour changes for request / approval / list / preview.
- No file generation, download, signed/temporary link, prepare, or destroy behaviour is introduced.
- No `Blob`, `Content-Disposition`, `URL.createObjectURL`, `text/csv`, `application/pdf`, or storage upload surfaces are introduced.
- No DATA-004 surface (cron, cold-storage, archive, retention) is touched.
- The Batch 7C production guard is not weakened — it must remain refused on the connected backend throughout this QA.

---

## 11. Sign-off

| Field | Value |
|---|---|
| QA run date | |
| Lead tester | |
| Second admin (for approval test) | |
| Non-admin tester | |
| MFA-unelevated tester | |
| Overall result | PASS / PASS WITH NOTES / FAIL |
| Blockers found | |
| Notes | |
| Evidence folder | `batch-10-qa-YYYY-MM-DD/` |

---

*Authoritative source: Batches 1–9 implementation + this Batch 10 manual QA pack. Generated as part of Admin Export Controls Batch 10 — Production-Safe Manual QA Pack.*
