

# Implementation Plan: Intent Confirmation & Flow Cleanup

## Executive Summary

This plan addresses the fundamental product positioning issue where the Compliance Matching API currently conflates "messaging/brokerage" concepts with "proof-of-intent" concepts. The changes ensure the system behaves as a pure **evidence recording API** with no implied communication, agency, or obligation.

---

## Current State Analysis

### Problems Identified

1. **Invite-gated Confirm Intent**: Currently, "Confirm Intent" requires a counterparty to "accept" an invite first — this implies messaging/brokerage
2. **notifyCounterpartyIntent function**: Active code that sends webhooks to counterparties on intent confirmation
3. **UI Language Issues**:
   - "Invite" button with `Send` icon in CounterpartySearch
   - "Invited X counterparties" toast messages
   - "Send invites to start" messaging in Invites page
   - invite.created/accepted/declined events shown in logs
4. **Billing Mismatch**: Token burn happens on `/match/:id/declare-intent` (500 tokens) but the "Confirm Intent" button calls `/match/:id/settle` which does NOT burn tokens (only enforceTokenMetering at 1 token/call)
5. **Missing Logs Visibility**: `intent.confirmed` events from audit_logs are correctly fetched but invite.* events pollute the log

### What's Working Correctly

- Demo page (Demo.tsx) correctly shows preview without creating records
- Discovery search is free (NON_BILLABLE_ENDPOINTS includes /search)
- LogsSection dual-tab structure (Activity/API Logs) is correct
- Match state machine (discovery → intent_declared → counterparty_sighted → committed) is defined
- Token metering infrastructure exists

---

## Implementation Changes

### Phase 1: Remove Counterparty Notification & Invite Gating

#### 1.1 Disable `notifyCounterpartyIntent` in match function

**File**: `supabase/functions/match/index.ts`

Remove or comment out lines 277-292 that call `notifyCounterpartyIntent()`. This function explicitly sends webhooks to counterparties, which violates the "no outbound contact" requirement.

```text
BEFORE:
  // Notify the counterparty about the intent confirmation
  notifyCounterpartyIntent(supabase, { ... })

AFTER:
  // REMOVED: No counterparty notification - API records proof only
  // Counterparty contact is handled externally by the calling system
```

#### 1.2 Remove invite-gating from CounterpartySearch

**File**: `src/components/CounterpartySearch.tsx`

The current flow requires:
1. User selects counterparty
2. User clicks "Invite" → creates invite record
3. Counterparty accepts invite
4. ONLY THEN can user "Confirm Intent"

**Change to**:
1. User selects counterparty
2. User clicks "Confirm Intent" → creates match + POI + audit log + burns tokens

Remove the "Invite" button entirely and remove the `acceptedInvites` check that gates Confirm Intent.

### Phase 2: Fix Billing/Token Burn Alignment

#### 2.1 Align "Confirm Intent" with proper token burn

**Issue**: The `/match/:id/settle` endpoint does NOT call `burnTokensForAction` with a meaningful action type — it only burns 1 token via `enforceTokenMetering`.

**Options**:
- **Option A**: Make `/settle` call `burnTokensForAction('declare_intent', ...)` for 500 tokens
- **Option B**: Direct frontend to call `/declare-intent` instead of `/settle`

**Recommended**: Option A — Update `/settle` to burn 500 tokens explicitly since it's the user-facing "Confirm Intent" action.

**File**: `supabase/functions/match/index.ts`

Add token burn to the settle endpoint:

```typescript
// Before updating status, burn tokens for intent confirmation
await burnTokensForAction(
  supabase,
  authCtx.orgId,
  actorApiKeyId,
  'declare_intent',  // 500 tokens
  requestId,
  matchId
);
```

### Phase 3: UI Language Cleanup

#### 3.1 Remove "Invite" button and messaging icons

**File**: `src/components/CounterpartySearch.tsx`

- Remove the entire "Invite" button (lines 486-499)
- Remove `Send` icon import
- Remove `handleInvite` function
- Remove `isInviting` state
- Remove `acceptedInvites` state and check
- Make "Confirm Intent" always visible when results are selected

#### 3.2 Update Invites page messaging

**File**: `src/pages/Invites.tsx`

This page can remain for users who have historical invites, but update messaging:

- Change "Send invites to start" → "Intent confirmations appear here"
- Consider hiding this page entirely or renaming to "Intent History"

#### 3.3 Remove invite.* event badges from logs

**File**: `src/components/dashboard/sections/LogsSection.tsx`

Remove or deprioritise invite.created, invite.accepted, invite.declined from the action badge colors. These should not appear as business events since invites are being deprecated.

**File**: `src/components/admin/GlobalApiLogs.tsx`

Same cleanup for admin view.

### Phase 4: Ensure Logs Visibility

The current LogsSection correctly fetches activity from `/audit-logs` endpoint. Verify that `intent.confirmed` events appear with:
- Timestamp
- Action badge
- Entity (match ID)
- Hash reference
- "Open Proof" link

This is already implemented correctly. The only change needed is ensuring the `intent.confirmed` audit entry includes the `request_id` in metadata (already present).

### Phase 5: Documentation and Webhook Cleanup

#### 5.1 Remove brokerage language from webhooks.ts

**File**: `supabase/functions/_shared/webhooks.ts`

- Remove `notifyCounterpartyIntent` function entirely (lines 206-300+)
- Remove `intent.received` event type references

#### 5.2 Update DemoConfirmDialog

**File**: `src/components/DemoConfirmDialog.tsx`

Line 119 says "Counterparty notification via webhook" — change to:
"Webhook delivery to YOUR registered endpoints" (clarifying it's the caller's webhooks, not the counterparty's)

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/match/index.ts` | Add token burn to /settle; remove notifyCounterpartyIntent call |
| `supabase/functions/_shared/webhooks.ts` | Remove notifyCounterpartyIntent function |
| `src/components/CounterpartySearch.tsx` | Remove Invite button, remove invite-gating, always show Confirm Intent |
| `src/pages/Invites.tsx` | Update empty state messaging, consider deprecation |
| `src/components/dashboard/sections/LogsSection.tsx` | Remove invite.* badge styling |
| `src/components/admin/GlobalApiLogs.tsx` | Remove invite.* badge styling |
| `src/components/DemoConfirmDialog.tsx` | Fix webhook language |

---

## Technical Details

### Token Burn Flow (After Changes)

```text
User searches → FREE (no token burn, /search is non-billable)
                   ↓
User views results → FREE (discovery state)
                   ↓
User clicks "Confirm Intent" → 
  1. Creates match record (state: matched, status: matched)
  2. Calls /match/:id/settle which:
     - Burns 500 tokens (declare_intent action)
     - Updates status to "settled", settled_at timestamp
     - Creates audit_logs entry with intent.confirmed
     - Creates match_events entry with hash chain
     - Triggers user's registered webhooks (NOT counterparty)
  3. UI shows "Intent recorded"
  4. Event appears in Activity tab with proof link
```

### State Machine Clarification

The current state machine has two parallel concepts that need reconciliation:

1. **status** field: `matched` → `settled`
2. **state** field: `discovery` → `intent_declared` → `counterparty_sighted` → `committed`

For the simplified flow (single-sided POI), we use:
- `status: settled` = Intent confirmed
- `state: intent_declared` = Intent confirmed

The `/settle` endpoint should update BOTH fields consistently.

### Acceptance Test Verification

After implementation, this test should pass:

1. Note credit balance: X
2. Run 3 searches → Credits still X (search is free)
3. Select result, click "Confirm Intent" → Credits = X - 500
4. UI shows "Intent recorded"
5. Open Logs (Activity tab) → See `intent.confirmed` with hash and "Open Proof" link
6. Open Admin API Logs → See same event correlated by request_id
7. Verify no email/SMS/webhook sent to counterparty

---

## Rollback Plan

If issues arise:
1. Re-enable notifyCounterpartyIntent by uncommenting
2. Restore Invite button visibility
3. Database records (matches, audit_logs) will remain valid regardless

---

## Summary of Invariants Enforced

| Rule | Enforcement |
|------|-------------|
| No POI → no charge | Search is in NON_BILLABLE_ENDPOINTS; Confirm Intent burns 500 tokens |
| Charge → POI must exist | Token burn happens AFTER match record created, INSIDE audit log creation block |
| No messaging icons | Remove Send icon from CounterpartySearch |
| No "sent/introduced/connected" | Remove Invite flow entirely; update toast messages |
| No counterparty notification | Remove notifyCounterpartyIntent call |

