# Registry Evidence Index (Batches 1–18)

Central index of evidence for the controlled Business Registry build.
Each row lists the batch, accepted status, evidence README path, known
limitations and outstanding production blockers.

> Default final release status across the registry is **not**
> `production_ready`. See `docs/registry/release-gate-matrix.md`.

| Batch | Name | Status | Evidence README | Known limitations / production blockers |
| --- | --- | --- | --- | --- |
| 1 | Registry foundation | accepted | `evidence/batch-1-registry-foundation/README.md` | Readiness held at controlled-test mode. |
| 2 | Provenance, coverage, imports | accepted | `evidence/batch-2-registry-provenance-coverage-imports/README.md` | Coverage controlled country-by-country. |
| 3 | Public registry + claim workflow | accepted | `evidence/batch-3-public-registry-claim-workflow/README.md` | Claim ≠ verification. |
| 4 | Authority + bank-detail status | accepted | `evidence/batch-4-authority-bank-detail-status/README.md` | Authority ≠ verification. |
| 5 | Institutional API management | accepted | `evidence/batch-5-institutional-api-management/README.md` | Production API disabled by default. |
| 6 | Operations / outreach / readiness | accepted | `evidence/batch-6-registry-operations-outreach-readiness/README.md` | No external send. |
| 7 | Search + claim rules hardening | accepted | `evidence/batch-7-registry-search-claim-rules-hardening/README.md` | Review-gated. |
| 8 | Record search / profile | accepted | `evidence/batch-8-registry-record-search-profile/README.md` | No verified wording on profiles. |
| 9 | Source import validation | accepted | `evidence/batch-9-registry-source-import-validation/README.md` | Imported ≠ verified. |
| 10 | Import-to-claim lifecycle | accepted | `evidence/batch-10-import-to-claim-lifecycle/README.md` | Lifecycle remains review-gated. |
| 11 | Real claim submission / review | accepted | `evidence/batch-11-real-claim-submission-review/README.md` | Approval ≠ verification. |
| 12 | Authority-to-act request / review | accepted | `evidence/batch-12-authority-to-act-request-review/README.md` | Personal contacts admin-only. |
| 13 | Bank-detail submission / review | accepted | `evidence/batch-13-bank-detail-submission-review/README.md` | Captured ≠ verified. |
| 13B | Bank-detail UI wiring | accepted | `evidence/batch-13b-bank-detail-ui-wiring/README.md` | Captured ≠ verified. |
| 14B | Bank verification UI / status | accepted | `evidence/batch-14b-bank-verification-ui-status/README.md` | Live provider not yet enabled. |
| 15 | Institutional API hardening | accepted | `evidence/batch-15-institutional-api-hardening/README.md` | Production access disabled by default. |
| 15B | Institutional API admin UI | accepted | `evidence/batch-15b-institutional-api-admin-ui/README.md` | Production approval requires acknowledgement. |
| 16 | Company portal guided journey | accepted | `evidence/batch-16-company-portal-guided-journey/README.md` | Deterministic next-step engine. |
| 17 | Admin operations centre | accepted | `evidence/batch-17-registry-admin-operations-centre/README.md` | Role-gated; read-only aggregations. |
| 18 | End-to-end UAT, release gate, demo pack | accepted | `evidence/batch-18-end-to-end-uat-release-demo/README.md` | Default final status not `production_ready`. |

## Cross-cutting guarantees

- No raw bank details exposed to public, company, admin (full), or API
  surfaces.
- No full API keys displayed after creation.
- No raw provider payloads exposed.
- No personal contact leakage to general authenticated users.
- No automatic approvals across claim, authority, bank-detail, or
  verification workflows.
- No external notifications or outreach triggered from demo/UAT data.
- RLS enforced on all new registry tables; admin tables role-gated.
