# Requester / Trader — Manual Operator Checklist (Facilitation Phase 2)

**Sign-in identity required:** `requester` or `trader` on the raising organisation (e.g. `@test.izenzo.co.za` requester fixture).
**Route:** `/desk/facilitation/:id` for a case the user's organisation raised.

> Use seeded UAT fixtures only. Do not run this against live client or production-like data.

---

## A. Milestone Page Visibility

- [ ] **A1.** Can open the facilitation milestone page for a case raised by the user's organisation.
- [ ] **A2.** Page renders a coarse outreach state only (e.g. "Contacting potential counterparties", "Awaiting response", "Counterparty engaged", "Closed").
- [ ] **A3.** No counts of internal candidates, gate evaluations, or attempts are exposed.

## B. Negative-Visibility Checks (must NOT be visible)

- [ ] **B1.** Candidate email addresses are NOT visible.
- [ ] **B2.** Template bodies / subjects are NOT visible.
- [ ] **B3.** Internal triage notes are NOT visible.
- [ ] **B4.** Pre-send gate reasons are NOT visible.
- [ ] **B5.** Duplicate-send details (idempotency keys, prior attempts) are NOT visible.
- [ ] **B6.** DNC rule details are NOT visible.
- [ ] **B7.** Raw audit payloads are NOT visible.
- [ ] **B8.** Event logs (timeline of internal facilitation actions) are NOT visible.

## C. API / RLS Negative Checks

- [ ] **C1.** Direct GET against `facilitation_outreach_candidates` for the case → returns no rows (RLS).
- [ ] **C2.** Direct GET against `facilitation_outreach_templates` → returns no rows for non-HQ roles.
- [ ] **C3.** Direct GET against `facilitation_dnc_rules` → returns no rows.
- [ ] **C4.** Direct GET against `facilitation_outreach_audit` (or equivalent) → returns no rows.

## D. Sign-off

- [ ] **D1.** All A–C items ticked.
- [ ] **D2.** Screenshot `18-requester-milestone-coarse-state-only.png` captured.
- [ ] **D3.** Signed by: _________________________ Date: __________
