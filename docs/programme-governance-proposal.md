# Programme Governance Layer - Technical Proposal

**Date:** 7 March 2026  
**Version:** 1.0  
**Status:** Draft for stakeholder review

---

## 1. Executive Summary

The Trade.Izenzo API currently provides a tamper-evident governance infrastructure for commercial trade matching: recording proof of intention, verifying participant eligibility, maintaining immutable audit trails, and sealing evidence packs.

This proposal extends that infrastructure to support **government programme governance** - enabling departments and agencies to demonstrate exactly how programme budgets translate into approved participants, verified milestones, and delivered outcomes.

The extension reuses approximately 70% of existing infrastructure (entities, authority verification, hash-chained event stores, evidence packs, compliance cases) and adds four new data models and three new API endpoints.

---

## 2. Problem Statement

Across South Africa, government departments and agencies collectively return tens of billions of rand in unspent funds each year. A significant contributing factor is the inability to demonstrate clear delivery and accountability at each stage of programme implementation.

Current reporting relies on manual submissions, spreadsheets, and PDF reports - none of which provide:

- Cryptographically verifiable proof of participant eligibility
- An immutable, timestamped record of approvals and disbursements
- Traceable evidence linking budget allocations to delivered outcomes

The Trade.Izenzo Programme Governance Layer addresses this gap directly.

---

## 3. Target Institutions

| Institution | Relevance |
|---|---|
| Eastern Cape Rural Development Agency (ECRDA) | Programme implementation, contractor management |
| Department of Cooperative Governance and Traditional Affairs (COGTA) | Coordination, traditional authority engagement |
| Department of Forestry, Fisheries and the Environment (DFFE) | Environmental and climate-related programme delivery |

---

## 4. Core Capabilities

### 4.1 Proof of Intention

**Existing infrastructure (no new development required)**

When a contractor or implementing agent is onboarded to a programme, their formal intent to participate is recorded as a **Signal** in the system. This creates an immutable, timestamped record - equivalent to a signed letter of intent, but cryptographically verifiable.

- `POST /signals` - records intent to participate
- `POST /match/{id}/settle` - confirms intent (500-token governance burn)
- Hash-chained `match_events` table provides tamper-evident timeline

### 4.2 Eligibility Verification

**Existing infrastructure (no new development required)**

Before any funds move, the system verifies that participants have the authority and capability to receive them.

- **Entity registration** (`POST /entities`) - registers the legal entity (contractor, agency, community organisation)
- **UBO verification** (`POST /authority-bind`) - confirms beneficial ownership above 25% threshold
- **Authority-to-Bind** (`POST /authority-bind`) - verifies the signatory has legal authority to act on behalf of the entity
- **Sanctions & PEP screening** (`POST /entities` with `X-Action: screen`) - screens against sanctions and politically exposed persons lists
- **Trade Approval gate** (`GET /trade-status`) - confirms the entity has passed all gates before participation is approved

### 4.3 Immutable Audit Record

**Existing infrastructure (no new development required)**

Every approval, document upload, status change, and milestone completion is recorded in an append-only event store with SHA-256 hash chaining.

- `event_store` - append-only, mutation-proof (database trigger enforced)
- `collapse_ledger` - cryptographically signed entries with NTP-synchronised timestamps
- `audit_logs` - per-organisation audit trail with actor identification
- `match_events` - hash-chained event timeline per engagement

Database triggers (`prevent_event_store_mutation`, `prevent_collapse_ledger_mutation`) enforce immutability at the database level - no application code can alter historical records.

### 4.4 Delivery Evidence *(New Development Required)*

This is the primary extension. The system currently tracks trade delivery milestones via `pods` and `pod_milestones`, but these are structured around commercial trade semantics. Government programme delivery requires:

- **Programme-level containers** with budget tracking
- **Participant roles** (contractor, implementing agent, beneficiary)
- **Milestone-linked fund disbursements** with state tracking
- **Programme-level reporting** aggregating all activity

---

## 5. New Data Model

### 5.1 `programmes` Table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `org_id` | UUID | Owning organisation (department/agency) |
| `name` | TEXT | Programme name |
| `department` | TEXT | Responsible department |
| `fiscal_year` | TEXT | e.g. "2025/2026" |
| `budget_allocated` | NUMERIC | Total budget allocated (ZAR) |
| `budget_committed` | NUMERIC | Amount committed to approved participants |
| `budget_disbursed` | NUMERIC | Amount actually disbursed |
| `objectives` | JSONB | Structured programme objectives |
| `status` | TEXT | `draft → active → reporting → closed` |
| `created_at` | TIMESTAMPTZ | Record creation |
| `updated_at` | TIMESTAMPTZ | Last modification |

### 5.2 `programme_participants` Table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `programme_id` | UUID | FK → `programmes` |
| `entity_id` | UUID | FK → `entities` (reuses existing entity infrastructure) |
| `role` | TEXT | `contractor`, `implementing_agent`, `beneficiary`, `oversight` |
| `trade_approval_id` | UUID | FK → links to existing eligibility gate result |
| `status` | TEXT | `pending → eligible → approved → suspended` |
| `approved_at` | TIMESTAMPTZ | When eligibility was confirmed |
| `approved_by` | UUID | Actor who approved |
| `created_at` | TIMESTAMPTZ | Record creation |

### 5.3 `programme_milestones` Table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `programme_id` | UUID | FK → `programmes` |
| `participant_id` | UUID | FK → `programme_participants` |
| `name` | TEXT | Milestone description |
| `due_at` | TIMESTAMPTZ | Expected completion date |
| `completed_at` | TIMESTAMPTZ | Actual completion date |
| `budget_tranche` | NUMERIC | Amount linked to this milestone (ZAR) |
| `evidence_document_id` | UUID | FK → document proving completion |
| `status` | TEXT | `pending → in_progress → completed → overdue → disputed` |
| `verified_by` | UUID | Actor who verified completion |
| `verified_at` | TIMESTAMPTZ | Verification timestamp |
| `created_at` | TIMESTAMPTZ | Record creation |

### 5.4 `fund_flows` Table

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `programme_id` | UUID | FK → `programmes` |
| `milestone_id` | UUID | FK → `programme_milestones` (nullable) |
| `participant_id` | UUID | FK → `programme_participants` |
| `flow_type` | TEXT | `allocation`, `commitment`, `disbursement`, `return` |
| `amount` | NUMERIC | Amount (ZAR) |
| `currency` | TEXT | Default `ZAR` |
| `reference` | TEXT | External reference (payment reference, PO number) |
| `payload_hash` | TEXT | SHA-256 hash for chain integrity |
| `previous_hash` | TEXT | Hash of previous fund_flow entry (chain) |
| `idempotency_key` | TEXT | Prevents duplicate entries |
| `recorded_by` | UUID | Actor |
| `created_at` | TIMESTAMPTZ | Immutable timestamp |

The `fund_flows` table will be **append-only** (protected by the same database trigger pattern used for `collapse_ledger` and `event_store`).

---

## 6. New API Endpoints

### 6.1 `POST /programmes` - Create Programme

```json
{
  "name": "Eastern Cape Rural Water Supply",
  "department": "ECRDA",
  "fiscal_year": "2025/2026",
  "budget_allocated": 45000000,
  "objectives": {
    "primary": "Install 120 rural water points",
    "secondary": "Train 60 community maintenance teams"
  }
}
```

**Response:** Programme object with `id`, `status: "draft"`

### 6.2 `POST /programmes/{id}/participants` - Add Participant

```json
{
  "entity_id": "uuid-of-registered-entity",
  "role": "contractor"
}
```

The system automatically checks the entity's `trade_approval` status. If the entity has not passed the eligibility gate, the participant status remains `pending`.

### 6.3 `POST /programmes/{id}/milestones` - Define Milestones

```json
{
  "participant_id": "uuid",
  "name": "Complete borehole drilling - Ward 12",
  "due_at": "2026-06-30T00:00:00Z",
  "budget_tranche": 3750000
}
```

### 6.4 `POST /fund-flow` - Record Fund Movement

```json
{
  "programme_id": "uuid",
  "milestone_id": "uuid",
  "participant_id": "uuid",
  "flow_type": "disbursement",
  "amount": 3750000,
  "reference": "PAY-2026-0342"
}
```

Each entry is SHA-256 hash-chained. The table is append-only.

### 6.5 `GET /programmes/{id}/report` - Programme Accountability Report

Returns a structured JSON report containing:

- Programme metadata and budget summary
- Participant list with eligibility status
- Milestone timeline with completion evidence
- Fund flow waterfall (allocated → committed → disbursed → verified)
- Hash chain integrity status

---

## 7. Infrastructure Reuse Summary

| Existing Component | Reused For |
|---|---|
| `entities` + `authority_records` | Participant registration and authority verification |
| `trade_approval` + `trade_status` | Eligibility gate before programme participation |
| `event_store` (append-only, hash-chained) | All programme state transitions |
| `collapse_ledger` | Cryptographic proof of critical actions |
| `attestations` | Milestone sign-off and accountability attestations |
| `match_documents` + storage | Evidence document uploads |
| `compliance_cases` | Flagging participants for review |
| `audit_logs` | Per-action audit trail |
| Token metering (`atomic_token_burn`) | Commercial billing for API usage |

---

## 8. Security & Compliance

- All new tables will have **Row-Level Security** policies scoped to `org_id`
- `fund_flows` is **append-only** (database trigger enforced - no UPDATE or DELETE)
- All API endpoints require **API key or JWT authentication**
- Every state transition records the **actor identity** (user or API key)
- Hash chains enable **independent verification** - any auditor can recompute the chain

---

## 9. Estimated Development Effort

| Phase | Scope | Estimate |
|---|---|---|
| 1. Schema & Migrations | 4 tables, RLS policies, append-only triggers | 1 session |
| 2. Edge Functions | 3 new endpoints (programmes, fund-flow, programme-report) | 1 session |
| 3. Dashboard UI | Programme list, detail view, milestone timeline, fund flow chart | 1–2 sessions |
| 4. Testing & Documentation | End-to-end flow, API documentation | 1 session |

**Total: 4–5 focused sessions**

---

## 10. Commercial Structure

The Programme Governance Layer is licensed as part of the Trade.Izenzo API platform. Institutional contracts can be structured as:

- **Per-programme subscription** - annual fee per active programme
- **Per-transaction metering** - token-based billing for API calls (existing model)
- **Enterprise licence** - unlimited programmes for a department/agency

---

## 11. Next Steps

1. Confirm data model with stakeholder requirements
2. Build schema and migrations
3. Implement edge functions
4. Deploy dashboard UI
5. Pilot with first institutional partner

---

*This document was generated from the current Trade.Izenzo API architecture and represents capabilities that can be delivered on the existing platform infrastructure.*
