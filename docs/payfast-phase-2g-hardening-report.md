# PayFast Phase 2G — Hardening Report (Option C: code hardening + stale row cleanup)

Status: **PAYFAST_PHASE_2G_READY_FOR_LIVE_CREDENTIAL_COLLECTION**

PayFast remains sandbox-only and admin-only at the customer surface.
No live PayFast credentials collected. No customer-facing PayFast
checkout. Paystack unchanged. No FX revival.

---

## 1. Files changed / added

| File | Action | Purpose |
| --- | --- | --- |
| `supabase/functions/_shared/payments/payfast-live-checkout.ts` | **new** | Pure dependency-injected orchestrator for LIVE checkout (live-only secrets, live-only URLs, live-only mode). |
| `supabase/functions/payfast-checkout-live/index.ts` | **new** | Admin-only LIVE checkout edge function. Triple-gated: `PAYFAST_LIVE_SMOKE_ENABLED=true` + `PAYFAST_MODE=live` + `platform_admin`. GET = availability probe (no side effects, no secrets). |
| `supabase/functions/payfast-itn/index.ts` | **edited** | `resolvePassphrase` rewritten as strict per-mode: live reads ONLY `PAYFAST_PASSPHRASE_LIVE`; sandbox keeps `PAYFAST_PASSPHRASE_SANDBOX` → legacy generic. No cross-mode fallback. |
| `src/components/desk/billing/PayfastLiveSmokeTestButton.tsx` | **new** | Red/danger-styled admin-only live smoke button. Hidden unless `isAdmin` AND probe reports `available: true`. Requires explicit confirm() before posting `mode: "live"`. |
| `src/pages/Billing.tsx` | **edited** | Mounts `<PayfastLiveSmokeTestButton />` directly under the existing sandbox button. |
| `src/components/desk/billing/BillingOverview.tsx` | **edited** | Same mount in the alternate overview surface. |
| `src/tests/payfast-phase-2g-no-regression.test.ts` | **new** | 20 guards: sandbox cannot use live creds, live cannot use sandbox creds, gates, passphrase order, FX absence, customer-facing absence. |
| `src/tests/payfast-phase-2b-no-regression.test.ts` | **edited** | Allowlist extended for new live files. |
| `src/tests/payfast-phase-2c-no-regression.test.ts` | **edited** | Allowlist extended for new live files. |
| `src/tests/payfast-phase-2d-no-regression.test.ts` | **edited** | Allowlist extended for new live files. |

Deployed: `payfast-checkout-live`, `payfast-itn`. (Sandbox checkout
function untouched.)

## 2. Tests run

| Suite | Tests | Result |
| --- | --- | --- |
| `payfast-phase-2g-no-regression` | 20 | ✅ all pass |
| `payfast-phase-2b-no-regression` | 16 | ✅ pass |
| `payfast-phase-2d-no-regression` | 12 | ✅ pass |
| `payfast-phase-2c-no-regression` | 15 | ⚠️ 14 pass / **1 pre-existing failure** unrelated to 2G — see §6 |

Phase 2G guards prove, on every CI run:

- `payfast-checkout-sandbox/index.ts` does NOT reference any `*_LIVE` secret;
- `payfast-checkout-live/index.ts` does NOT reference any `*_SANDBOX` or sandbox-legacy secret, nor `PAYFAST_SANDBOX_CHECKOUT_ENABLED`;
- live edge requires `PAYFAST_MODE=live`, `PAYFAST_LIVE_SMOKE_ENABLED=true`, `platform_admin`, body `provider=payfast`, body `mode=live`;
- `payfast-live-checkout.ts` writes `token_purchases` with `provider:"payfast"`, `mode:"live"`, `status:"pending"`, `currency:"ZAR"`, and parks `paystack_reference = "payfast_live::<m_payment_id>"`;
- the live button returns `null` unless `isAdmin` AND the probe reports `available === true`;
- the live button posts `mode: "live"` and never the sandbox literal;
- `select.ts` continues to register `payfast: undefined` (no customer-facing live registry entry);
- ITN handler's `resolvePassphrase` live branch contains `PAYFAST_PASSPHRASE_LIVE` and contains NO mention of `PAYFAST_PASSPHRASE_SANDBOX` or the legacy generic `PAYFAST_PASSPHRASE`;
- sandbox branch in `resolvePassphrase` does NOT contain `PAYFAST_PASSPHRASE_LIVE`;
- neither the live helper nor the live edge function imports `_shared/fx.ts`.

## 3. Stale sandbox rows handled

Pre-existing 4 stale `payfast` sandbox `token_purchases` rows from
pre-fix integration attempts were marked `abandoned` (in-place) with
metadata preserved and augmented:

| id | provider_reference | old status | new status | metadata.abandoned_reason |
| --- | --- | --- | --- | --- |
| `17df8e00…` | `izpf_mqycfhyl_b9jflvxl` | pending | **abandoned** | `phase_2g_cleanup_pre_signature_fix_sandbox_attempt` |
| `fb705bd1…` | `izpf_mqycgwzx_rsccatwj` | pending | **abandoned** | `phase_2g_cleanup_pre_signature_fix_sandbox_attempt` |
| `5f40aede…` | `izpf_mqycj2cj_3bnxo2pa` | pending | **abandoned** | `phase_2g_cleanup_pre_signature_fix_sandbox_attempt` |
| `f2ba5983…` | `izpf_mqyuxroc_gtq7x20r` | pending | **abandoned** | `phase_2g_cleanup_pre_signature_fix_sandbox_attempt` |

Extra metadata keys written: `abandoned_at`, `abandoned_by:
"phase_2g_hardening_migration"`, `phase_2f_status: "failed_pre_fix"`,
`crediting_forbidden: true`. Original metadata preserved by
`metadata || jsonb_build_object(...)`.

Guarantees:
- no credit applied (verified: 0 `token_ledger` rows for any of these references);
- no row deleted;
- no row marked `completed`;
- rows cannot appear as successful purchases (status filter excludes `abandoned`);
- cannot be accidentally completed by an unrelated ITN — the ITN handler matches on
  `provider='payfast' AND provider_reference = m_payment_id`, and each
  abandoned reference is unique. Even if PayFast were to replay one
  of these old ITNs, the new signature path would still reject it
  because the original transaction was signed against pre-fix state.
  Defensive: the ITN handler will still run idempotency checks and
  refuse to credit a non-`pending` row.

No audit/risk write was made for the abandonment itself — the
`audit_logs` history of the original `credits.purchase_initiated`
events plus the existing `admin_risk_items.payfast_itn_rejected` rows
for the failed ITNs already document the trail. The metadata stamp
provides full forensic context.

## 4. Confirmations

- ✅ No live PayFast credentials requested. The Phase 2G secret names
  are wired into the code but no `add_secret` call was made; the live
  edge function will hard-reject until those secrets exist.
- ✅ PayFast is NOT live. `PAYFAST_MODE` remains the default
  (`sandbox` when unset / when set to anything other than `"live"`)
  and `PAYFAST_LIVE_SMOKE_ENABLED` is not configured. The live edge
  function returns `gate_disabled` immediately on any POST today, and
  the GET probe returns `available: false`, which keeps the live
  button hidden.
- ✅ No customer-facing PayFast checkout exists. Both the sandbox and
  live buttons return `null` for non-admins, and `select.ts` keeps
  `payfast: undefined` in the live registry.
- ✅ Paystack runtime unchanged. No edit to `token-purchase`,
  `paystack-webhook`, or any Paystack helper this round.
- ✅ No FX code revived. Neither new file imports `_shared/fx.ts`;
  guarded by Phase 2G test.

## 5. Live secret names — wired, NOT collected

The code now resolves the following live secrets. They are not
collected yet — awaiting your explicit "collect live credentials"
instruction so they can be requested via `add_secret` (secure form):

- `PAYFAST_MERCHANT_ID_LIVE`
- `PAYFAST_MERCHANT_KEY_LIVE`
- `PAYFAST_PASSPHRASE_LIVE`
- `PAYFAST_NOTIFY_URL_LIVE` — recommended value: `https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/payfast-itn`
- `PAYFAST_RETURN_URL_LIVE` — recommended: `https://trade.izenzo.co.za/billing?payfast=return`
- `PAYFAST_CANCEL_URL_LIVE` — recommended: `https://trade.izenzo.co.za/billing?payfast=cancel`
- `PAYFAST_MODE` — to be flipped to `"live"` only for the smoke window
- `PAYFAST_LIVE_SMOKE_ENABLED` — set to `"true"` only for the smoke window

## 6. Remaining blockers

| Item | Severity | Action |
| --- | --- | --- |
| Pre-existing 2C test (`helper strips merchant_key from the returned form fields`) | low — unrelated to 2G | Triage in a follow-up: the 2F unblocker intentionally kept `merchant_key` in returned fields (PayFast requires it on the POST to `/eng/process`). The 2C assertion is out of date. Recommend updating the test to assert `merchant_key` IS returned for sandbox. Not blocking live readiness. |
| Live PayFast IP allowlist (`PAYFAST_ALLOWED_IPS`) | medium — required before live | Must be pinned to PayFast's published production IP list before flipping `PAYFAST_MODE=live`. ITN handler already enforces it in live mode (no bypass). |
| Live merchant credentials | required | Collect via `add_secret` after your go-ahead. |

## 7. Exact next step to collect live credentials securely

When you are ready, reply with:

> Collect live PayFast credentials.

I will then call `add_secret` for the six live secret names listed in
§5 (plus optionally `PAYFAST_LIVE_SMOKE_ENABLED` and a placeholder for
`PAYFAST_MODE` flip), which opens a single secure form. Values are
never requested or echoed in chat.

After secrets land, the recommended sequence (separate sign-off each
step):

1. Set `PAYFAST_MODE=live`, `PAYFAST_LIVE_SMOKE_ENABLED=true`, and
   `PAYFAST_ALLOWED_IPS` to the pinned production list.
2. Admin clicks "Start PayFast Live Smoke Test" → completes the
   smallest live charge → verifies single credit, ledger row, audit
   row, and duplicate-ITN no-double-credit.
3. Flip `PAYFAST_LIVE_SMOKE_ENABLED=false` and `PAYFAST_MODE=sandbox`
   immediately after sign-off. Live button auto-hides because the
   probe re-evaluates on mount.
4. Decide whether to expose PayFast as a customer-facing option (a
   separate phase — requires registering it in `select.ts` and the
   customer checkout UI, which is explicitly NOT part of Phase 2G).

---

Status: **`PAYFAST_PHASE_2G_READY_FOR_LIVE_CREDENTIAL_COLLECTION`**
