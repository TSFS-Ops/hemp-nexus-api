# Deferred Policy Register

> Every item here is a **policy decision** owned by the client (or Izenzo policy). Each has a current safe default already shipped in code, so the platform is operationally safe pending sign-off. Resolving these items unlocks tightening, not basic function.

Format for every entry:
- **Current safe default** — what the platform does today
- **Why deferred** — what blocks an engineering-only call
- **Owner** — Client / Izenzo policy
- **Launch impact** — whether go-live needs this resolved
- **Recommended decision date** — relative to go-live (T-0)

---

## 1. Final document taxonomy and per-type expiry windows
- **Current safe default**: Document categories accepted at upload; no per-type expiry enforcement beyond compliance hold (`storage_deletion_queue`, 30 days).
- **Why deferred**: Expiry windows are jurisdiction- and product-class-specific.
- **Owner**: Client (Compliance).
- **Launch impact**: Not blocking — POI mint still requires ≥1 doc per side.
- **Recommended decision date**: T-30 days.

## 2. Whether any evidence override should ever be allowed
- **Current safe default**: **No waivers**. Bilateral POI requires ≥1 doc per side, server-enforced (`MIN_EVIDENCE_PER_SIDE`).
- **Why deferred**: Some operators may want an audited admin override for exceptional cases.
- **Owner**: Client (Compliance + Legal).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-14 days.

## 3. Final notification template category matrix
- **Current safe default**: Allow-listed event categories in `d4b-admin-notify-event-allowlist`. Per-template wording is shipped but not formally categorised.
- **Why deferred**: Marketing/brand sign-off on tone and category labels.
- **Owner**: Client.
- **Launch impact**: Not blocking; cosmetic.
- **Recommended decision date**: T-30 days.

## 4. Final event-to-role notification routing matrix
- **Current safe default**: Routing in `notification-dispatch` covers core events; admin/user split present.
- **Why deferred**: Compliance vs Legal vs Director role splits depend on client org chart.
- **Owner**: Client.
- **Launch impact**: Not blocking — admin path catches everything.
- **Recommended decision date**: T-14 days.

## 5. Exact email-log anonymisation retention window
- **Current safe default**: PII retained in `email_send_log` indefinitely pending policy.
- **Why deferred**: Privacy regime varies (GDPR vs local).
- **Owner**: Client (Privacy/DPO).
- **Launch impact**: Not blocking for go-live but should be set before steady-state.
- **Recommended decision date**: T-7 days.

## 6. Org deletion policy
- **Current safe default**: Account self-delete soft-deletes profile with 30-day grace; no automated org-level hard-delete sweeper.
- **Why deferred**: Hard-delete cadence and audit retention window are policy.
- **Owner**: Client + Izenzo policy.
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-30 days.

## 7. Whether hash-chain tamper evidence is required beyond immutability triggers
- **Current safe default**: Append-only triggers + SHA-256 seal on WaD; no rolling Merkle-style chain.
- **Why deferred**: Required only for regulated-archive use cases.
- **Owner**: Client (Compliance).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-60 days.

## 8. Final canonical counterparty rules
- **Current safe default**: Discovery uses 4-layer search; canonical entity merge is admin-driven.
- **Why deferred**: Merge thresholds depend on client risk appetite.
- **Owner**: Client.
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-30 days.

## 9. Jurisdiction mismatch — block or warn
- **Current safe default**: WaD gate enforces jurisdiction at hard-verification; mid-flow it warns.
- **Why deferred**: Whether a mid-flow mismatch should hard-block POI mint.
- **Owner**: Client (Compliance).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-14 days.

## 10. Break-Glass policy beyond AAL2 + password reauth
- **Current safe default**: AAL2 + password reauth, IP + UA captured, audited.
- **Why deferred**: Whether to additionally require dual-control or time-windowed approval.
- **Owner**: Client (Security).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-30 days.

## 11. Auto-close of reconciliation risk items as system actor
- **Current safe default**: Reconciliation jobs auto-close machine-created risk items when drift clears, audited as `reconciliation_auto_close`.
- **Why deferred**: Whether human acknowledgement is required even when drift clears.
- **Owner**: Client (Operations).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-14 days.

## 12. Final public launch status wording
- **Current safe default**: Internal "complete" used in reports; no public-facing launch statement.
- **Why deferred**: Marketing/PR.
- **Owner**: Client.
- **Launch impact**: Blocking go-live communications (not the platform).
- **Recommended decision date**: T-3 days.

## 13. Demo rows — hide by default vs labelled operator toggle
- **Current safe default**: Demo orgs excluded from revenue/HealthBoard counters; not visible behind a toggle.
- **Why deferred**: Whether operators want a one-click "show demo" toggle for QA.
- **Owner**: Client (Operations).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-14 days.

## 14. AAL2 block vs warn per sensitive export category
- **Current safe default**: Sensitive exports block on `aal_required` via `auditedDownloadCSV`.
- **Why deferred**: Whether any category should warn rather than block.
- **Owner**: Client (Security).
- **Launch impact**: Not blocking.
- **Recommended decision date**: T-14 days.

---

## Summary

None of the deferred items block platform operation. Items 5 and 12 are time-sensitive for go-live; the rest can be ratified in the first 30–60 days post-launch.
