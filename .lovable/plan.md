# AI Counterparty Intelligence & Match Review

This is a large feature. I'll deliver it in **5 sequential batches**, each independently testable, behind `platform_admin` and `/hq/ai-suggestions`. No autonomous outreach in any batch. Phase 1 AI Outreach Drafter (already CLOSED) and the existing `engagement_outreach_drafts` table are left untouched; this feature uses its own tables to avoid semantic drift.

## Hard guarantees (every batch)

- `platform_admin` only at route, RLS, and edge-function layers.
- No send/dispatch path. No automatic POI/WaD/verification/match creation.
- Banner + wording rules enforced; "verified" never used by AI surfaces.
- Every action audited to `admin_audit_logs` with canonical `ai_review.*` action codes.
- Do-not-contact rules checked before any draft creation (warn/block).
- 30-day stale badge derived, never auto-archived.

## Batch 1 — Data layer + interpretations + sourcing

**New tables (all `org_id`-less, HQ-scoped, RLS = `is_admin()` only, service_role full):**

- `ai_trade_request_interpretations` — structured AI read of a trade request.
- `ai_proposed_matches` — ranked proposed counterparties (status enum, fit_label, confidence_level, risk_flags jsonb, source_references jsonb).
- `ai_outreach_drafts_v2` — draft messages (separate from Phase 1 `engagement_outreach_drafts` to avoid coupling).
- `ai_poi_intelligence_notes` — public-source intel attached to a POI/trade request.
- `ai_do_not_contact_rules` — pre-built block list.
- `ai_review_audit` view over `admin_audit_logs` filtered to `ai_review.*` actions.

All with GRANTs (`authenticated` SELECT only via RLS `is_admin()`, `service_role` ALL), RLS enabled, policies routed through `is_admin()`.

**Edge functions:**

- `ai-interpret-trade-request` — Lovable AI Gateway, tool-call extraction; writes interpretation row + audit.
- `ai-source-counterparties` — reads only approved internal sources (organisations, matches, pois, counterparty_intel, intel-crawl outputs); writes ranked `ai_proposed_matches` rows + audit. **No external scraping, no LinkedIn/Hunter/ZoomInfo.**

Prebuild guard `scripts/check-ai-review-audit-names.mjs` to pin canonical action codes.

## Batch 2 — Review UI (read-only first)

- Route `/hq/ai-suggestions` (label "AI Counterparty Intelligence") behind `RequireAuth role="platform_admin"`.
- Queue table with filters: status, confidence, fit, role, jurisdiction, risk-flagged, escalated, assigned reviewer, stale (>30d).
- Detail drawer: interpretation, rationale, source summary, references, risk flags, audit history.
- Mandatory advisory banner at top.
- Stale badge derived client-side; "Source reference not available." fallback.

## Batch 3 — Admin actions + override + do-not-contact

- Edge function `ai-proposed-match-decision` — under_review / approve / reject / archive / needs_more_research / escalate / assign_reviewer / add_note / override_confidence. Writes status transitions + audit. Never sends.
- Edge function `ai-do-not-contact-rules` — CRUD for rules; idempotent.
- UI action bar + reviewer-note dialog + DNC rule manager.

## Batch 4 — Outreach drafting (approved matches only, manual send)

- Edge function `ai-generate-outreach-draft-v2` — preconditions: proposed match `status='approved'`, DNC check (block + audit if hit). Generates draft via Lovable AI Gateway; writes `ai_outreach_drafts_v2` row with `draft_status='draft_created'`. **No send path.**
- Edge function `ai-outreach-draft-decision-v2` — edit / approve_for_send / reject / archive / mark_sent_by_human (manual marker only, no provider call).
- UI: draft editor, approval workflow, "Send manually" button = marks `sent_by_human` and audits; copy-to-clipboard helper for the admin to paste into their own email client.

## Batch 5 — POI intelligence notes + escalation surfaces

- Edge function `ai-generate-poi-intelligence` — reads approved public sources only via existing intel-crawl/counterparty-intel pipelines; writes `ai_poi_intelligence_notes`.
- UI section with strict separation: Verified data / Paid-provider / Public-source / Social-media / AI interpretation, each labelled; mandatory caveat banner.
- Escalation badges + escalated-only filter; escalation never triggers external contact.

## Technical notes

- All AI calls go through Lovable AI Gateway (`google/gemini-3-flash-preview` default) via existing `ai-guard` envelope; per-org meter not applicable (HQ-scoped) — use a fixed `org_id = SYSTEM_ORG_ID` for the guard meter.
- `ai_outreach_drafts_v2` is intentionally separate from Phase 1 `engagement_outreach_drafts` (which is tied to `poi_engagements`). The Phase 1 drafter and admin facilitation queue are not modified.
- New canonical audit codes: `ai_review.trade_request_interpreted`, `ai_review.counterparty_sourced`, `ai_review.proposed_match_created|reviewed|approved|rejected|archived|escalated|needs_more_research`, `ai_review.confidence_overridden`, `ai_review.outreach_draft_created|edited|approved|sent_by_human|rejected`, `ai_review.poi_intelligence_created`, `ai_review.risk_flag_added`, `ai_review.escalation_created`, `ai_review.admin_override_applied`, `ai_review.do_not_contact_rule_created|deactivated`.
- Memory rule honoured: NEVER use "Civilisation OS"; UI label is "AI Counterparty Intelligence".
- No `.md` files created; all closeouts delivered inline in chat.

## What I'm asking before I start

1. **Confirm batch sequencing** — proceed Batch 1 first (schema + 2 edge fns, no UI), wait for your closeout, then Batch 2.
2. **Confirm separate tables** — `ai_outreach_drafts_v2` and `ai_proposed_matches` as new tables, not extensions of Phase 1 `engagement_outreach_drafts`. (Recommended — keeps Phase 1 untouched and avoids semantic drift.)
3. **Confirm AI model** — default `google/gemini-3-flash-preview` via Lovable AI Gateway for all five edge functions.

On approval I'll start Batch 1 (migration + two edge functions + audit-name guard script) and return a closeout in the same format as previous batches.  
  
Yes — I would approve this. The structure is sensible, controlled, and matches exactly what we discussed: **build the agentic intelligence layer, but not autonomous external outreach yet.**

I would send back this:

Confirmed — please proceed with Batch 1 first.

Answers to your three questions:

1. **Batch sequencing confirmed**  
Proceed with Batch 1 first: schema, the two edge functions, and the audit-name guard script. Please return the Batch 1 closeout before starting Batch 2.
2. **Separate tables confirmed**  
Yes, use new dedicated tables, including `ai_outreach_drafts_v2` and `ai_proposed_matches`. Do not extend or modify the existing Phase 1 `engagement_outreach_drafts` table. Keeping this feature separate is the right approach and avoids semantic drift.
3. **AI model confirmed**  
Confirmed: use `google/gemini-3-flash-preview` via the Lovable AI Gateway for the AI edge functions.

A few important guardrails to preserve throughout:

- No autonomous external outreach in any batch.
- No send/dispatch provider call.
- No automatic POI creation.
- No automatic WaD creation.
- No automatic verification claim.
- No automatic formal match creation.
- AI may interpret, source, assess, rank, explain, draft and escalate.
- A human must trigger any external contact.
- Do-not-contact rules must be checked before draft creation.
- All AI actions must be audited under canonical `ai_review.*` action codes.
- The UI must continue using “AI Counterparty Intelligence”, not “autonomous agent”.
- The product must never describe AI-sourced counterparties as “verified” unless the actual verification workflow has confirmed them.

Please start Batch 1 and return the closeout in the same format as the previous batches.

One small note: I would keep the phrase **“manual send”** very carefully controlled. Ideally the platform should **not actually send** in this phase. The safest wording is:

“mark as sent by human”

or:

“copy draft for manual sending outside the platform”

That avoids accidentally creating a send path too early.