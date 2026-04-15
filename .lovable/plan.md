# Buyer/Seller Identity Fix — Architectural Plan

## Problem
When a user creates a bilateral trade and says "I am the Buyer", downstream processes (auto-linking, UI rendering) can invert the roles. There are 3+ independent sources of "who is the buyer" that disagree.

## Single Source of Truth

- `buyer_org_id` = the org that IS the buyer
- `seller_org_id` = the org that IS the seller
- `org_id` = who created the match (NOT a role indicator)
- `metadata.tradeSide` = what the CREATOR declared ("I am a buyer/seller")

Everything must derive from `buyer_org_id`/`seller_org_id`. `metadata.tradeSide` exists only as creation context.

---

## Phase 1: Fix Creation (BilateralMatchForm.tsx)

**Bug:** Counterparty gets `crypto.randomUUID()` as ID → fails org validation → their slot written as `null`.

**Fix:** Send `null` for counterparty org_id, send creator's `org_id` explicitly in the correct buyer/seller slot:
- Creator says "I am the Buyer" → `buyer.org_id = profile.org_id`, `seller.org_id = null`
- Creator says "I am the Seller" → `seller.org_id = profile.org_id`, `buyer.org_id = null`

## Phase 2: Fix Auto-Linking (DB trigger)

**Bug:** `auto_link_engagement_on_signup` links counterparty org to engagement but doesn't fill the correct match slot.

**Fix:** When auto-linking, find the vacant slot on the match (`buyer_org_id IS NULL` or `seller_org_id IS NULL`) and fill it.

## Phase 3: Fix UI Role Detection

**Bugs:**
- `MatchHeroCard` uses `metadata.tradeSide` for creator, `getMatchRole()` for viewers — they disagree
- `AcceptEngagementCard` excludes creators via `matchRole === "creator"`
- `EngagementTracker` doesn't branch on `counterparty_type`

**Fix:**
1. Remove `metadata.tradeSide` override in MatchHeroCard — use `getMatchRole()` for everyone
2. `AcceptEngagementCard`: check `counterparty_org_id` on engagement, not `getMatchRole()`
3. `EngagementTracker`: branch messages on `counterparty_type`

## Phase 4: Fix Existing Data

Swap inverted `buyer_org_id`/`seller_org_id` on match `7566e4f0` based on `metadata.tradeSide` + `org_id`.

## Order of Operations
1. Phase 4 (fix existing data)
2. Phase 1 (fix creation)
3. Phase 2 (fix auto-linking)
4. Phase 3 (fix UI)
5. Verify with live match

## Files Changed

| File | Change |
|---|---|
| `src/components/dashboard/BilateralMatchForm.tsx` | Fix buyer/seller object construction |
| `supabase/functions/match/index.ts` | Clean up org resolution |
| DB trigger `auto_link_engagement_on_signup` | Also fill match buyer/seller slot |
| `src/components/match/MatchHeroCard.tsx` | Remove tradeSide override |
| `src/components/match/AcceptEngagementCard.tsx` | Check engagement counterparty_org_id |
| `src/components/match/EngagementTracker.tsx` | Branch on counterparty_type |
| Data fix | Swap inverted org IDs on affected matches |
