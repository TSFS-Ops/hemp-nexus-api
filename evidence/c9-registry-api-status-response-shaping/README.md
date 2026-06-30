# C9 F-API-01 — registry-bank-verification-api-status response shaping

**Status:** `C9_API_STATUS_RESPONSE_SHAPING_DEPLOYED_PENDING_VERIFICATION`

## Scope

Single edge-function response-shape change. No DB, no migration, no
RLS/grant, no cron, no business state, no provider call, no manual
invocation, no email/notification.

## Prior leak

`supabase/functions/registry-bank-verification-api-status/index.ts`
returned `verification_status` to external API consumers — exposing raw
internal pipeline vocabulary:

- `provider_pending`, `provider_check_in_progress`, `provider_matched`,
  `provider_mismatch`, `provider_error`, `provider_unavailable`
- `manual_review_required`, `captured_unverified`, `manual_verified`
- plus terminal states

External API consumers should not see internal verification pipeline
naming or provider taxonomy.

## Safe replacement

Public 200 response now contains only:

| Field                  | Source                                              |
| ---------------------- | --------------------------------------------------- |
| `ok`                   | literal `true`                                      |
| `request_id`           | per-request UUID                                    |
| `company_reference`    | echoed request input                                |
| `payment_detail_status`| `mapVerificationStatusToApiFlag()` — restricted set |
| `safe_label`           | `REGISTRY_BANK_VERIFICATION_PUBLIC_LABELS[…]`       |
| `audit_reference`      | mirrors `request_id`                                |

`payment_detail_status` is constrained by the `RegistryBankApiPaymentFlag`
type to: `verified | not_verified | expired | disputed | revoked |
not_available`. No internal/provider vocabulary leaks.

Error responses (400 / 401 / 403 / 500) continue to return only
`ok=false`, `request_id`, `payment_detail_status=not_verified`,
`safe_explanation` / `error`. None mention `verification_status`.

## Internal audit preserved

The pre-existing `registry_bank_detail_verification_events` insert still
records the full raw `verification_status` (along with `api_flag`,
`company_reference`, `request_id`, `client_id`) for admin/operator
review. Internal observability is unchanged.

## Verified gate strictness preserved

- Final `verified` requires unexpired record AND an approved
  `business_decisions` row (`category='api_output'`, `status='approved'`,
  matching `scope_key`).
- If unverified business decision → `apiFlag` is downgraded to
  `not_verified`.
- Expiry collapses `verified` to `expired`.
- Hashed `rk_` API-key check and scope enforcement unchanged.
- Safe 401/403 payloads unchanged.

## Files

- `supabase/functions/registry-bank-verification-api-status/index.ts`
- `src/tests/c9-api-status-response-shaping.test.ts`
- `evidence/c9-registry-api-status-response-shaping/README.md` (this file)

## Tests / guards

`src/tests/c9-api-status-response-shaping.test.ts` pins:

- success body has no `verification_status` key;
- success body still has `payment_detail_status`, `safe_label`,
  `audit_reference`, `request_id`, `company_reference`;
- every non-200 `json(req, …)` block has no `verification_status`;
- audit insert still writes `verification_status: verificationStatus`;
- `mapVerificationStatusToApiFlag` still drives `apiFlag`;
- business-decision downgrade + expiry collapse + `bdApproved` gate
  remain;
- auth (`rk_` prefix, `hashApiKey`) and scope check unchanged;
- only one `.from(…).insert(…)` call exists in the file (no new DB
  writes introduced);
- `RegistryBankApiPaymentFlag` literal type in
  `supabase/functions/_shared/registry-bank-verification.ts` is
  unchanged.

## Explicit non-changes

- ❌ No DB migration.
- ❌ No RLS, grants, policies, indexes, schema, or config change.
- ❌ No cron job altered.
- ❌ No other edge function deployed.
- ❌ Role helpers (`has_role`, `has_dd_role`) NOT touched (F-ROLE-01
  remains a separate, client-decision item).
- ❌ Registry/import table policies NOT touched (F-IMPORT-01 remains
  read-only further-inspection).
- ❌ C8 deferred verifier wording (Audit Ledger / Landing) NOT touched.
- ❌ No business / runtime data mutated.
- ❌ No emails or notifications sent.
- ❌ No provider calls.
- ❌ No manual invocation of the edge function for verification —
  runtime confirmation comes from natural external API consumer traffic
  observing the new shape, plus the static-source guard test above.

## Reversibility

Revert is a single line: re-add `verification_status: verificationStatus,`
to the public 200 response body in `index.ts` and redeploy.
