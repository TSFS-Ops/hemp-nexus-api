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

## Run

```bash
export SMOKE_BASE_URL="https://id-preview--95025ceb-b8ab-4906-adee-3188617c0dbc.lovable.app"
export SMOKE_ADMIN_EMAIL="..."           # platform_admin, NO TOTP enrolled
export SMOKE_ADMIN_PASSWORD="..."
export SMOKE_ADMIN_AAL2_EMAIL="..."      # platform_admin, TOTP enrolled
export SMOKE_ADMIN_AAL2_PASSWORD="..."
export SMOKE_ADMIN_AAL2_TOTP_SECRET="JBSWY3DPEHPK3PXP"   # base32
export SMOKE_ORG_EMAIL="..."             # org with a completed purchase, no pending refund
export SMOKE_ORG_PASSWORD="..."
export SMOKE_LEGAL_HOLD_SCOPE_ID="00000000-0000-0000-0000-000000000000"

npx playwright test
```

## Gate

If any row fails — **do not send Daniel**. Fix and re-run. Only when all four
rows are green is the status `DANIEL_RETEST_PACK_READY_TO_SEND`.
