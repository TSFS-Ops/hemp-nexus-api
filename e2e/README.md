# Daniel Retest Pack — Smoke A–D (Playwright)

Automates the four-row internal smoke gate before sending Daniel:

| Row | Surface | Pass criterion |
|-----|---------|----------------|
| A | `/hq/legal-holds` non-AAL2 apply | Persistent inline MFA alert survives toast TTL |
| B | `/hq/legal-holds` AAL2 apply | Active hold row survives hard refresh |
| C | `/desk/billing` refund request | "Refund request pending" badge survives hard refresh |
| D | `/desk/billing` duplicate refund | Server returns `REFUND_ALREADY_PENDING`; pending badge persists; no orphan button |

## One-time install

```bash
npm i -D @playwright/test otpauth
npx playwright install chromium
```

## Provision staging fixtures (one command)

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
export SMOKE_PASSWORD="ChangeMe-Smoke-A-D-2026"
bash scripts/seed-smoke-a-d.sh > .env.smoke
source .env.smoke
```

The `seed-smoke-a-d-fixtures` edge function provisions, idempotently:

| Account | Email | Notes |
|---------|-------|-------|
| Platform admin (no MFA) | `smoke-admin-nomfa@test.izenzo.co.za` | Row A |
| Platform admin (TOTP) | `smoke-admin-mfa@test.izenzo.co.za` | Row B — verified `auth.mfa_factors` row with the base32 secret |
| Org admin | `smoke-org-admin@test.izenzo.co.za` | Rows C + D |

Plus on the org:
- `token_purchases` ref `smoke-ad-clean-001` — completed, no refund (Row C)
- `token_purchases` ref `smoke-ad-pending-001` — completed, pre-seeded `pending` refund (Row D precondition)

The org is flagged `is_demo=true` so lifecycle / billing crons skip it.


## Run

```bash
export SMOKE_ENV=staging                  # REQUIRED — TOTP helper refuses otherwise
export SMOKE_BASE_URL="https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app"
export SMOKE_ADMIN_EMAIL="..."            # platform_admin, NO TOTP enrolled
export SMOKE_ADMIN_PASSWORD="..."
export SMOKE_ADMIN_AAL2_EMAIL="..."       # platform_admin, TOTP enrolled
export SMOKE_ADMIN_AAL2_PASSWORD="..."
export SMOKE_ADMIN_AAL2_TOTP_SECRET="..." # base32; never commit, never echo
export SMOKE_ORG_EMAIL="..."              # org with a completed purchase, no pending refund
export SMOKE_ORG_PASSWORD="..."
export SMOKE_LEGAL_HOLD_SCOPE_ID="00000000-0000-0000-0000-000000000000"

npx playwright test
```

## TOTP handling (staging only)

Both the automated suite and the manual helper enforce two rules:

1. **Staging-only.** `SMOKE_ENV` must be `staging` or `test`. Anything else
   (including unset) makes the TOTP helper refuse. This prevents production
   TOTP material from being used by test tooling.
2. **No logging.** The secret and the generated 6-digit code are never
   written to stdout, stderr, Playwright traces, error messages, or disk.
   Call sites pass the env-var *name* (`"SMOKE_ADMIN_AAL2_TOTP_SECRET"`),
   not the value — the helper reads it itself.

**Manual code (interactive, no echo):**

```bash
SMOKE_ENV=staging node scripts/totp-prompt.mjs
# Pastes the secret with terminal echo OFF, prints the current code once.
# Nothing is persisted; secret is never echoed back.
```

Never paste the secret as an argv (`node script.mjs SECRET`) — argv lands
in shell history and `ps` output. Always use the hidden prompt or env var.



## Gate

If any row fails — **do not send Daniel**. Fix and re-run. Only when all four
rows are green is the status `DANIEL_RETEST_PACK_READY_TO_SEND`.

## Evidence bundle

Each test row writes structured evidence (milestone screenshots, console
log, network trace with `x-request-id`/`sb-request-id` headers, summary
JSON with status + error + duration) into `evidence/<row-slug>/`.

After a run, package everything into one downloadable zip:

```bash
npm run smoke:daniel:evidence
# → /mnt/documents/smoke-a-d-evidence-<timestamp>.zip
```

The zip contains `evidence/index.html` (per-row pass/fail table with
request IDs to follow into edge-function logs) and the full Playwright
HTML report. No request bodies, auth headers, or TOTP codes are ever
captured — only response trace headers from a fixed allowlist.

---

## Role-Negative & E2E suite (one command)

End-to-end runner: seed → coverage guard → critical Playwright suite → evidence zip → run summary.

```bash
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."          # admin service-role key
export E2E_RN_PASSWORD="ChangeMe-RoleNeg-2026"  # ≥12 chars

# Inspect what's set (values never printed) and confirm output paths:
bash scripts/run-role-negative-e2e.sh --show-env

# Run the full suite:
bash scripts/run-role-negative-e2e.sh
```

Help: `bash scripts/run-role-negative-e2e.sh --help`

Outputs (final two lines of the run):

```
==> EVIDENCE ZIP: /mnt/documents/role-negative-e2e-<run-id>.zip
==> RUN SUMMARY: /mnt/documents/role-negative-e2e-<run-id>.run-summary.json
```

- `*.zip` — per-test artefacts, evidence.jsonl, Playwright HTML report.
- `*.run-summary.json` — pass/fail/skip counts, skipped-test list (incl. RN-DEF-06),
  exit status, and `touched_real_data` flags (all `false` by construction: suite is
  pinned to `E2E_RN_ENV=live-demo`, seeded TEST/UAT rows, sandbox API keys).

Override the output directory with `EVIDENCE_OUT_DIR=/path`. Disable the summary
file with `WRITE_RUN_SUMMARY=0`.
