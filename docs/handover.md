# Handover — for the Client

> Plain-English summary of what has been built, what is proven, what is not proven, and what still needs your decision before go-live. Pair this document with `docs/closeout-report.md` (detail), `docs/deferred-policy-register.md` (your decisions), and `docs/launch-runbook.md` (operations).

## What has been hardened

The platform now has guardrails covering the whole trade lifecycle:

- **Identity and roles** — Only one canonical super-admin role, and the database itself refuses to assign the old one. Sensitive actions require strong authentication (AAL2).
- **Trade lifecycle** — Trade requests, matches, POIs (Proof of Intent), engagements, and WaDs (Without a Doubt) all follow a single, enforced state machine. The database blocks impossible states (e.g. a counterparty trading against themselves).
- **Money** — Credits, purchases, refunds, and balances are reconciled against the ledger automatically. Drift opens a risk item; when it clears, the item closes itself with an audit trail.
- **Documents and evidence** — Bilateral POIs require at least one supporting document from each side. No waivers in code.
- **Notifications and webhooks** — Every canonical event has an audited dispatch path with replay protection. Missing side-effects are detected and surfaced.
- **Production safety** — Test-mode bypass cannot run in production. Seed scripts refuse to run in production and write an audit row if attempted. Demo organisations are excluded from revenue and operational counters.
- **Operations** — A HealthBoard tile, "Closeout Drift", reports any unresolved reconciliation issues live. If the underlying query fails, the tile turns red, not green — there is no false-positive "all clear".

## What "complete" means in this handover

"Complete" means:

1. All 22 work batches (A–V) have shipped their controls.
2. Each batch has at least one automated test pinning its behaviour in the repository.
3. Static guards run at every build and block drift.
4. A closeout report enumerates everything.

"Complete" does **not** mean:

- That the live production environment has been validated this minute.
- That every policy decision you own has been answered.
- That go-live communications have been signed off.

## What the tests prove

Running `npm run test:regression` confirms that the **repository contract** matches what was specified:

- The code paths exist.
- The status enums, RPC names, and audit shapes are pinned.
- The static guards are wired into the build.

## What the tests do **not** prove

- That the live database has all migrations applied.
- That every edge function is deployed at the current code version.
- That cron jobs are running on schedule.
- That secrets are configured in the live tier.

To prove those, the launch runbook calls a live snapshot script (`scripts/closeout-snapshot.mjs`) that runs against the live database and produces a dated artefact.

## What you still need to decide

Twelve items remain — none block the platform's operation, and most can be settled after launch. See `docs/deferred-policy-register.md`. The two with the tightest timelines are:

- The email-log anonymisation retention window (privacy).
- The final public launch wording (PR).

## How to read the HealthBoard

- **Closeout Drift tile — green**: no unresolved critical drift.
- **Amber**: drift items below critical severity exist; ops should review.
- **Red ("rose")**: either critical drift is open, or the drift query itself failed. Either way, do not declare go-live healthy.

The tile is intentionally designed to fail visibly rather than silently.

## How to use the release gate and launch runbook

- `RELEASE_GATE.md` is the **15-minute pre-ship checklist**. Use it for any publish.
- `docs/launch-runbook.md` is the **launch event** procedure, including who signs off what and what evidence to attach.
- Engineering runs the commands; Operations confirms the live signals; you sign off the policy register and the launch wording.

## What we are not claiming

We are not telling you the platform is "production ready" without the runbook, release gate, and live-evidence pack attached. We are telling you: **the repository contract is complete and pinned; the runbook is the bridge from here to live.** When the runbook's evidence pack is attached, you will have a defensible basis for go-live.

Current verdict: **READY_FOR_DANIEL_VISIBLE_UAT_WITH_KNOWN_LEGACY_TEST_FAILURES_AND_DEFERRED_DATA002**. DATA-002 destructive deletion remains deliberately deferred (Phase 2 hardening); Daniel-visible UAT is still outstanding; known legacy regression cleanup is tracked separately.

