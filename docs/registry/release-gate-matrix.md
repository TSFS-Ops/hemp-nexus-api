# Registry — Release Gate Matrix (Batch 18)

> Default final release status is **not** `production_ready`.
> The canonical machine-readable matrix lives in
> [`src/lib/registry-release-gate-ssot.ts`](../../src/lib/registry-release-gate-ssot.ts)
> (`RELEASE_GATE_MATRIX`). This document mirrors that SSOT for human review.

## Release statuses

| Status | Meaning |
| --- | --- |
| `not_started` | Module not yet built. |
| `blocked` | Hard blocker present; cannot ship. |
| `partial` | Some sub-modules complete, others outstanding. |
| `uat_ready` | Acceptable for controlled internal UAT. |
| `demo_ready` | Acceptable for a controlled, labelled demo. |
| `production_blocked` | Production explicitly blocked pending an accepted gate. |
| `production_ready` | All accepted production gates pass — never the default. |

## Modules covered

- Registry foundation
- Product truth / readiness
- Business decisions register
- Field-level provenance
- Country coverage
- Import pipeline
- Public registry search
- Public company profile
- Claim workflow
- Authority-to-act workflow
- Bank-detail submission
- Bank-detail review
- Bank verification (live provider not yet enabled)
- Institutional API — `profile-status`
- Institutional API — `payment-status`
- API client management
- Company portal
- Admin operations centre
- Audit logging coverage
- RLS / security posture
- No raw bank exposure
- No personal contact leakage
- No provider payload leakage
- Demo / UAT controls
- Readiness wording controls

Each row carries: status, blocker (when applicable), owner, last-checked
date, next action and an evidence README reference. See the SSOT for
machine-readable values and the in-app view at
`/admin/registry/release-gate`.
