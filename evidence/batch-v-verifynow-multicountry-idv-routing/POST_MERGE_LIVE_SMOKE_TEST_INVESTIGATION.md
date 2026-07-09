## Post-merge live smoke test investigation (2026-07-09)

Status marker: VERIFYNOW_INTERNAL_SMOKE_FAILED_PROVIDER_NOT_CALLED_INVOKE_ERROR_PATH_NO_PERSISTED_RECORDS

## 1. Trigger

The user manually exercised https://www.izenzo.co.za/desk/idv/start under an authenticated account (tendaitshamu@icloud.com) and submitted five identity checks using confirmed sandbox fixtures only (SA 8001015009087 and 9111060123086 against za_said_basic and za_home_affairs_enhanced; Nigeria NIN 12345678901 against ng_nin; and the same Nigeria NIN value against the unconfirmed ng_virtual_nin route). All five submissions returned the identical toast: "Manual review required -- Your submission has been queued for an administrator to review." No real identity data was used. No production VerifyNow mode was used. No code, secrets, or configuration were changed during this investigation.

## 2. Frontend publish observation

The structured single-field UI described in section 4 of CONTRACT_ALIGNMENT_IMPLEMENTATION.md (CONFIRMED_STRUCTURED_FIELDS in src/pages/desk/idv/IdvStart.tsx, merged in PR #23, commit 1eef6d9) is confirmed live on the custom domain for an authenticated session navigated to directly in this investigation. This proves the current main branch frontend code is being served on www.izenzo.co.za. The exact publish mechanism (manual Lovable Publish click versus an automatic custom-domain sync on push to main) could not be determined from repository contents alone; no GitHub Actions workflow, vercel.json, netlify.toml or CNAME file deploys the frontend, consistent with hosting being handled entirely inside Lovable's own platform, outside the repository.

## 3. Database inspection method and result

Using the authenticated session's own Supabase access token and the public anon key (both read from the browser's own local storage and script bundle, exactly as the live application itself uses them), read-only PostgREST queries were run against the same project used by idv-person-verify (ugrfyhwlonlmlcmcpcdm), scoped entirely by that account's own row-level security. p5scr_subjects, p5scr_idv_records and p5scr_manual_reviews all returned zero rows for this account at the time of inspection. No service-role key, secret, or elevated credential was used or requested.

## 4. Code-level root cause analysis

Reading the current main branch source of src/pages/desk/idv/IdvStart.tsx shows that the toast text seen in all five screenshots ("Manual review required" / "Your submission has been queued for an administrator to review.") is emitted from exactly one branch: the catch-style handling of a non-success (error) result from supabase.functions.invoke("idv-person-verify"). The alternative, successful branch reads internal_status from a 200 response and calls toast.success with a different label. Because every screenshot shows the first wording, none of the five submissions completed through the normal success response path of idv-person-verify, including the two SA confirmed-route tests and the ng_nin confirmed-route test.

Two further gaps were found in this same handler. First, the fallback path calls supabase.functions.invoke("idv-open-manual-review") without checking or even reading its returned error, so if that call itself fails, the user still sees the reassuring "Manual review required" message with nothing actually recorded. Second, reading supabase/functions/idv-person-verify/index.ts shows a subject-ownership check that returns 403 FORBIDDEN whenever the subject row referenced by subject_id cannot be found by exact id lookup; combined with the empty p5scr_subjects table observed for this account, a missing or not-yet-visible subject row is a plausible concrete trigger for the failures observed, though this could not be confirmed to the exact HTTP status code without Edge Function invocation logs, which were not available in this session.

CORS was checked and ruled out as a cause: supabase/functions/_shared/cors.ts hardcodes https://www.izenzo.co.za in PRODUCTION_ORIGINS as an always-allowed origin independent of the ALLOWED_ORIGINS environment variable.

## 5. Answers to the standing questions

Frontend published: yes, in effect -- current main branch UI is live on the custom domain; exact mechanism unconfirmed from repository evidence alone.

Did the three confirmed routes call VerifyNow sandbox: no evidence that they did. The client-side call to idv-person-verify itself did not complete successfully for any of the five tests, so the request is very unlikely to have reached the point in idv-person-verify's code that calls the VerifyNow adapter.

Did the unconfirmed ng_virtual_nin route call VerifyNow: no evidence that it did; it produced the same generic failure wording as the confirmed routes, which is also consistent with (but does not on its own prove) the intended fail-closed behaviour for unconfirmed routes.

Was any production VerifyNow call made or possible: no evidence of any provider call at all, production or sandbox.

Was any real identity data used: no, only the confirmed sandbox fixture values listed above.

Should client testing remain paused: yes.

## 6. Remaining blockers

Confirming the exact cause requires either Supabase Edge Function invocation logs for idv-subject-provision and idv-person-verify (not accessible from this session), or a single supervised, explicitly authorised diagnostic reproduction with browser console/network inspection open, using only the confirmed sandbox fixtures above. Neither has been done. Client/Daniel testing must remain paused until the actual failure is identified and a real successful sandbox pass (or a correctly recorded, verifiably-persisted manual review) is demonstrated.

Final verdict: VERIFYNOW_INTERNAL_SMOKE_FAILED_PROVIDER_NOT_CALLED_INVOKE_ERROR_PATH_NO_PERSISTED_RECORDS
