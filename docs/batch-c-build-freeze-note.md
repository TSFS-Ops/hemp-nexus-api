# Batch C — Internal Build Freeze Note

**Status:** Approved as-is by client (Daniel Davies, Izenzo) — *"No — approved to proceed."*

**Effective:** from the date of client approval of the Challenge
Workflow review pack.

## Decision

Batch C (Challenge Workflow) is **frozen**. No further Batch C code
work should begin unless separately and explicitly instructed by the
client.

## What is approved and in-scope (no further changes)

- The term "Challenge".
- "Progression is paused" wording and the paused-banner behaviour.
- Challenge raising form and subject categories.
- Comment thread (post-only).
- Evidence upload (25 MB per file, SHA-256 fingerprint).
- Ordinary organisation members read-only.
- Admin Challenge Queue.
- Outcome labels (closed list).
- "Closed — No Action".
- "Admin Override Closure" with the four governance fields:
  - Reason category
  - Internal approval reference
  - Regulator reference (or *Not applicable*)
  - Written reason

## Explicitly out of scope under this approval

The following are **not** part of Batch C and must not be built under
this approval. They may be considered as separate, future-scope
items:

- Evidence download.
- Evidence delete.
- Comment edit / delete.
- In-app or email notification UI for Challenges.
- Rating impact from Challenge outcomes.
- Any change to legacy disputes.
- Any new progression gates triggered by Challenges beyond the
  existing Open / Under review pause.

## Non-blocking deferred item

- The Admin review drawer currently shows the closed-by admin's UUID
  rather than a human-readable name. Cosmetic only, deferred to a
  later batch.

## Rule

Any request that touches the items in *"What is approved and
in-scope"* or *"Explicitly out of scope"* must be raised as a new,
separately-approved change. Do not silently extend Batch C.
