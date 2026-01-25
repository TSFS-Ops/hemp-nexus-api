
# Implementation Plan: P-2 Completion & API Price List Enforcement

## Executive Summary

Based on the two documents provided:
1. **API_Price_List.pdf** - Unified Commercial Pricing Framework (token-based monetisation)
2. **P-2_Final_Close-Out_Work_Program.pdf** - Work Authorisation for P-2 Completion

This plan addresses the **8 requirements for P-2 completion** (p.10 of Work Program):
1. Discovery is free and anonymised ✅ DONE
2. Intent matching is token-gated ✅ DONE  
3. Counterparty sighting is explicit, paid, and logged ⚠️ PARTIAL
4. COMMIT + WaD are enforced and blocking ⚠️ PARTIAL
5. Transaction finality burns tokens automatically ❌ NOT DONE
6. Payment enablement for token purchase is live ❌ NOT DONE
7. Pricing is enforced in code ⚠️ PARTIAL
8. Hemp is separated by URL ✅ N/A (excluded from P-2)

---

## Current State Analysis

### What's DONE
| Feature | Status | Evidence |
|---------|--------|----------|
| Token metering infrastructure | ✅ | `token-metering.ts` with `burnTokens()` |
| Token balance enforcement | ✅ | `enforceTokenMetering()` returns 402 if insufficient |
| Token ledger (append-only) | ✅ | `token_ledger` table with RLS |
| Discovery (free search) | ✅ | `/search` endpoint works without token gating |
| Intent confirmation flow | ✅ | `CounterpartySearch.tsx` + `/match` edge function |
| WaD module (5-step sealing) | ✅ | `WadStepper.tsx` + `wad` edge function |
| Evidence pack generation | ✅ | `evidence-pack` edge function |
| Invite/accept/decline gate | ✅ | `invites` table + edge function |

### What's NOT DONE
| Feature | Status | Required By |
|---------|--------|-------------|
| Annual licence table + enforcement | ❌ | Work Program §2 |
| Counterparty sighting (paid reveal) | ❌ | Work Program §5-6 |
| Transaction state machine | ❌ | Work Program §4 |
| Value-based finality token burn | ❌ | Work Program §9 |
| Stripe payment integration | ❌ | Work Program §12 |
| Action-specific token costs | ❌ | Price List §2-6 |

---

## Implementation Plan

### Part 1: Annual Licence Enforcement (Access Gate)

**Requirement** (Work Program p.2):
> An active paid annual licence is required [for all chargeable actions]. Licence validity checked before any action.

**Price List** (p.9):
- Professional: USD $5,000/year
- Corporate: USD $15,000/year
- Institutional: USD $50,000/year

**Implementation**:

1. **Create `licences` table**:
```sql
CREATE TABLE public.licences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tier TEXT NOT NULL CHECK (tier IN ('professional', 'corporate', 'institutional', 'sovereign')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_reference TEXT,
  amount_usd NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Org can view their own, admin can manage all
```

2. **Create `checkLicenceValidity()` function**:
- Add to `_shared/licence-enforcement.ts`
- Check if org has active licence before any billable action
- Return `403 LICENCE_REQUIRED` if no valid licence

3. **Integrate into edge functions**:
- Add `enforceLicence(supabase, orgId)` call before `enforceTokenMetering()` in all billable endpoints

---

### Part 2: Transaction State Machine

**Requirement** (Work Program p.3-7):
States: `DISCOVERY` → `INTENT_DECLARED` → `COUNTERPARTY_SIGHTED` → `COMMITTED`

**Implementation**:

1. **Add `state` column to `matches` table**:
```sql
ALTER TABLE matches ADD COLUMN state TEXT NOT NULL DEFAULT 'discovery'
  CHECK (state IN ('discovery', 'intent_declared', 'counterparty_sighted', 'committed', 'completed'));
```

2. **Update match edge function** to enforce state transitions:
- `POST /match` → Creates match in `discovery` state (FREE)
- `POST /match/:id/declare-intent` → Transitions to `intent_declared` (500 tokens)
- `POST /match/:id/reveal-counterparty` → Transitions to `counterparty_sighted` (1,500 tokens)
- `POST /match/:id/commit` → Transitions to `committed` (1,000 tokens per party + finality burn)

3. **Block invalid transitions**:
- Cannot `reveal-counterparty` without being in `intent_declared`
- Cannot `commit` without being in `counterparty_sighted`

---

### Part 3: Counterparty Sighting (Paid Reveal)

**Requirement** (Work Program p.4-6):
> Counterparty sighting is a standalone monetisation event. Revealing counterparty-identifying information must trigger an immediate token deduction.

**Token Cost**: 1,500 tokens per counterparty per transaction

**Implementation**:

1. **Add `counterparty_sighted_at` and `sighting_tokens_burned` to matches table**

2. **Create "Reveal Counterparty" endpoint** (`POST /match/:id/reveal-counterparty`):
```typescript
// In match/index.ts
if (action === "reveal-counterparty") {
  // 1. Check licence validity
  await enforceLicence(supabase, authCtx.orgId);
  
  // 2. Check state is INTENT_DECLARED
  if (match.state !== "intent_declared") {
    throw new ApiException("INVALID_STATE", "Must declare intent before revealing counterparty", 400);
  }
  
  // 3. Burn 1,500 tokens
  await burnTokensForAction(supabase, orgId, "counterparty_sighting", 1500, matchId);
  
  // 4. Update state
  await supabase.from("matches")
    .update({ 
      state: "counterparty_sighted", 
      counterparty_sighted_at: new Date().toISOString(),
      sighting_tokens_burned: 1500
    })
    .eq("id", matchId);
  
  // 5. Log event
  await supabase.from("audit_logs").insert({
    action: "counterparty.sighted",
    entity_type: "match",
    entity_id: matchId,
    metadata: { tokens_burned: 1500, fields_revealed: [...] }
  });
  
  // 6. Return unredacted counterparty data
  return { ...match, seller_name: match.seller_name, seller_id: match.seller_id };
}
```

3. **Update UI** (`CounterpartySearch.tsx`):
- Add "Reveal Counterparty" button that costs 1,500 tokens
- Show masked counterparty info until reveal
- Display token cost confirmation before reveal

---

### Part 4: Action-Specific Token Burns

**Requirement** (Price List p.2-3 & Work Program p.9):

| Action | Tokens |
|--------|--------|
| Create transaction shell | 500 |
| "Other / Manual Description" | 250 |
| Document upload | 50 per document |
| Counterparty reveal (sighting) | 1,500 |
| Buyer COMMIT | 1,000 |
| Seller COMMIT | 1,000 |

**Implementation**:

1. **Create `burnTokensForAction()` helper**:
```typescript
// In _shared/token-metering.ts
const ACTION_TOKEN_COSTS = {
  'transaction_shell': 500,
  'manual_description': 250,
  'document_upload': 50,
  'counterparty_sighting': 1500,
  'buyer_commit': 1000,
  'seller_commit': 1000,
};

export async function burnTokensForAction(
  supabase: SupabaseClient,
  orgId: string,
  action: keyof typeof ACTION_TOKEN_COSTS,
  amount?: number,
  entityId?: string
): Promise<void> {
  const tokensToBurn = amount ?? ACTION_TOKEN_COSTS[action];
  // ... burn logic with specific action tracking
}
```

2. **Update each endpoint** to call `burnTokensForAction()` with correct action type

---

### Part 5: Transaction Finality Token Burn

**Requirement** (Work Program p.7):

| Declared Transaction Value | Token Burn |
|---------------------------|------------|
| ≤ USD 250k | 50,000 |
| USD 250k – 1m | 75,000 |
| USD 1m – 5m | 100,000 |
| USD 5m+ | 150,000 |

**Implementation**:

1. **Create `calculateFinalityBurn()` function**:
```typescript
function calculateFinalityBurn(transactionValueUsd: number): number {
  if (transactionValueUsd <= 250000) return 50000;
  if (transactionValueUsd <= 1000000) return 75000;
  if (transactionValueUsd <= 5000000) return 100000;
  return 150000;
}
```

2. **Enforce in COMMIT endpoint**:
```typescript
if (action === "commit") {
  // Calculate transaction value from match
  const valueUsd = match.price_amount * match.quantity_amount;
  const finalityBurn = calculateFinalityBurn(valueUsd);
  
  // Check sufficient balance for COMMIT (1,000) + finality burn
  const totalRequired = 1000 + finalityBurn;
  await ensureSufficientTokens(supabase, orgId, totalRequired);
  
  // Burn tokens
  await burnTokensForAction(supabase, orgId, 'buyer_commit', 1000);
  await burnTokensForAction(supabase, orgId, 'finality_burn', finalityBurn);
  
  // Update state
  await supabase.from("matches").update({ state: "committed" }).eq("id", matchId);
}
```

---

### Part 6: Payment Integration (Stripe)

**Requirement** (Work Program p.10):
> Payment enablement for token purchase is live and operational, including:
> - an active Izenzo-controlled payment endpoint
> - automatic crediting of tokens upon successful payment
> - settlement of token purchase proceeds into an Izenzo-designated operating account

**Implementation**:

1. **Add Stripe secret** via connector (STRIPE_SECRET_KEY)

2. **Create `token-purchase` edge function**:
```typescript
// supabase/functions/token-purchase/index.ts
// POST /token-purchase - Create Stripe checkout session
// POST /token-purchase/webhook - Handle Stripe webhook for payment success

const TOKEN_PACKAGES = [
  { tokens: 10000, price_usd: 500 },   // $0.05/token
  { tokens: 50000, price_usd: 2250 },  // 10% discount
  { tokens: 100000, price_usd: 4000 }, // 20% discount
];

// On successful payment:
// 1. Credit tokens to org's token_balances
// 2. Record in token_ledger with outcome: "purchased"
// 3. Send confirmation email
```

3. **Create "Buy Tokens" UI component**:
- Display current balance
- Show package options with pricing
- "Buy Now" button → redirects to Stripe checkout
- Return URL shows confirmation

4. **Create `token-purchase-webhook` handler**:
- Verify Stripe signature
- Credit tokens to org
- Record in ledger

---

### Part 7: UI Updates

1. **Token Balance Display** (everywhere):
- Show current balance in header/sidebar
- Warning banner when below 6,000 tokens
- Block UI when below 5,000 tokens

2. **"Buy Tokens" Page** (`/dashboard/billing`):
- Package selection
- Stripe checkout integration
- Purchase history from `token_ledger`

3. **Licence Management** (`/dashboard/licence`):
- Current licence status
- Expiry date
- Upgrade/renew options

4. **Transaction State UI** (MatchDetails.tsx):
- Visual state indicator (Discovery → Intent → Sighted → Committed)
- Action buttons appropriate to current state
- Token cost shown before each action

---

## Database Migrations Required

```sql
-- 1. Licences table
CREATE TABLE public.licences (...);

-- 2. Match state machine
ALTER TABLE matches ADD COLUMN state TEXT DEFAULT 'discovery';
ALTER TABLE matches ADD COLUMN counterparty_sighted_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN sighting_tokens_burned INTEGER;
ALTER TABLE matches ADD COLUMN buyer_committed_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN seller_committed_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN finality_tokens_burned INTEGER;
ALTER TABLE matches ADD COLUMN declared_value_usd NUMERIC;

-- 3. Update token_ledger for action tracking
ALTER TABLE token_ledger ADD COLUMN action_type TEXT;
ALTER TABLE token_ledger ADD COLUMN entity_id UUID;
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/licence-enforcement.ts` | Licence validation logic |
| `supabase/functions/token-purchase/index.ts` | Stripe checkout + webhook |
| `src/pages/Billing.tsx` | Token purchase UI |
| `src/pages/Licence.tsx` | Licence management UI |
| `src/components/TokenBalanceDisplay.tsx` | Header balance indicator |
| `src/components/TransactionStateIndicator.tsx` | Visual state machine |

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/match/index.ts` | Add state machine, reveal, commit endpoints |
| `supabase/functions/_shared/token-metering.ts` | Add action-specific burns |
| `src/components/CounterpartySearch.tsx` | Add reveal button, show costs |
| `src/pages/MatchDetails.tsx` | State indicator, action buttons |
| `src/components/wad/WadStepper.tsx` | Token cost display before seal |
| `supabase/config.toml` | Register `token-purchase` function |

---

## Implementation Order

| Phase | Deliverables | Priority |
|-------|--------------|----------|
| **Phase 1** | Licence table + enforcement | HIGH |
| **Phase 2** | Transaction state machine | HIGH |
| **Phase 3** | Counterparty sighting (paid reveal) | HIGH |
| **Phase 4** | Action-specific token burns | HIGH |
| **Phase 5** | Finality token burn | HIGH |
| **Phase 6** | Stripe payment integration | CRITICAL |
| **Phase 7** | UI updates (balance, states, buy) | MEDIUM |

---

## Acceptance Criteria (from Work Program p.10)

| # | Criterion | Test |
|---|-----------|------|
| 1 | Discovery is free and anonymised | Search returns results without token burn |
| 2 | Intent matching is token-gated | Declaring intent burns 500 tokens |
| 3 | Counterparty sighting is explicit, paid, logged | Reveal burns 1,500 tokens + audit log |
| 4 | COMMIT + WaD are enforced and blocking | Cannot seal WaD without COMMIT; COMMIT burns 1,000 tokens |
| 5 | Transaction finality burns tokens automatically | COMMIT triggers value-based burn (50k-150k) |
| 6 | Payment enablement is live | Stripe checkout → tokens credited |
| 7 | Pricing is enforced in code | All costs from Price List are coded |
| 8 | Hemp is separated by URL | N/A (P-3 scope) |

---

## Technical Notes

### Security Considerations
- Stripe webhook must verify signature
- Token burns are atomic (no partial burns)
- Licence checks happen server-side only
- State transitions are irreversible (no rollback)

### Error Handling
- `402 Payment Required` - Insufficient tokens
- `403 Licence Required` - No active licence
- `400 Invalid State` - Wrong state for action
- `409 Already Committed` - Idempotent protection

### Audit Trail
All billable actions are logged to:
- `token_ledger` (token burns with action type)
- `audit_logs` (business events with entity context)
- `match_events` (hash-chained timeline)
