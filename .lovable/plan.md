# V1 AI Light-Intel Completion Path — Build Plan

Before writing any code I want to align on scope, because a large portion of this spec is already implemented under different names. Building all 40 sections verbatim as a single change would (a) duplicate live tables/edge functions and (b) take many turns. I propose a phased plan that maps the spec to what already exists, lands the real gaps, and explicitly defers what is out of V1.

## What already exists (verified)

Edge functions (deployed, in repo):

- `ai-interpret-trade-request`, `ai-source-counterparties`, `ai-proposed-match-decision`
- `ai-outreach-draft-v2`, `ai-outreach-draft-v2-decision`
- `ai-poi-intelligence-note`, `counterparty-intel-auto`
- `facilitation-outreach-send`, `facilitation-outreach-escalate`, `facilitation-outreach-escalation-resolve`, `facilitation-outreach-template-status`, `facilitation-outreach-candidate-add`

Tables (verified in `<supabase-tables>`):

- `ai_trade_request_interpretations`, `ai_proposed_matches`, `ai_outreach_drafts_v2`, `ai_poi_intelligence_notes`, `ai_do_not_contact_rules`, `ai_call_meter`, `ai_provider_state`
- `match_counterparty_intel`, `counterparties`, `engagement_outreach_drafts`, `engagement_outreach_logs`
- `facilitation_cases`, `facilitation_case_events`, `facilitation_case_evidence`, `facilitation_outreach_templates`, `facilitation_outreach_candidates`, `facilitation_outreach_sends`, `facilitation_compliance_escalations`, `facilitation_do_not_contact_rules`, `facilitation_case_events`

UI (verified):

- `/hq/ai-suggestions` with `AiSuggestionsQueuePanel`, `AiOutreachDraftV2Panel`, `AiPoiIntelligencePanel`, `AiSuggestionLauncher`
- Match-page `CounterpartyIntelPanel` (read-only, auto-run)

So the platform already implements ~60% of the spec. What is missing is mostly: lifecycle status vocabulary, staleness/expiry, usage limits, demo-mode labelling, outcome tracking, originator-visible approved summary, and consolidated analytics.

## Spec → existing surface mapping


| Spec section                                       | Status                       | Maps to                                                                                                             |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1 Trigger on match (unknown counterparty)          | Partial                      | `match_counterparty_intel` auto-run exists; **gap**: no auto-trigger on `matches` insert for unknown counterparties |
| 2 Permissions (platform_admin/operator only)       | Done                         | `is_admin()` gates `/hq/ai-suggestions`; RLS on AI tables                                                           |
| 3 Data to collect                                  | Partial                      | `ai_proposed_matches` columns; **gap**: explicit `source_url`/`source_title`/`date_checked` per field               |
| 4 Permitted sources                                | Partial                      | `data_source_registrations` + `data_sources`; **gap**: per-finding `source_type` enum                               |
| 5 Ranked shortlist (top 5, expand to 10)           | Done                         | `ai-source-counterparties` returns ranked list; queue UI already supports filter                                    |
| 6 Confidence label (no "Verified")                 | Mostly                       | `discovery_confidence` field on `ai_proposed_matches`; **gap**: audit label strings in UI                           |
| 7 Risk flags (non-blocking)                        | Done                         | Existing risk fields on `ai_proposed_matches`                                                                       |
| 8 Known vs unknown                                 | **Gap**                      | No branch logic; needs auto-run flag                                                                                |
| 9 No-result state + widen criteria                 | Partial                      | Toast added last turn; **gap**: admin task creation                                                                 |
| 10 Admin review queue actions                      | Mostly Done                  | Queue panel exists; **gap**: assign, mark duplicate, escalate-to-WaD actions                                        |
| 11 Versioned edits (original/edited/approved)      | **Gap**                      | `ai_outreach_drafts_v2` has versions; `ai_proposed_matches` does not                                                |
| 12 Outreach drafting (email only)                  | Done                         | `ai-outreach-draft-v2`                                                                                              |
| 13 Manual send                                     | Done                         | `facilitation-outreach-send` requires explicit human action                                                         |
| 14 Outreach structure                              | Done                         | Template enforced                                                                                                   |
| 15 Forbidden info in first outreach                | Partial                      | Templates redact; **gap**: server-side validator scanning for buyer/seller/price/volume                             |
| 16 Outreach templates per role                     | Done                         | `facilitation_outreach_templates`                                                                                   |
| 17 Internal tasks                                  | **Gap**                      | No generic task table; could overlay on `facilitation_case_events`                                                  |
| 18 AI intel status vocabulary                      | **Gap**                      | Status enum needs broadening (`stale`, `bounced`, `wrong_contact`, etc.)                                            |
| 19 External user actions                           | Done                         | RLS denies external roles                                                                                           |
| 20 Governance Record / Memory                      | Done                         | `event_store` + audit canonicalisation guard scripts already enforce this                                           |
| 21 Source evidence (URL/title/snippet)             | **Gap**                      | Need `ai_intel_sources` child table or JSONB column with required keys                                              |
| 22 Staleness (30d) / expiry (90d)                  | **Gap**                      | No `stale_at`/`expires_at` columns                                                                                  |
| 23 No automatic reruns                             | Done                         | Manual only today                                                                                                   |
| 24 Analytics                                       | Partial                      | Some metrics in event_store; **gap**: consolidated `/hq/ai-suggestions/analytics` view                              |
| 25 Feedback reasons (fixed enum)                   | **Gap**                      | Free-text today                                                                                                     |
| 26 Forbidden AI actions                            | Done                         | Enforced by separation of `ai-*` (advisory) vs `atomic_*` RPCs (binding)                                            |
| 27 Contact path rules (company-level)              | Partial                      | Templates default to `info@`; **gap**: enum constraint                                                              |
| 28 Email verification                              | **Gap**                      | No provider wired; needs feature flag + manual-task fallback                                                        |
| 29 Outcome tracking                                | Partial                      | `facilitation_outreach_sends` has `outcome`; **gap**: full enum                                                     |
| 30 Positive response workflow                      | **Gap**                      | No task generation                                                                                                  |
| 31 Originator visibility (approved summaries only) | **Gap**                      | No client-facing approved summary panel                                                                             |
| 32 Admin dashboard tabs                            | Partial                      | Single panel; **gap**: tabs for Pending/Approved/Drafts/Sent/Responses/Failed/Stale/Analytics                       |
| 33 Assignment + due dates                          | **Gap**                      | No `assigned_to`/`due_at` on AI rows                                                                                |
| 34 SLA targets                                     | **Gap**                      | Needs `lifecycle-scheduler` job                                                                                     |
| 35 Demo/test mode                                  | Partial                      | `admin_settings.test_mode_bypass` exists; **gap**: AI-specific demo seed labelling                                  |
| 36 Provider failure handling                       | Partial                      | `ai_provider_state` retry exists; **gap**: admin task on material failure                                           |
| 37 Provider usage/cost view                        | Partial                      | `ai_call_meter`; **gap**: dashboard                                                                                 |
| 38 Usage limits (3 runs/match, 10 results/run)     | **Gap**                      | Not enforced server-side                                                                                            |
| 39 No external API exposure                        | Done                         | Web-only, no public endpoints                                                                                       |
| 40 Minimum V1 deliverables                         | Composite — see phases below | &nbsp;                                                                                                              |


## Proposed phases (one PR per phase, each behind a feature flag where risky)

### Phase 1 — Schema foundations (1 migration)

- Add to `ai_proposed_matches`: `assigned_to uuid`, `due_at timestamptz`, `stale_at timestamptz` (default `created_at + 30d`), `expires_at timestamptz` (default `+90d`), `feedback_reason text` (CHECK against enum), `original_payload jsonb`, `edited_payload jsonb`, `approved_payload jsonb`, `client_visible boolean default false`.
- New `ai_intel_sources(id, proposed_match_id fk, field_name, source_url, source_title, source_type, snippet, checked_at, confidence)` with RLS = platform_admin only.
- New `ai_intel_tasks(id, match_id, kind, owner, due_at, status, created_by, ...)` for the V1 task list (Sections 17, 30).
- Broaden status CHECK on `ai_proposed_matches` to the Section 18 vocabulary.
- All new tables with GRANTs + RLS per project rules.

### Phase 2 — Lifecycle (auto-trigger, staleness, usage limits)

- DB trigger on `matches` insert: when counterparty is unknown (no `counterparty_id` resolved), enqueue an `ai-source-counterparties` run via `pg_net` to keep edge calls async.
- `lifecycle-scheduler` adds: mark `stale` after 30d, `closed` after 90d unless linked to POI/WaD/match.
- Server-side enforcement in `ai-source-counterparties`: ≤3 runs per `match_id`, ≤10 results per run, surface 429 with `Retry-After`.

### Phase 3 — Review queue completeness

- Extend `AiSuggestionsQueuePanel`: assign, mark-duplicate, fixed-enum feedback reasons, original/edited/approved version diff drawer.
- Add tabs: Pending Review · Approved Shortlists · Draft Outreach · Ready to Send · Sent Outreach · Responses · Failed Searches · Stale Intel · Analytics.
- All actions write canonical `ai_review.*` audits (existing guard scripts already enforce the literal set — I will extend the allow-list).

### Phase 4 — Originator-visible approved summary

- New `MatchApprovedAiSummary` component on `/match/:id`, visible only when `ai_proposed_matches.client_visible = true` AND counterparty is on either side of the match.
- Shows: high-level company name, country, role, status badge (search in progress / shortlist under review / outreach in progress / response received / no suitable counterparty / Izenzo reviewing).
- Never shows: raw sources, rejected results, internal notes, confidence number, risk flags.

### Phase 5 — Outreach hardening

- Server-side outreach content validator (rejects buyer/seller identity, price, volume, bank, document refs in first send).
- Manual-send preview already exists; add "final preview" intermediate modal with mandatory confirm checkbox.
- Outcome tracking enum tightened to Section 29 set.

### Phase 6 — Analytics + provider usage panel

- `/hq/ai-suggestions/analytics`: searches run, approved/rejected, bounce rate, replies, POIs created, average discovery confidence, provider usage and estimated cost (from `ai_call_meter` + `ai_provider_state`).

### Phase 7 — Tests + audit guard updates

- Add tests covering Section F (eleven scenarios). Extend `check-ai-review-audit-names.mjs` allow-list with any new canonical literals.

## Explicitly out of V1 (per spec)

Automatic outreach sending; WhatsApp/SMS; external API exposure; automatic learning from feedback; legal/compliance/KYB/WaD/sanctions decisions; hard POI blocking; verified-bank-detail claims; "Verified" labelling on AI confidence; automatic reruns; raw AI output visible to external users.

## What I need before starting

1. **Confirm phase order and that Phase 1 (schema) lands first as a single migration** — every subsequent phase depends on those columns/tables. The migration tool requires explicit approval; I will not write code that references new columns until that migration is approved.
2. **Confirm "approved Izenzo operator" role.** Today only `platform_admin` exists as the canonical super-admin (per `mem://governance/rbac-stage-1-2-canonicalisation`). Options: (a) treat `platform_admin` as the only operator role for V1, or (b) add a new `app_role` value `ai_operator` in Phase 1. I recommend (a) for V1 to avoid an RBAC change.
3. **Confirm originator visibility scope (Phase 4).** Spec says "external users may only view approved summaries." Should the originator see the counterparty's *name* once a summary is approved-for-client-view, or only a status badge? This materially changes data exposure.

Once you confirm phases, role choice, and originator scope, I will start with the Phase 1 migration and stop for approval before each subsequent phase.  
  
Confirmed. Proceed with the phased approach exactly as proposed.

Phase order:

Approved. Start with Phase 1 as a single schema-foundation migration. Do not reference new columns/tables in UI or edge logic until the migration has been applied and verified. After Phase 1, proceed phase-by-phase and stop for approval/verification before each next phase.

Role choice:

Use option (a) for V1. Treat `platform_admin` as the only approved Izenzo operator role for now. Do not add a new `ai_operator` role in V1. We can revisit a separate operator role later if needed, but avoid an RBAC change at this stage.

Originator visibility scope:

For Phase 4, keep originator visibility conservative. The originator should initially see status-only approved summaries, not the counterparty’s full name, unless an admin explicitly marks the specific AI result as `client_visible = true` and approves that company name for client view.

So:

- Default external/originator view = status badge only.

- Approved-for-client-view summary may show high-level status and safe summary text.

- Counterparty name should only show externally if explicitly approved by platform_admin for client view.

- Never show raw sources, rejected results, internal notes, confidence number, risk flags, or unapproved counterparty details externally.

Additional guardrails:

- Keep everything behind existing admin permissions.

- Preserve original AI output, edited output and approved output.

- Every meaningful action must write to Governance Record / Memory.

- No automatic outreach sending.

- No external API exposure.

- No WhatsApp/SMS.

- No hard POI blocking.

- No “Verified” wording for AI confidence.

- No AI legal/compliance/KYB/WaD/payment decisions.

Begin with Phase 1 migration only and return:

1. files changed,

2. migration summary,

3. RLS/security summary,

4. rollback notes,

5. verification steps,

6. any assumptions made.

&nbsp;