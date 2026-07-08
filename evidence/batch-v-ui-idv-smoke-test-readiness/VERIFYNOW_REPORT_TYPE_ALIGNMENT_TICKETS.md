# VerifyNow Report-Type Mismatch — Findings and Alignment Tickets

Status marker: VERIFYNOW_ALIGNMENT_TICKETS_RECORDED

Date: 2026-07-08
Workstream: VerifyNow (South Africa / Nigeria person IDV) — provider contract alignment
Type: Documentation only. No runtime code, tests, migrations, schema, RLS, RPCs, secrets, IDV adapter, IDV UI, route table, manual-review, admin-review, or WaD-gate logic was changed to produce this record. No PR opened. No deploy performed.

## 1. Daniel's latest VerifyNow findings

Daniel reviewed the VerifyNow dashboard and documentation directly and reported the following back to this workstream:

1. The VerifyNow playground shows two modes: Sandbox (Free) and Production (Uses Credits).
2. 2. For staging, calls must use `"mode": "sandbox"`.
   3. 3. The base endpoint shown in the docs is `POST https://www.verifynow.co.za/api/external/verify`.
      4. 4. The South Africa basic ID verification docs show a request shape using `reportType: "said_verification"`, `idNumber`, and `mode`.
         5. 5. The South Africa ID + Photo docs show a request shape using `reportType: "home_affairs_id_photo"`, `idNumber`, and `mode`.
            6. 6. Daniel has not seen `home_affairs_real_time_idv` anywhere in the docs or dashboard screenshots reviewed so far.
               7. 7. The example South African ID numbers visible in the docs appear under `"mode": "production"`, so they must not be assumed to be approved sandbox fixtures.
                  8. 8. Daniel has not yet confirmed: official Nigerian NIN sandbox values; the exact Nigerian NIN report type; whether the Izenzo VerifyNow API key is enabled for Nigeria; or the contracts for Nigerian Virtual NIN, NIN slip, BVN, voter ID, phone lookup, or bank account check.
                    
                     9. Separately, Daniel logged in as a normal test user and inspected `/desk/idv/start` directly, confirming: the page is live; South Africa and Nigeria are both selectable issuing countries with the document options currently shown in the UI (South African ID number check, Home Affairs identity verification, Nigerian NIN / Virtual NIN / NIN slip / BVN / voter ID / phone number / bank account checks); Ghana shows "Manual review required"; the country dropdown also includes Kenya, Uganda, Zambia, Côte d'Ivoire and "Other country (manual review)"; and the page still uses a single free-text textarea ("Enter the required details for the selected document type.") rather than structured fields for any country/document type.
                    
                     10. ## 2. Current code mismatch (confirmed by direct repository inspection)
                    
                     11. Direct inspection of `src/lib/idv/route-table.ts`, `supabase/functions/_shared/idv-route-table.ts`, `supabase/functions/_shared/verifynow/adapter.ts`, `supabase/functions/idv-person-verify/index.ts` and `src/pages/desk/idv/IdvStart.tsx` on the current `main` branch confirms the following mismatches against Daniel's findings above:
                    
                     12. 1. The internal `document_type` value (e.g. `za_said_basic`, `za_home_affairs_enhanced`, `ng_nin`, `ng_virtual_nin`, `ng_nin_slip`, `ng_bvn`, `ng_voter_id`, `ng_phone_lookup`, `ng_bank_account_check`) is appended directly as a path segment to build the outbound provider URL, instead of being translated into a `reportType` value.
                         2. 2. There is no fixed `/verify` endpoint in use — the adapter's URL builder produces `.../api/external/<document_type>` instead of the documented `.../api/external/verify`.
                            3. 3. No `reportType` field is ever added to the outbound JSON body. A repo-wide code search confirms no occurrence of `said_verification`, `home_affairs_id_photo`, `home_affairs_real_time_idv`, `reportType`, or `report_type` anywhere in the codebase.
                               4. 4. `mode` is read from configuration (`VERIFYNOW_MODE`, default `sandbox`) but is only used server-side to decide whether an `Idempotency-Key` header is required for production; it is never included in the JSON body sent to VerifyNow.
                                  5. 5. The live UI (`IdvStart.tsx`) collects only a single free-text textarea value and submits it as `details_text`. It does not collect or send any of the structured fields the route table already declares as `required_fields` for each route (e.g. `said_number`, `surname`, `first_names` for South Africa; `nin`, `first_name`, `last_name` for Nigeria NIN, etc.).
                                    
                                     6. One mitigating finding: `supabase/functions/idv-person-verify/index.ts` already contains logic to accept a structured `payload` object from the client (filtered against the route's `required_fields`) and only falls back to `details_text` if no structured payload is supplied. This means the backend's acceptance contract is already partly ready; the larger gap is the adapter's outbound contract to VerifyNow itself, and the UI not yet collecting/sending structured fields.
                                    
                                     7. ## 3. Three scoped implementation tickets
                                    
                                     8. These tickets are written so they can be handed directly to implementation once Daniel/VerifyNow confirms the missing provider details. None has been started; no code has been changed.
                                    
                                     9. ### Ticket 1 — VerifyNow adapter contract alignment
                                    
                                     10. Objective: make the adapter send a fixed `/verify` endpoint with explicit `reportType` and `mode` fields, sourced from a new confirmed mapping table, never from the internal `document_type`; unmapped/unconfirmed routes must fail closed to `PROVIDER_MISCONFIGURED`.
                                     11. Files likely touched: `supabase/functions/_shared/verifynow/adapter.ts`; a new `supabase/functions/_shared/verifynow/report-type-map.ts`; adapter test file(s).
                                     12. Tests/guards required: outbound URL is always the fixed endpoint (never contains `document_type`); `reportType` and `mode` are always present in the outbound body for mapped routes; unmapped routes fail closed and never reach a live call.
                                     13. Hard limits: no changes to `idv-verify`, manual-review/admin-review policy, WaD gate policy, schema/migrations/RLS/RPCs; no production VerifyNow calls; no real identity data; no UI changes unless unavoidable.
                                     14. Dependencies on Daniel/VerifyNow: confirmed `reportType` strings for every South Africa and Nigeria document type; confirmation `mode` belongs in the body for all report types.
                                     15. Risks: an unconfirmed mapping could either fail safely or be misinterpreted by VerifyNow; keeping the mapping in its own file limits blast radius.
                                     16. Definition of done: no provider URL/report type is ever derived from internal identifiers; every outbound call includes `reportType` and `mode`; unmapped routes are tested fail-closed.
                                     17. Can start now or must wait: the mechanism (fixed endpoint, explicit fields, fail-closed mapping, tests) can be built now with every route left unconfirmed; no route may be populated with a real `reportType` until confirmed.
                                    
                                     18. ### Ticket 2 — IDV start structured fields UI
                                    
                                     19. Objective: replace the single free-text textarea with structured fields for confirmed live routes, sending a `payload` object to `idv-person-verify`, which already supports it; keep free-text only for manual-review routes.
                                     20. Files likely touched: `src/pages/desk/idv/IdvStart.tsx`; a field-label helper; the IDV start UI test file.
                                     21. Tests/guards required: structured fields render per route's `required_fields`; free-text textarea still renders (only) for manual-review/placeholder routes; submit body uses `payload` for live routes and `details_text` for manual-review routes.
                                     22. Hard limits: no real identity data in fixtures; no production VerifyNow calls; no change to manual-review behaviour or wording; no change to `idv-verify`.
                                     23. Dependencies on Daniel/VerifyNow: none required to build the mechanism (it only needs the already-declared `required_fields`); confirmation is required before implying any specific field is actually transmitted to the provider.
                                     24. Risks: shipping structured fields ahead of Ticket 1's confirmed mapping could imply full live verification when the provider call may still resolve to manual review; UI copy must avoid overstating this.
                                     25. Definition of done: all live SA/Nigeria routes present structured fields matching `required_fields`; manual-review routes unaffected; submit body shape is correct per route type.
                                     26. Can start now or must wait: can start now; does not need to wait on Daniel's confirmations, though it should ship in step with Ticket 1 so payload shapes line up.
                                    
                                     27. ### Ticket 3 — Route confirmation gating and evidence
                                    
                                     28. Objective: ensure no route is ever treated as confirmed/live until Daniel/VerifyNow has explicitly confirmed its contract, and keep an accurate evidence record of confirmation status per route.
                                     29. Files likely touched: `src/lib/idv/route-table.ts` and its server mirror `supabase/functions/_shared/idv-route-table.ts` (add a confirmation flag per entry); the existing drift-guard test `src/tests/batch-v-idv-routing.test.ts`; an evidence file recording confirmation status per route.
                                     30. Tests/guards required: client/server route-table sync guard extended to cover the confirmation flag; a test asserting an unconfirmed entry can never reach a live provider call; a test asserting every South Africa/Nigeria entry defaults to unconfirmed.
                                     31. Hard limits: no route may be marked confirmed without a documented confirmation from Daniel/VerifyNow; no production VerifyNow use; no real identity data; no resumption of client testing as part of this ticket.
                                     32. Dependencies on Daniel/VerifyNow: South Africa's two report types are the closest to confirmed but field-level details are still outstanding; Nigeria (NIN and all variants) has no confirmed report type, sandbox fixtures, or confirmation the Izenzo key covers Nigeria at all.
                                     33. Risks: if the gating default were ever skipped or flipped to "confirmed" prematurely, Tickets 1/2's work could go live with unverified contracts; this ticket exists specifically to prevent that.
                                     34. Definition of done: every route-table entry has an explicit, tested confirmation state; adapter and UI both respect it; the evidence file accurately reflects current confirmation status; client-testing status remains documented as paused.
                                     35. Can start now or must wait: the gating mechanism and evidence scaffolding can be built now with every entry defaulting to unconfirmed; flipping any specific route to confirmed must wait for Daniel/VerifyNow's explicit confirmation of that route.
                                    
                                     36. ## 4. Questions still required from Daniel/VerifyNow
                                    
                                     37. The exact Nigeria NIN report type, and whether Virtual NIN and NIN slip use different report types or the same one with a different field set. Whether `home_affairs_real_time_idv` is a valid, retired, or alternate report type name. The exact field name VerifyNow expects for the South African ID number (`idNumber` vs `said_number`) and whether names/date of birth are required at all for `said_verification`/`home_affairs_id_photo`. Officially confirmed sandbox-safe South African ID numbers and Nigeria NIN values, distinct from the examples already seen (which were flagged as appearing under `mode: "production"`). Confirmation that the Izenzo VerifyNow API key is enabled for Nigeria. The exact contracts (endpoint, report type, required fields) for Nigerian BVN, voter ID, phone lookup, and bank account check.
                                    
                                     38. ## 5. Current decision
                                    
                                     39. Live staging submissions to VerifyNow remain paused. Client testing (David/Daniel/James smoke test) remains paused. No implementation of Tickets 1-3 will begin until the provider contract is confirmed by Daniel/VerifyNow for the relevant route(s); Ticket scaffolding (fail-closed mechanisms, UI mechanism, gating/evidence structure) may be built ahead of confirmation, but no route may be flipped to live/confirmed, and no live provider call may be made, until confirmation is recorded.
                                    
                                     40. Final status: VERIFYNOW_ALIGNMENT_TICKETS_RECORDED
                                     41. 
