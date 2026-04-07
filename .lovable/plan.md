
## End-to-End Platform Wiring Plan

### Phase 1: Core Transaction Loop
1. **State Progression UI + Token Burn** — Add Reveal, Commit, Complete action buttons to match detail page that call `safe_transition_match_state` and `atomic_token_burn`. Each action deducts 1 credit (R10 pricing).
2. **Bid/Offer Persistence** — Wire the landing page BidOfferForm to write to `trade_orders` table on submit (post-auth), making interests visible and matchable.
3. **Location in Search** — Add location field to the landing form and pass it through to the `search` edge function query.

### Phase 2: Counterparty & Visibility
4. **Counterparty Visibility** — Update match detail UI to show counterparty identity and enable both sides to act on the shared workspace (RLS already supports this via `is_match_participant`).

### Phase 3: Compliance Rails
5. **Governance Doc Registry Seeding** — Seed `governance_doc_registry` with South Africa (ZA) jurisdiction rules so the WaD gate can validate mandatory documents.
6. **UBO Verification Wiring** — Add "Verify Ownership" action to entity detail pages that calls the existing `ubo-verify` edge function.

### Phase 4: Notifications
7. **Email Notifications** — Build transactional email templates via `notification-dispatch` for key events: POI issued, match created, state transitions, breach alerts. Uses existing Resend integration.

### Phase 5: QA
8. **End-to-end walkthrough** — Verify the full Discovery → Intent → Reveal → Commit → Complete flow works with real token deductions and notifications.
