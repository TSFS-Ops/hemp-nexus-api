# P-5 Screening & IDV Provider-Ready Flow

Evidence directory for the P-5 Screening & IDV provider-ready internal build.

This batch is provider-ready only. No live external provider calls, no real
provider credentials, no claim of live verification.

## Phase 1 — SSOT registry (deployed)

Status marker: `P5_SCREENING_PHASE_1_DEPLOYED`

Files:

- `src/lib/p5-screening/registry.ts` — browser-safe SSOT
- `scripts/check-p5-screening-phase-1-registry.mjs` — drift guard
- `src/tests/p5-screening-phase-1-registry.test.ts` — vitest coverage

Pinned vocabulary:

- 5 check categories (`company_aml_sanctions`, `pep`, `watchlist_name`,
  `idv_person`, `adverse_media_admin_triggered`)
- 10 party roles + IDV-required-by-default subset
- 11 check states + clear/unresolved partitions
- 9 gates + block matrix (POI create / POI accept / WaD create never blocked
  by pending screening/IDV; `failed`/`rejected` block everything)
- 90-day reuse window + 5 invalidation triggers
- 10 allowed external phrases (verbatim)
- 15 banned external phrases (verbatim, guard-pinned, never rendered)
- 7 Memory-banned payload kinds
- 17 audit event names + 5 webhook event names (all `p5_screening.*`)
- 10 API-safe fields + 8 forbidden fields

Scope confirmation (Phase 1):

- No UI, no RPC, no API projection, no edge functions, no cron, no migrations
- No live provider calls, no provider credentials
- No payment-provider changes
- No Batch 6 / Batch 7 / Batch 8 surfaces touched
- No `app_role` enum widening
- No Memory or finality mutation
- No P-4 POI/WaD/Trading-Engine changes

Awaiting acceptance before proceeding to Phase 2 (canonical screening spine).
