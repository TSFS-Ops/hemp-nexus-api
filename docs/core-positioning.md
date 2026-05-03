# Compliance Matching API - Core Positioning

**Last Updated**: 2026-05-03 (USD-native examples)

This document clarifies the core positioning, capabilities, and value proposition of the Compliance Matching API. It addresses common questions and corrects any misunderstandings about what the platform does and doesn't do.

---

## Q1 – What core problem is this API solving?

This API solves the **manual verification and audit trail problem** in trade, especially where parties must show regulators that a specific trade agreement happened at a specific time with clear, tamper-evident proof.

### The Challenge

In practice, parties in regulated or high-value sectors need:

1. **Cryptographic proof** that a specific set of terms (buyer, seller, product, quantity, price, timestamp) existed
2. **Immutable, time-ordered audit trails** regulators can review
3. **Real-time notifications** when a match is created or settled
4. **A neutral record** that does not depend on trusting either counterparty's internal system

### The Solution

The API acts as a **neutral notary layer** that:

- **Records trade matches** with SHA-256 hashes for tamper-evidence
- **Links every state change** (created → settled, etc.) in a hash chain so any edit becomes detectable
- **Sends signed webhook notifications** when matches are created/settled, so each party has its own copy
- **Exposes an audit view** regulators and third parties can verify against

### The Key Insight

Think of it as **"blockchain-style proof without the blockchain"**: you get cryptographic integrity and verifiable timelines without running a full decentralised ledger.

**Important Clarification**: The system provides independent verification **independent of either party's internal system**, not "without a central authority." The API itself is the trusted neutral authority-but neither trading party needs to trust the other's records, since both can verify against the neutral log and their own webhook copies.

---

## Q2 – How does it do the above?

The API implements tamper-evident proof using four mechanisms:

### 1. SHA-256 Match Fingerprints

When a match is created, the system generates a **SHA-256 hash** of the match payload (buyer, seller, commodity, quantity, price, terms, timestamp).

This hash is stored as the **immutable fingerprint** for that agreement.

**Technical Detail**:
```javascript
const matchData = {
  buyer_id: "buyer-123",
  seller_id: "seller-456",
  commodity: "Medical Supplies",
  quantity: { amount: 1000, unit: "kg" },
  price: { amount: 85000, currency: "USD" },
  timestamp: "2025-11-28T10:30:00Z"
};

// Generate SHA-256 hash
const hash = crypto.subtle.digest('SHA-256', JSON.stringify(matchData));
```

### 2. Event Chain Hashing

Every state change (e.g. created, updated, settled) is stored as a **match_event** that includes:

- The event payload
- A `previous_event_hash`
- A new `payload_hash` computed from: event type + event data + timestamp + previous hash

This creates a **chain**: if any historical event is modified, all subsequent hashes break, making tampering evident.

**How It Works**:
```
Event 1 (created):    hash_1 = SHA256(data_1 + null)
Event 2 (updated):    hash_2 = SHA256(data_2 + hash_1)
Event 3 (settled):    hash_3 = SHA256(data_3 + hash_2)

If Event 2 is modified: hash_2' ≠ hash_2
Then: hash_3 fails verification (expects hash_2, receives hash_2')
```

### 3. Verifiable Evidence View

A `match_evidence` view/API assembles:

- The original match payload
- The complete event timeline
- All corresponding hashes

**Any party with access to the evidence** can recompute hashes and verify that:

1. The payload hasn't changed
2. The event chain is intact
3. The match existed in that exact form at that time

**Practical Verification**:
```bash
# Get match evidence
GET /match/{id}/evidence

# Response includes original data and hashes
# Party can independently verify by recomputing SHA-256
```

### 4. Signed Real-time Webhooks

On match creation/settlement, the system sends **signed webhook notifications** to registered endpoints.

This gives each party its own **independent copy** of key events and hashes, creating external audit trails beyond the core database.

**Security Features**:
- HMAC-SHA256 signatures
- Timestamp verification
- Replay attack prevention

**What "Independent Verification" Means**:

Any party with either:
- The original payload, OR
- The hash sent via webhook/export

...can independently verify integrity. The system provides tamper-evident logs, not magic-but that's exactly what compliance requires.

---

## Q3 – How do matches occur?

Matches occur in two ways, but the **core use case** for this API is very simple.

### Workflow 1 – Direct Match Recording (Primary Use Case)

This is the **1-line API** flow-the core value proposition.

**When to use this**: When two parties have already agreed terms (via email, WhatsApp, phone, in-person negotiation, etc.)

**How it works**:

1. **Record the agreement**:
   ```bash
   curl -X POST /match \
     -H "X-API-Key: your-key" \
     -d '{
       "buyer_id": "buyer-123",
       "seller_id": "seller-456",
       "commodity": "Medical Supplies",
       "quantity": {"amount": 1000, "unit": "kg"},
       "price": {"amount": 85000, "currency": "USD"}
     }'
   ```

   This:
   - Creates the match
   - Generates the cryptographic hash
   - Starts the tamper-evident event chain
   - Sends webhook notifications

2. **Later, when the trade is confirmed/closed**:
   ```bash
   POST /match/{id}/settle
   ```

   This:
   - Appends a "settled" event into the hash chain
   - Updates the evidence record
   - Triggers settlement webhooks

**That's it.** The API's primary job is to be a neutral notary, not to facilitate discovery.

---

### Workflow 2 – Signal-Based Discovery (Optional Feature)

**Important**: This is an **optional helper feature**, not the core product.

**When to use this**: When you want automated discovery in addition to proof-of-agreement.

**How it works**:

1. **Post a signal**:
   ```bash
   POST /signals
   {
     "type": "buyer",
     "product": "Medical Supplies",
     "quantity": 1000,
     "location": "Gauteng"
   }
   ```

2. **System searches configured data sources** and scores options

3. **User selects an option**

4. **Once both sides agree**, the result is recorded as a match via `POST /match` (same as Workflow 1)

**Key Point**: Even in the discovery flow, the **final match recording** uses the same tamper-evident proof mechanism. Discovery is just a way to get to the agreement-the API's core value is in the proof, not the discovery.

---

## What This API Is (And Isn't)

### ✅ This API **IS**:

- A **proof-of-agreement system** for trade
- A **neutral notary** that neither party controls
- A **tamper-evident audit trail** generator
- A **compliance documentation** platform
- A **cryptographic verification** service
- **API-first** (B2B integration platform)

### ❌ This API is **NOT**:

- A marketplace (no listings, shopping carts, or product catalogs)
- A matchmaking platform (discovery is optional, not core)
- A payment processor (no financial transactions)
- A logistics coordinator (no shipping/delivery)
- A CRM or ERP system (focused only on proof-of-agreement)
- A marketing or lead generation tool

---

## Core Value Proposition

### For Regulated Industries

Industries where you need to prove:
- **Who** you traded with
- **What** was traded
- **When** the agreement occurred
- **That the record is tamper-proof**

Examples: Pharmaceuticals, medical devices, industrial chemicals, financial instruments, defense equipment, agricultural commodities with quality standards.

### The 3-Second Pitch

**"When you need cryptographic proof that a trade agreement happened, we provide a neutral, tamper-evident record both parties-and regulators-can verify."**

### Why Not Just Use Internal Systems?

**The Problem**:
- Party A's records: "We agreed to X"
- Party B's records: "No, we agreed to Y"
- Regulator: "Who do I trust?"

**With This API**:
- Neutral record: "Both parties submitted and signed terms X at timestamp T"
- Neither party can alter it retroactively
- Both parties have webhook copies as independent backups
- Cryptographic hashes prove integrity

---

## Technical Architecture Highlights

### Hash Chain Integrity

```
Match Created
  ↓
  hash₀ = SHA256(match_data)
  ↓
Event: Price Updated
  ↓
  hash₁ = SHA256(event_data + hash₀)
  ↓
Event: Settled
  ↓
  hash₂ = SHA256(event_data + hash₁)
  ↓
Complete Audit Trail
```

**If anyone modifies Event 1**: hash₁ breaks, which breaks hash₂, which breaks the entire chain.

### Webhook-Based Distribution

```
Match Created → API generates hash
              ↓
              ├→ Webhook to Party A
              ├→ Webhook to Party B
              └→ Webhook to Third-Party Auditor
              
Each party now has independent copy
```

**Result**: No single point of failure, no single source of truth, multiple verifiable copies.

---

## Use Case Examples

### Use Case 1: Pharmaceutical Supply Chain

**Scenario**: Hospital needs to prove all medical supplies came from licensed suppliers.

**Without API**:
- Manual verification of licenses
- Paper records
- No proof records weren't altered
- Difficult audits

**With API**:
- Record each purchase via `POST /match`
- Automatic license verification (e.g., SAHPRA)
- Tamper-evident trail
- Export compliance report with cryptographic proof

### Use Case 2: Industrial Equipment

**Scenario**: Heavy machinery trade where disputes are common.

**Without API**:
- He said/she said disputes
- Altered email chains
- No clear timestamp proof
- Expensive arbitration

**With API**:
- Agreement recorded with timestamp
- Both parties have webhook copies
- Hash proves original terms
- Dispute resolution via evidence API

### Use Case 3: Cross-Border Trade

**Scenario**: International trade requiring customs documentation.

**Without API**:
- Multiple systems
- Reconciliation nightmares
- No unified proof

**With API**:
- Single source of agreement
- Both countries' systems notified via webhook
- Cryptographic proof for customs
- Standardized evidence format

---

## Integration Patterns

### Pattern 1: Marketplace Integration

**Your marketplace handles**:
- User discovery and browsing
- Product listings
- Negotiation and messaging
- Payment processing

**API handles**:
- Recording final agreements
- Generating proof
- Providing audit trail

**Integration point**: When deal is finalised, call `POST /match`

### Pattern 2: ERP Integration

**Your ERP handles**:
- Inventory management
- Order processing
- Financial records

**API handles**:
- Compliance documentation
- Regulatory audit trails
- Tamper-proof records

**Integration point**: After order approval, record via `POST /match`

### Pattern 3: Auditor Access

**Auditors need**:
- Read-only access to match records
- Ability to verify hashes
- Export capabilities

**API provides**:
- `/match/{id}/evidence` endpoint
- Hash verification tools
- CSV/JSON export

---

## Roadmap Alignment

### Current Focus (✅ Implemented)

- Core match recording with SHA-256 hashing
- Event chain for tamper-evidence
- Webhook notifications
- Evidence API for verification
- Basic SAHPRA license verification

### Near-Term (🔄 Optional Enhancements)

- Signal-based discovery (already implemented, but positioned as optional)
- Advanced analytics
- Multi-party signatures
- Additional compliance integrations

### Future Possibilities (💡 Exploratory)

- Fully decentralized verification (actual blockchain)
- Smart contract integration
- Zero-knowledge proofs for privacy-preserving verification

**Key Principle**: The core proof-of-agreement mechanism remains the foundation. All other features are additive.

---

## FAQ

### Q: Do I need to use the signals/discovery feature?

**A**: No. Many integrators use only `POST /match` for recording pre-agreed trades. Discovery is optional.

### Q: Can I trust the API not to alter records?

**A**: While the API is the authority, you have multiple verification mechanisms:
1. You receive signed webhook notifications with hashes
2. You can store these independently
3. You can recompute hashes anytime using the evidence API
4. Event chain means any tampering breaks the chain visibly

### Q: What if the API goes down?

**A**: 
- Your webhook notifications give you independent copies
- Export evidence regularly as backup
- API uptime is monitored with SLA guarantees (production tier)

### Q: Is this legally binding?

**A**: The API provides **evidence** of agreement, not legal enforceability. Legal binding depends on your jurisdiction's contract law. The API strengthens your evidence trail significantly.

### Q: How is this different from blockchain?

**A**:
- **Similar**: Hash chains, tamper-evidence, cryptographic proof
- **Different**: Centralized (faster, cheaper, no mining), permissioned, not decentralized
- **Trade-off**: You trust us as neutral party, but gain speed and ease of integration

### Q: Can I verify hashes myself?

**A**: Yes! All hash algorithms are standard (SHA-256). You can:
```javascript
// Recompute hash
const data = getMatchData();
const expectedHash = computeSHA256(data);
const storedHash = getStoredHash();

if (expectedHash === storedHash) {
  console.log("✅ Match data is intact");
} else {
  console.log("⚠️ Data has been altered");
}
```

---

## Next Steps

Now that you understand the core positioning:

1. **For integration**: See [API Reference](./api-reference.md) for `POST /match` details
2. **For testing**: Use [Getting Started Guide](./getting-started.md) to create your first match
3. **For operations**: See [Webhooks Guide](./webhooks.md) for setting up notifications
4. **For compliance**: See [Evidence Pack](./evidence-pack.md) for audit export

---

## Feedback

This positioning document is meant to clarify the platform's core purpose. If you still have questions or find misalignments:

**Contact**: docs@izenzo.co.za  
**Label**: "Core Positioning Feedback"

---

**Document Version**: 1.0  
**Last Reviewed**: 2025-11-28  
**Next Review**: 2025-12-28
