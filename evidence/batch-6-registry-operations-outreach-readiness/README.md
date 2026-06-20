# Batch 6 — AI Outreach Drafter, Approval Queue, Admin Operations, Client-Safe Readiness (M013 / M014 / M015 / M017)

## Scope
Builds the controlled operational and demo layer on top of Batches 1–5.

- **M013 AI Outreach Drafter** — AI may draft outreach only. AI must never send.
  Drafts are clearly labelled, edit-history is recorded, every draft tracks
  source context, reason and permitted-use basis, and respects readiness,
  country coverage, provenance, business-decision and DNC gates.
- **M014 Human Approval Queue** — review / edit / approve / reject /
  request changes / cancel / mark do-not-contact / suppress / record manual
  send outcome. Approval ≠ send. Sending is a separate, audited, log-only
  action that never dispatches to an external provider in this batch.
- **M015 Admin Operations Dashboard** — `/admin/registry/operations` cross-
  module counts and warnings with deep links into every Batch 1–5 admin tab.
- **M017 Client-Safe Readiness Dashboard** — `/registry/readiness` plain-
  English module readiness using SSOT bucket copy. Never overclaims.

## Out of scope (intentionally not built)
- No real registry data ingestion.
- No external providers (CIPC, Onfido, GlobalDatabase, B2BHint, Dow Jones,
  Refinitiv, PayFast).
- No external email/SMS/WhatsApp dispatch (Resend, SendGrid, Twilio,
  Mailgun, Postmark) — pinned by `check-registry-batch6-no-auto-send.mjs`.
- No change to Batch 1–5 accepted rules except to display their state safely.
- No raw bank-detail surface anywhere in this batch.

## Database surface
Migration: `supabase/migrations/20260620_batch6_outreach.sql`

Tables (all admin/compliance read; service-role writes only via edge fns):

| Table | Purpose |
|---|---|
| `registry_outreach_templates` | Approved template fragments. |
| `registry_outreach_drafts` | Draft requests + AI output + lifecycle. |
| `registry_outreach_draft_sources` | Source-context snippets per draft. |
| `registry_outreach_draft_edits` | Edit history (before/after). |
| `registry_outreach_draft_events` | Append-only audit. |
| `registry_outreach_approvals` | Human approval queue + decisions. |
| `registry_outreach_do_not_contact` | DNC suppressions. |
| `registry_outreach_send_log` | Manual-send outcome log (no auto-send). |

Status mutations on `registry_outreach_drafts` and
`registry_outreach_approvals` are blocked at the table level via triggers
and must flow through the audited edge functions. `registry_outreach_send_log`
inserts are blocked for non-service callers entirely.

## Edge functions

| Function | Purpose |
|---|---|
| `registry-ai-outreach-draft` | request / generate / needs_review / edit / cancel — AI drafts only, never sends. |
| `registry-outreach-review` | start_review / approve / reject / request_changes / cancel / mark_do_not_contact / suppress_contact. |
| `registry-outreach-log-send` | LOG-ONLY. Records the outcome of a manual external send already carried out. Gated on approved_for_send + an approved approval row + DNC re-check. |
| `registry-admin-operations-summary` | Returns 16 cross-module count/warning sections with deep links. |
| `registry-client-readiness-summary` | Returns module readiness bucketed under the 11 client-safe buckets. |

Audit names (12), all emitted and pinned by
`check-registry-outreach-audit-names.mjs`:

```
registry_outreach_draft_requested
registry_outreach_draft_generated
registry_outreach_draft_edited
registry_outreach_draft_approved
registry_outreach_draft_rejected
registry_outreach_changes_requested
registry_outreach_cancelled
registry_outreach_do_not_contact_added
registry_outreach_suppressed
registry_outreach_send_logged
registry_admin_operations_viewed
registry_client_readiness_viewed
```

## Prebuild guards added
- `check-registry-outreach-draft-state-parity.mjs` — SSOT byte-parity TS↔Deno.
- `check-registry-outreach-approval-state-parity.mjs` — approval states pinned.
- `check-registry-outreach-dnc-parity.mjs` — DNC enforced by every writer.
- `check-registry-outreach-audit-names.mjs` — audit-name coverage.
- `check-registry-batch6-no-auto-send.mjs` — no external dispatcher import + mandatory copy.
- `check-registry-outreach-forbidden-wording.mjs` — AI label + wording-safety wired.
- `check-registry-client-readiness-wording.mjs` — `/registry/readiness` reads SSOT, no "live"/"guaranteed".
- `check-registry-batch6-no-provider.mjs` — no provider integration in Batch 6 surfaces.

## Tests
`src/tests/batch-6-registry-operations-outreach-readiness.test.ts` covers
SSOT parity, draft state machine, audit coverage, AI labelling, forbidden-
wording detection, eligibility/DNC gates, approval-is-not-sending, ops
dashboard wiring, route registration, deploy-manifest + config presence.

## UI
- `/admin/registry/operations` — operations dashboard.
- `/admin/registry/outreach-drafts` — AI draft request + queue.
- `/admin/registry/outreach-approvals` — review/approve/reject + log-send.
- `/admin/registry/do-not-contact` — DNC management.
- `/registry/readiness` — client-safe bucketed readiness page.

Mandatory on-screen copy (also enforced by guard):
> AI may draft outreach, but it must not send outreach automatically. A human
> reviewer must approve the wording, permitted-use basis and recipient before
> any send is logged or performed.
