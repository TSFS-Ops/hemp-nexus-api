---
name: P011 Evidence-Confidence Counterparty Rating
description: Two parallel counterparty rating systems exist — pick the right one by intent
type: feature
---
The codebase has TWO parallel counterparty rating products:

1. **Reputation rating** (`counterparty_ratings` table, `CounterpartyRatingBadge`):
   four-pillar deal-history score (platinum / gold / silver / bronze / new /
   insufficient_history). Derived from settled-deal performance.

2. **Evidence-confidence rating** (P011, `counterparty_evidence_ratings` table,
   `EvidenceRatingBadge`, `EvidenceRatingDrawer`): 5-band signal — limited_information,
   public_source_supported, admin_reviewed, verification_complete, flagged.
   Derived from public-source signals + live KYB / sanctions / UBO + evidence + admin review.
   Methodology v1.0 documented at `/docs/counterparty-rating-methodology`.

Do not merge them. The reputation badge is for trade-history confidence; the
evidence badge is for verification-evidence confidence. Forbidden user-facing words
in evidence-rating surfaces: safe, trusted, approved, compliant, low risk,
high risk, guaranteed, cleared, bank verified. Stub providers (CIPC, Onfido,
Dow Jones, Refinitiv) cannot support `verification_complete`. Overrides cannot
upgrade to `verification_complete` (DB trigger enforces).
