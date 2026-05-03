# End-to-End Happy Path Walkthrough

**Platform**: Trade iZenzo — Compliance Matching API
**Version**: V4 (USD-native, Trade Request entity, SECDEF Stage D1)
**Duration**: 5–8 minutes
**Last Updated**: 2026-05-03

---

## Purpose

This document proves **the system works as a system** — not as isolated features. It walks through the complete lifecycle from zero to a sealed, evidence-backed trade record.

**Lifecycle summary:**
Onboard → Verify → Discover → Engage → Mint POI → Complete → Seal WaD → Export Evidence

> **Terminology:** This platform uses **Counterparty**, **Trade Request**, **Proof of Intent (POI)**, and **WaD** (always written "Without a Doubt" — never "Warrant of Diligence"). We never use "Bid/Offer".

> **Billing:** Platform credits are **USD-native** since 2026-05-01. 1 credit = $1.00 USD. Trade-side currencies (ZAR / EUR / etc.) on a Trade Request are commercial terms, not billing claims.

---

## Prerequisites

- A running instance of the platform (e.g. `https://compliance-matching.lovable.app`)
- Admin access (first user is auto-assigned `org_admin` + `org_member`)
- The Checkpoint harness at `/admin/checkpoint-2026-04-16` (optional, for automated execution)

---

## Phase 1 - Entity Onboarding & Due Diligence (~2 min)

### Step 1: Create Organisations (Buyer + Seller)

Two organisations are created to represent the trading parties.

| Field | Buyer Org | Seller Org |
|-------|-----------|------------|
| Name | Acme Pharma (Pty) Ltd | MedSupply Holdings |
| Status | active | active |

**What happens behind the scenes**:
- Each org gets a `token_balances` record initialised at 1,000 tokens (via `initialize_org_token_balance` trigger)
- Org IDs are generated (UUIDs)

**API**: `POST /functions/v1/orgs`

---

### Step 2: Register Entities + UBOs + Authority-to-Bind (ATB)

For **each** organisation:

1. **Register a legal entity** (company type, jurisdiction `ZA`, registration number)
2. **Register natural persons** as UBO links with ownership percentages summing to ≥100%
3. **Create Authority-to-Bind (ATB) records** linking a natural person to the company entity with method `board_resolution`

**Hard-gate enforced**: UBO ownership must sum to ≥100% per entity. ATB must be verified.

**APIs**:
- `POST /functions/v1/entities` - Register company + person entities
- `POST /functions/v1/entities` (with UBO link data) - Link beneficial owners
- `POST /functions/v1/authority-bind` - Create ATB records

---

### Step 3: Upload KYC Documents

Upload supporting documents (ID, registration certificate, UBO declaration) to the private `kyc-documents` storage bucket.

**Storage path**: `{org_id}/kyc/{entity_id}/{filename}`

**API**: `POST /functions/v1/entities` (document upload via Storage API)

---

### Step 4: Screen UBOs for Sanctions & PEP

Run screening against all natural persons linked as UBOs for both organisations.

**Expected result**: All screenings return `status: "clear"`

**Hard-gate enforced**: Screening must be within 30 days for WaD issuance.

**API**: `POST /functions/v1/dilisense-screen`

---

### Step 5: Compute Risk Scores

Calculate risk scores for both organisations based on:
- Entity verification status
- UBO completeness
- Screening results
- Jurisdiction risk
- Document completeness

**Expected result**: `risk_band: "low"` or `"medium"` (not `"high"` or `"critical"`)

**Hard-gate enforced**: `high` or `critical` risk bands block WaD issuance.

**API**: `POST /functions/v1/due-diligence` (action: `compute_risk`)

---

### Step 6: Approval Workflow

Trigger the multi-role approval workflow. Based on trade value thresholds:
- < low_threshold → `compliance_analyst` approval sufficient
- ≥ low_threshold → requires `legal_reviewer`
- ≥ high_threshold → requires `director`

Each required role must explicitly approve.

**API**: `POST /functions/v1/due-diligence` (action: `approve`)

---

### Step 7: Trade Approval Certification

Mark both organisations as **"Approved to Trade"**. This is a one-time certification that must be valid (not expired) at collapse time.

**What is checked**:
- Entity verified ✓
- UBO 100% ✓
- ATB verified ✓
- Screening clear ✓
- Risk band acceptable ✓
- Approval workflow complete ✓

**API**: `POST /functions/v1/trade-approval`

---

## Phase 2 - Discovery & Matching (~1.5 min)

### Step 8: Create Signals (Buy + Sell Intents)

**Buyer signal** (from Acme Pharma):
```json
{
  "product": "Paracetamol API 500mg",
  "quantity": 50000,
  "unit": "kg",
  "location": "Johannesburg",
  "budget": 750000,
  "currency": "ZAR"
}
```

**Seller signal** (from MedSupply):
```json
{
  "product": "Paracetamol Active Pharmaceutical Ingredient",
  "quantity": 100000,
  "unit": "kg",
  "location": "Durban"
}
```

Signals are **non-binding** expressions of commercial intent.

**API**: `POST /functions/v1/signals`

---

### Step 9: Match Discovery

The discovery engine pairs buyer and seller signals based on:
- Product similarity (semantic matching)
- Location proximity
- Quantity compatibility
- Price range overlap

**Result**: A `match` record is created with `status: "matched"`, linking both organisations.

**API**: `POST /functions/v1/search` or `POST /functions/v1/sr-discover`

---

### Step 10: Engage Counterparty (hold-point)

The buyer org initiates an **engagement** with the seller org against the discovered Trade Request.

**What happens**:
- A `match` row is created as a child of the parent `trade_requests` row (linked via `trade_request_id`)
- Engagement enters `pending` status — the seller must accept before any POI can be minted
- Until acceptance, all POI mint attempts return `409 / ENGAGEMENT_PENDING`
- A dual-path notification fires (admin + counterparty user) via Resend, with subjects clamped to 200 chars by `clampSubject()`

**API**: `POST /functions/v1/poi-engagements`

> Trade Requests **persist across counterparty attempts**. If this seller declines or the engagement expires, the parent Trade Request survives and can be re-engaged with a different counterparty without re-keying.

---

### Step 11: Counterparty Accepts Engagement

The seller org accepts the engagement.

**What happens**:
- `atomic_accept_bind` runs (service-role only, since SECDEF Stage D1)
- Engagement status → `accepted`
- Hold-point clears; the buyer can now progress to POI mint
- Audit log records `engagement.accepted`

**API**: `POST /functions/v1/poi-engagements` (action: `accept`)

---

## Phase 3 - POI Lifecycle & Collapse (~2 min)

### Step 12: Pre-flight Validation

Run non-binding pre-flight checks to verify readiness:
- Both parties "Approved to Trade" ✓
- Trade approval not expired ✓
- No open compliance cases ✓
- Organisation not frozen ✓
- No global collapse freeze ✓

**Result**: Pre-flight passes, Intent state transitions to `ELIGIBLE`

**API**: `POST /functions/v1/preflight`

---

### Step 12b: POI Probability Calculation

Calculate completion probability based on 7 weighted factors:

| Factor | Weight | Expected Score |
|--------|--------|---------------|
| Entity verification | 20% | 1.0 |
| UBO completeness | 15% | 1.0 |
| ATB verification | 10% | 1.0 |
| Screening clear | 15% | 1.0 |
| Trade approval | 15% | 1.0 |
| Intent confirmed | 15% | 1.0 |
| Compliance clear | 10% | 1.0 |

**Expected result**: `probability: 100.0%` (≥50.1% required)

**Hard-gate enforced**: Probability < 50.1% blocks collapse.

**API**: `POST /functions/v1/poi-probability`

---

### Step 13: POI Mint (Binding Event)

The POI mint runs through `atomic_generate_poi_v2` — a `service_role`-only PostgreSQL function (SECDEF Stage D1, 2026-04-22). The browser **never** calls it directly; it goes through the owning edge function.

**Mandatory request fields**:
- `org_id`, `counterparty_org_id` (UUIDs)
- `trade_request_id` (parent Trade Request)
- `quantity`, `price`, `currency`, `incoterms` (commercial terms — required before mint)
- `idempotency_key` (header)
- `p_acks` (object) — **must include `{declaration_ack: true, atb_ack: true}` on every mint**

**What is validated**:
1. ✅ Engagement is `accepted` (else `409 / ENGAGEMENT_PENDING`)
2. ✅ No active dispute on the match (else `409 / DISPUTE_ACTIVE`)
3. ✅ Both parties "Approved to Trade" with valid approval
4. ✅ Dynamic approval tier met (5-factor risk scoring)
5. ✅ Intent state is `ELIGIBLE` or `COMPLETION_REQUESTED`
6. ✅ POI completion probability ≥ 50.1%
7. ✅ Acknowledgements present (`declaration_ack` + `atb_ack`)
8. ✅ For bilateral matches: **≥1 document per side** (no waivers)
9. ✅ PostgreSQL advisory lock acquired (concurrency control)
10. ✅ Idempotency (duplicate → returns original record)

**Evidence Strength Indicator**: documents are not individually mandatory beyond the per-side minimum. The UI surfaces a red→amber→green bar — more documents = stronger bundle. The wizard never auto-skips the Match step; the strict audited waiver dialog blocks POI mint when zero docs and zero notes.

**What is recorded**:
- POI row with state → `COMPLETED`
- `atomic_token_burn` deducts the configured cost (USD-native; `exempt_burn` for founder/admin accounts)
- SHA-256 payload hash
- Append-only audit_logs entry

**Result**: Immutable POI record with `poi_state: "COMPLETED"`

**API**: `POST /functions/v1/poi-mint`

---

## Phase 4 - Evidence & Certification (~1.5 min)

### Step 14: Generate Evidence Pack v1

Produce a tamper-evident evidence bundle:

```json
{
  "version": "1.0",
  "collapse_id": "uuid",
  "payload_hash": "sha256...",
  "signature_valid": true,
  "timestamps": {
    "client": "2026-03-04T10:00:00Z",
    "server": "2026-03-04T10:00:00.123Z",
    "ntp_status": "hardened",
    "drift_ms": 123
  },
  "approval_chain": [...],
  "audit_trail": [...]
}
```

**Canonical JSON**: Sorted keys, no whitespace - ensures deterministic SHA-256 hashing.

**API**: `POST /functions/v1/evidence-pack`

---

### Step 15: Create WaD (Without a Doubt) Certificate

The WaD layer enforces **10 deterministic hard-gates**:

| # | Hard-Gate | Check |
|---|-----------|-------|
| 1 | Intent state | Must be `COMPLETED` |
| 2 | Entity status | Must be `VERIFIED` |
| 3 | UBO integrity | 100% verified ownership |
| 4 | ATB records | Active and verified |
| 5 | Governance docs | All mandatory documents validated |
| 6 | Compliance cases | Zero open cases |
| 7 | Token balance | Sufficient for burn fees |
| 8 | Screening recentness | Within 30 days |
| 9 | Risk band | Not `high` or `critical` |
| 10 | Webhook connectivity | Neither party's primary webhook endpoint is auto-disabled |

**API**: `POST /functions/v1/wad`

---

### Step 16: Attestations (Buyer + Seller Sign)

Both parties attest to the WaD:

**Buyer signatory**: `role: "buyer_signatory"`  
**Seller signatory**: `role: "seller_signatory"`

Attestation text: *"I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed."*

**API**: `POST /functions/v1/wad/{wadId}/attest`

---

### Step 17: Seal the WaD

With both attestations in place, seal the WaD:

- Canonical payload is constructed from WaD data + attestations + documents
- SHA-256 seal hash computed
- Ledger entry hash chains to previous WaD (append-only ledger)
- Status → `"sealed"`
- `sealed_at` timestamp recorded

**Result**: Immutable, cryptographically sealed certificate of trade intent.

**API**: `POST /functions/v1/wad/{wadId}/seal`

---

### Step 18: Download Certificate

Export the sealed signed deal certificate containing:
- Transaction summary (commodity, quantity, price)
- Party details (buyer + seller orgs)
- Attestation records
- Seal hash + ledger entry hash
- Evidence bundle reference

**API**: `GET /functions/v1/wad/{wadId}/certificate`

---

### Step 19: Export Audit Trail

Download the complete audit log for the trade lifecycle:

| Event | Timestamp | Actor |
|-------|-----------|-------|
| entity.created | T+0s | System |
| ubo.linked | T+2s | System |
| atb.verified | T+4s | System |
| screening.completed | T+6s | System |
| risk.computed | T+8s | System |
| trade.approved | T+10s | Compliance |
| signal.created | T+12s | Buyer |
| match.discovered | T+14s | System |
| intent.declared | T+16s | Buyer |
| intent.confirmed | T+18s | Seller |
| poi.completed | T+20s | System |
| wad.created | T+22s | System |
| wad.attested | T+24s | Buyer |
| wad.attested | T+26s | Seller |
| wad.sealed | T+28s | System |

**API**: `GET /functions/v1/audit-logs`

---

## Verification Checklist

After completing the walkthrough, verify:

- [ ] Two organisations exist with `status: active`
- [ ] Entities registered with UBO ownership ≥ 100%
- [ ] ATB records verified for both parties
- [ ] Screening results `clear` and < 30 days old
- [ ] Risk bands are `low` or `medium`
- [ ] Both orgs "Approved to Trade"
- [ ] Signals created (buy + sell)
- [ ] Match discovered and confirmed
- [ ] Intent confirmed (500 tokens burned)
- [ ] POI probability ≥ 50.1%
- [ ] Collapse record exists in append-only ledger
- [ ] ECDSA signature verified
- [ ] NTP drift ≤ 1000ms (hardened status)
- [ ] WaD sealed with SHA-256 hash chain
- [ ] Both parties attested
- [ ] Evidence pack exportable
- [ ] Audit trail complete (15+ events)
- [ ] Token balance reflects burns

---

## Automated Execution

The **Checkpoint Harness** (`/admin/checkpoint-2026-04-16`) automates this entire walkthrough in two modes:

1. **DD Only** (Steps 1–7): Entity onboarding and due diligence verification
2. **Full Lifecycle** (Steps 1–14): Complete happy path through collapse + evidence

Plus **negative tests** (Steps 15–20) that verify rejection paths:
- Missing mandatory fields → 400
- Invalid ECDSA signature → 400
- Collapse before approvals → 422
- Mutate completed record → exception
- Idempotency burst (500 requests) → only 1 record
- Direct POI without eligibility → 422

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    LAYER 5: Evidence                     │
│         Evidence Pack v1 + Signed Deal Certificate               │
├─────────────────────────────────────────────────────────┤
│                  LAYER 4: Consequence                    │
│        Collapse Engine + Append-Only Ledger              │
├─────────────────────────────────────────────────────────┤
│                 LAYER 3: POI Engine                      │
│     State Machine (DRAFT → COMPLETED → ANNULLED)         │
│     Probability Calculator (≥50.1% threshold)            │
├─────────────────────────────────────────────────────────┤
│               LAYER 2: Exploration                       │
│      Signals + Discovery + Invites (non-binding)         │
├─────────────────────────────────────────────────────────┤
│              LAYER 1: Due Diligence                      │
│   Entities + UBO + ATB + Screening + Risk + Approval     │
└─────────────────────────────────────────────────────────┘
```

---

*This document is auto-generated. For the latest version, visit `/docs/end-to-end-walkthrough.md`.*
