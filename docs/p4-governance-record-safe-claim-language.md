# P-4 Governance Record — Safe Claim Language

> Approved wording for client-facing communication about the P-4
> Governance Record closeout. Pair with
> `docs/p4-governance-record-closeout-proof-pack.md` for evidence.

---

## ✅ Approved claims (safe to send)

### Headline

> **All eighteen sensitive admin endpoints are now atomic on the canonical
> Governance Record write path with live database rollback proof. If the
> business action fails, no Governance Record event is written. If the
> Governance Record event cannot be written, the business action rolls
> back.**
>
> Legacy mirror rows for legal hold and pre-RPC external side effects for
> manual overrides remain best-effort by design and are not claimed to be
> transactional.

### Coverage statement

> Eighteen of eighteen sensitive admin endpoints are covered, across seven
> batches: credit grants (F1), refund decisions (F2), payment-dispute
> decisions (F3), billing / compliance / residency holds (F4), trade-request
> exceptions (F5), counterparty and match corrections plus manual overrides
> (F6), and legal hold (F7).

### Governance Record UI

> The Governance Record is available as an HQ-only view, anchored on
> matches, POIs, engagements and trade requests. It provides search,
> filtering, a merged chronological timeline, an event detail drawer,
> a blocked-action highlight, and a demo/test label. Non-HQ users cannot
> access the view, and the underlying tables enforce the same restriction
> via row-level security.

### Canonical writer

> The event store is the canonical source for new enterprise governance
> events. All canonical writes are performed by backend security-definer
> functions, with hash-chain linkage, idempotency keys, policy versioning
> and posture snapshots. Legacy audit sources remain readable for
> historical reconciliation but are not rewritten by new code paths.

### Manual HQ notes and corrections

> Platform administrators can record manual HQ notes and corrections
> against any governance-anchored aggregate. The original event is
> preserved unchanged; corrections appear as new events that reference
> the original. AAL2 is required for every correction endpoint.

### Reason-code normalisation

> Legacy, system and payment reason codes are normalised on write. The
> original reason is preserved alongside the normalised code. Mismatches
> currently produce a warning rather than a block.

### Waiver / bypass lifecycle

> Test-mode bypass grants are issued by HQ, expire automatically on a
> scheduled sweep, and are surfaced in a global banner whenever active.
> Every use is audited. Bypass is refused outright in the production tier.

### MFA / AAL2

> Every sensitive admin endpoint requires AAL2 step-up authentication.
> A prebuild guard fails the build if any admin endpoint in the registry
> is missing the AAL2 assertion.

---

## ❌ Do-not-claim wording

Do **not** send any of the following without further engineering work
and explicit re-scoping:

- ❌ "All Governance Record events are atomic." — Payment webhooks are
  sequential by design and are out of scope.
- ❌ "Legal hold is fully atomic end-to-end." — The canonical event and
  the legal-hold mutation are atomic; legacy mirror rows
  (`audit_logs`, `admin_audit_logs`) are best-effort.
- ❌ "Manual overrides are fully atomic end-to-end." — External side
  effects (screening rerun, evidence regen) run before the atomic RPC
  and are best-effort.
- ❌ "Reason codes are enforced." — Current behaviour is WARN-only;
  strict BLOCK mode is deferred.
- ❌ "Waivers are enforced into POI / WaD / execution / finality
  progression." — Enforcement into progression gates is deferred beyond
  the existing test-mode bypass paths.
- ❌ "Counterparties can view the Governance Record." — HQ-only in
  Phase 1; counterparty-visible view is deferred.
- ❌ "A PDF evidence pack is available." — Deferred.
- ❌ "Governance Records can be exported to SIEM / Splunk / Datadog." —
  Excluded.
- ❌ "Raw provider payloads are viewable." — Excluded.
- ❌ "The Basic Memory Record is live." — Build deferred.
- ❌ "The governed-documentation foundation is live." — Deferred unless
  separately approved.
- ❌ "Production is healthy right now" on the basis of these proofs
  alone. — Proofs run in `BEGIN … ROLLBACK` against staging; live
  readiness requires the release-gate checks in `docs/launch-runbook.md`.

---

## Recommended pairing

When sending the headline claim, attach or link:

- `docs/p4-governance-record-closeout-proof-pack.md` (evidence)
- `docs/governance-rollback-proof.md` (how the live proof runs)
- `docs/deferred-policy-register.md` (what is deferred and why)
