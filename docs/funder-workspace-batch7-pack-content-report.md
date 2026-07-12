# Institutional Funder Evidence Workspace — Batch 7: Evidence-Pack Content Integration

Status: `FUNDER_WORKSPACE_BATCH7_PACK_CONTENT_PARTIALLY_CONNECTED`

This batch replaces placeholder evidence-pack sections with real, safe, auditable data from existing Izenzo records, per the Batch 7 brief. It continues directly from `docs/funder-workspace-forensic-audit-report.md`, which is not repeated here. All work was performed by direct GitHub-web source inspection; no terminal, live Supabase connection, or Edge Function invocation was available in this environment. That limitation, and its consequences for verification, is stated explicitly in the Commands run / Pass-fail section below.

## 1. Phase 1 — Authoritative source-mapping matrix

The repository contains three separate, non-integrated funder-related data models (legacy `p5_batch3_funder_*` keyed by `transaction_reference`; `p5_batch4_execution_cases`/`funder_releases` keyed by `case_reference`; and the V1 `funder_deal_releases`/`fw_*` keyed by `deal_reference`), plus a `p5scr_*` screening/IDV spine keyed by `subject_id`, a `p5_batch6` exception system keyed by `org_id`, and the core `matches`/`wads`/`match_documents`/`organizations` tables. `funder_deal_releases.deal_reference` is admin-typed free text with no FK anywhere in the schema — confirmed by reading `src/pages/admin/funder-workspace/NewRelease.tsx`, which is a plain `<Input>` with no lookup, autocomplete, or format validation. This is the governing fact behind every row below.

| Pack section | Authoritative source (file / table / RPC) | Join path | Confidence | Decision |
|---|---|---|---|---|
| Buyer summary | `matches.buyer_org_id` -> `organizations` (`legal_name`, `trading_name`, `registration_number`, `jurisdictions`) — schema confirmed in `supabase/migrations/20260305233555_...sql` | `deal_reference` resolved as `matches.id` -> `buyer_org_id` | Medium | Implemented, gated on resolution |
| Seller summary | Same, via `seller_org_id` | Same | Medium | Implemented, gated on resolution |
| Verification summary | `p5scr_subjects` (`organisation_id`, `party_role`) joined to `p5scr_check_state` (`category`, `state`) — `supabase/migrations/20260626181220_...sql` | `organizations.id` -> `p5scr_subjects.organisation_id` | Medium | Implemented, gated on resolution |
| IDV / KYB summary | Same spine, `category = 'idv_person'` | Same | Medium | Implemented, gated on resolution |
| WaD status | `wads` (`poi_id = matches.id`, `status`, `sealed_at`, `seal_hash`) — same relationship already used by `supabase/functions/deal-certificate/index.ts` | `matches.id` -> `wads.poi_id` | Medium-High | Implemented, gated on resolution |
| Bank-confidence | None found anywhere in the repository. A repo-wide search for `bank_confidence` returned zero results; the only related hit, `bank_account_holder_mismatch`, is a document-review rejection reason (`src/lib/p5-batch2/constants.ts`, `src/lib/p5-batch4/blockers.ts`), not a verification record. | — | Low — unresolved | Not implemented. Always returns explicit `not_applicable`. |
| Evidence register | `match_documents` (`doc_type`, `filename`, `status`, `sha256_hash`, `created_at`), scoped by `match_id` | `matches.id` -> `match_documents.match_id` | Medium-High | Implemented, gated on resolution |
| Missing evidence | No canonical required-evidence checklist exists at the match level anywhere in this codebase (searched `match_documents`, `p5_batch2`, `p5_batch4` schemas). Only the "received" side is derivable, from the evidence register above. | — | Low — unresolved | Not implemented. Always returns explicit `not_configured` with the exact reason. |
| Risk / exception summary | `p5b6_list_exceptions_safe(_limit, _offset, _queue, _status, _priority)` — existing safe RPC used by the P-5 Batch 6 admin workbench (`src/pages/admin/p5-batch6/Workbench.tsx`) | Filtered in-function to rows where `org_id` is the resolved buyer or seller organisation id | Medium | Implemented, gated on resolution, explicitly labelled organisation-scoped (not deal-scoped — no deal-scoped exception source exists) |
| Finality snapshot | `p5_batch4_execution_cases.finality_status` / `p5_batch4_finality_records` | No reliable join found. `linked_transaction_id` on `p5_batch4_execution_cases` (`supabase/migrations/20260625110840_...sql`) has no FK constraint and is never populated from `matches`/`deal_reference` in any code path found in this repository. | Low — unresolved | Not implemented. Always returns explicit `not_configured` naming the exact decision needed. |
| Audit summary | `fw_audit_events` (already deal-scoped correctly) | Direct | High | Already correct; reviewed only, unchanged |
| Hash / seal details | `funder_pack_versions` (pack id, version, `file_sha256`, timestamps) | Direct | High | Already correct; disclaimer strengthened (see Phase 7 note below) |

## 2. Decision on deal_reference resolution

Given `deal_reference` has no FK, the new projection function attempts to resolve it as a `matches.id` UUID at read time. When it resolves, every match-scoped section (buyer/seller/verification/IDV-KYB/WaD/evidence register/risk-exception) is populated from real records. When it does not resolve (not UUID-shaped, or no matching row), those sections return an explicit `"No linked record was available at the time of generation."` status — never fabricated, never inferred. This was implemented as a best-effort, non-blocking resolver rather than a hard reject at generation time. The brief's Phase 6 preferred approach was to reject generation outright when the reference does not resolve, with a carve-out for releases "explicitly marked" legacy — but no such marking mechanism exists anywhere in the schema, and introducing a hard reject today would immediately block every existing and future release created with the current free-text field, which directly conflicts with the equally explicit "do not break existing releases" instruction. I resolved this tension by implementing the non-blocking approach and surfacing `deal_reference_resolved` in the edge function's JSON response so the admin UI can warn rather than silently succeed. Hard-rejecting unresolved references remains available as a follow-up once a decision is made on either enforcing UUID-only deal references going forward or adding an explicit `legacy_unlinked` flag to `funder_deal_releases`.

## 3. Files created

`supabase/migrations/20260712160000_fw_batch7_pack_content_projection.sql` — new `fw_admin_funder_pack_content_v1(p_release_id uuid)` SECURITY DEFINER RPC, additive only, platform-admin gated, read-only.

`src/tests/funder-workspace-batch7-pack-content.test.ts` — static source-conformance tests (see Section 6).

`docs/funder-workspace-batch7-pack-content-report.md` — this report.

## 4. Files changed

`supabase/functions/funder-pack-generate/index.ts` — added the `PackContent` type and section builders (`buildPartySummaryLines`, `buildVerificationLines`, `buildIdvKybLines`, `buildWadStatusLines`, `buildBankConfidenceLines`, `buildEvidenceRegisterLines`, `buildMissingEvidenceLines`, `buildRiskExceptionLines`, `buildFinalityLines`, `buildSections`); replaced the static `SECTIONS` placeholder array with dynamic content sourced from a new, best-effort call to `fw_admin_funder_pack_content_v1`; strengthened the disclaimer wording (added the funding-approval and hash-scope caveats required by the brief); added `deal_reference_resolved` to the JSON response. The existing context call (`fw_admin_pack_generation_context_v1`), seal call (`fw_admin_seal_pack_v1`), SHA-256 computation order, storage upload, watermark, and cleanup-on-failure logic were left unchanged.

## 5. Migrations added / RPC changes

One new migration, one new RPC, as listed in Section 3. No existing migration, table, enum, RLS policy, or RPC signature was modified.

## 6. Tests added

`src/tests/funder-workspace-batch7-pack-content.test.ts` contains 24 static source-conformance tests (readFileSync + regex/string assertions against the new migration and the edited edge function), covering: additivity (no ALTER/DROP), platform-admin gating, grant hygiene, UUID-only resolution, no-fabrication-on-unresolved, buyer/seller non-swap, exclusion of raw/sensitive fields, honest bank-confidence and finality-snapshot fallbacks, reuse of the existing safe exception RPC, graceful degradation on RPC failure, removal of the old generic placeholder array, retained watermark/disclaimer/hash-ordering regressions.

## 7. Commands run — pass/fail results

None. This environment has no terminal or code-execution tool available (browser automation only), so `npx vitest run` and `npx tsgo --noEmit` could not be executed, and no live Supabase connection or Edge Function invocation was available to exercise the new RPC or PDF generation against real data. The tests above were authored to run under vitest and are consistent with this repository's existing static-test conventions, but they have not been executed in this session. This is a genuine gap, not a claim of a passing suite — the recommended next action (Section 10) is to run the full regression suite in a terminal-capable environment before this batch is treated as verified.

## 8. Sections now fully connected

None are "fully" connected in the strictest sense, because every match-scoped section is contingent on the unresolved `deal_reference` -> `matches.id` join described above holding true for a given release.

## 9. Sections partially connected

Buyer summary, seller summary, verification summary, IDV/KYB summary, WaD status, and evidence register are now wired to real, safe, canonical data whenever `deal_reference` resolves to a real `matches.id`, and honestly report unavailability when it does not. Risk/exception summary is wired to a real, existing safe RPC, but is organisation-scoped rather than deal-scoped because no deal-scoped exception source exists in the platform.

## 10. Sections still unresolved, and the exact decision needed

Bank-confidence: no authoritative record of any kind exists in this platform. A product decision is needed on what "bank confidence" should mean (e.g. bank-account ownership match, a new verification integration, or removal of this section from V1) before any implementation is possible.

Finality snapshot: `p5_batch4_execution_cases` has no reliable link to `matches`/`deal_reference`. A product decision is needed: either add an explicit `case_id` column to `funder_deal_releases` populated at release time, or define and enforce a `deal_reference = case_reference` equality convention, before this section can be safely connected.

Missing evidence (required-and-missing side only): no canonical required-evidence checklist exists at the match level. A product decision is needed on what the required checklist per deal type should be, and where it should be stored, before "required and missing" can be computed honestly.

## 11. Remaining demo limitations

Deal releases must currently be created with a `deal_reference` that is exactly a `matches.id` UUID for the new content sections to populate; this is not enforced or explained anywhere in the admin UI (`NewRelease.tsx` still shows a plain free-text field). The risk/exception summary can show exceptions unrelated to the specific released deal because it is organisation-scoped. No genuine test execution has occurred (Section 7).

## 12. Controlled-pilot readiness verdict

Not yet ready. The core pipeline (sealed PDF, hashing, storage, signed download, audit, RFI/notes/decisions, notifications) remains sound per the prior forensic audit. This batch closes the majority of the placeholder-content gap for resolvable deals, but bank-confidence and finality remain genuinely unresolved, the `deal_reference` UUID convention is not enforced or surfaced to admins, and no test in this batch has been executed against a live database.

## 13. General-production readiness verdict

Not ready. In addition to the controlled-pilot gaps above, `deal_reference` still has no enforced referential integrity, and the two unresolved sections require explicit product decisions before they can be implemented at all.

## 14. Recommended next action

Decide and document the `deal_reference` -> canonical-record convention (enforce UUID-only at the admin form, or add a proper FK-backed selector), make the bank-confidence and finality product decisions above, then run the full test suite (`npx vitest run src/tests/funder-workspace-*.test.ts` and `npx tsgo --noEmit`) in a terminal-capable environment to convert this batch's static conformance tests into genuine, executed regression proof before any controlled-pilot claim is made.
