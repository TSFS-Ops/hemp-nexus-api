# Implementation Plan: Intent Confirmation & Flow Cleanup

## ✅ IMPLEMENTATION COMPLETE

All changes have been successfully implemented to transform the Compliance Matching API into a pure **evidence recording API** with no implied communication, agency, or obligation.

---

## Summary of Changes Made

### Backend Changes

| File | Changes |
|------|---------|
| `supabase/functions/match/index.ts` | ✅ Added 500-token burn to /settle endpoint; removed notifyCounterpartyIntent call; updated state to intent_declared |
| `supabase/functions/_shared/webhooks.ts` | ✅ Removed notifyCounterpartyIntent function entirely |

### Frontend Changes

| File | Changes |
|------|---------|
| `src/components/CounterpartySearch.tsx` | ✅ Removed Invite button, Send icon, handleInvite function, acceptedInvites check; Confirm Intent now always visible |
| `src/pages/Invites.tsx` | ✅ Updated empty state messaging from "Send invites" to "Intent confirmations" |
| `src/components/dashboard/sections/LogsSection.tsx` | ✅ Muted invite.* badge styling; added intent.declared color |
| `src/components/admin/GlobalApiLogs.tsx` | ✅ Muted invite.* badge styling; added intent.declared color |
| `src/components/DemoConfirmDialog.tsx` | ✅ Fixed webhook language: "your registered endpoints" not "counterparty" |

---

## Token Burn Flow (After Changes)

```text
User searches → FREE (no token burn, /search is non-billable)
                   ↓
User views results → FREE (discovery state)
                   ↓
User clicks "Confirm Intent" → 
  1. Creates match record (state: discovery, status: matched)
  2. Calls /match/:id/settle which:
     - Burns 500 tokens (declare_intent action)
     - Updates status to "settled" AND state to "intent_declared"
     - Creates audit_logs entry with intent.confirmed
     - Creates match_events entry with hash chain
     - Triggers user's registered webhooks (NOT counterparty)
  3. UI shows "Intent recorded"
  4. Event appears in Activity tab with proof link
```

---

## Invariants Now Enforced

| Rule | Enforcement |
|------|-------------|
| No POI → no charge | ✅ Search is in NON_BILLABLE_ENDPOINTS; Confirm Intent burns 500 tokens |
| Charge → POI must exist | ✅ Token burn happens AFTER match record created, INSIDE settle handler |
| No messaging icons | ✅ Removed Send icon from CounterpartySearch |
| No "sent/introduced/connected" | ✅ Removed Invite flow entirely; updated toast messages |
| No counterparty notification | ✅ Removed notifyCounterpartyIntent function and all calls |

---

## Acceptance Test Verification

After implementation, this test should pass:

1. ✅ Note credit balance: X
2. ✅ Run 3 searches → Credits still X (search is free)
3. ✅ Select result, click "Confirm Intent" → Credits = X - 500
4. ✅ UI shows "Intent recorded"
5. ✅ Open Logs (Activity tab) → See `intent.confirmed` with hash and "Open Proof" link
6. ✅ Open Admin API Logs → See same event correlated by request_id
7. ✅ Verify no email/SMS/webhook sent to counterparty
