/**
 * Batch I1 — payment provider observability helpers.
 *
 * Observability only. Never touches money, credits, providers, refunds,
 * or settlement. Every write is best-effort and swallows its own errors
 * so callers preserve their original failure behaviour.
 */
// deno-lint-ignore no-explicit-any
type Admin = any

const DEDUP_LOOKBACK_MS = 60 * 60 * 1000 // 1 hour dedup window for open risk items

async function safeAudit(
  admin: Admin,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from('audit_logs').insert({
      action,
      entity_type: 'payment_provider',
      entity_id: null,
      metadata,
    })
  } catch (err) {
    console.warn(`[payment-observability] audit ${action} failed`, err)
  }
}

async function safeUpsertRisk(
  admin: Admin,
  kind: string,
  dedupKey: string,
  severity: 'medium' | 'high' | 'critical',
  title: string,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DEDUP_LOOKBACK_MS).toISOString()
    const { data: existing } = await admin
      .from('admin_risk_items')
      .select('id')
      .eq('kind', kind)
      .eq('dedup_key', dedupKey)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle()
    if (existing?.id) return
    await admin.from('admin_risk_items').insert({
      kind,
      severity,
      title,
      description,
      dedup_key: dedupKey,
      metadata,
    })
  } catch (err) {
    console.warn(`[payment-observability] risk ${kind} upsert failed`, err)
  }
}

export async function recordProviderSecretMissing(
  admin: Admin,
  args: {
    provider: 'paystack'
    source: string // e.g. 'paystack-webhook', 'token-purchase', 'token-purchase/webhook', 'transaction-reconciliation'
    requestId?: string | null
  },
): Promise<void> {
  const metadata = {
    provider: args.provider,
    source: args.source,
    request_id: args.requestId ?? null,
    at: new Date().toISOString(),
  }
  await safeAudit(admin, 'payment.provider_secret_missing', metadata)
  await safeUpsertRisk(
    admin,
    'paystack_secret_missing',
    `paystack_secret_missing:${args.source}`,
    'critical',
    `Paystack secret missing (${args.source})`,
    `PAYSTACK_SECRET_KEY is not configured; ${args.source} cannot complete provider verification. Balance/ledger untouched.`,
    metadata,
  )
}

export async function recordWebhookSignatureInvalid(
  admin: Admin,
  args: {
    provider: 'paystack'
    source: string
    requestId?: string | null
  },
): Promise<void> {
  const metadata = {
    provider: args.provider,
    source: args.source,
    request_id: args.requestId ?? null,
    at: new Date().toISOString(),
  }
  await safeAudit(admin, 'payment.webhook_signature_invalid', metadata)
}

export async function recordLedgerLabelRepairFailed(
  admin: Admin,
  args: {
    source: string
    errorMessage: string
    reconRunId?: string | null
  },
): Promise<void> {
  const metadata = {
    source: args.source,
    error_message: args.errorMessage,
    recon_run_id: args.reconRunId ?? null,
    at: new Date().toISOString(),
    note: 'balances are not changed by this repair path',
  }
  await safeAudit(admin, 'payment.ledger_label_repair_failed', metadata)
  await safeUpsertRisk(
    admin,
    'payment_ledger_label_repair_failed',
    `payment_ledger_label_repair_failed:${args.source}`,
    'high',
    `Skeletal paid-credit label repair failed (${args.source})`,
    `repair_skeletal_paid_credit RPC returned an error during reconciliation: ${args.errorMessage}. Balances are not changed by this repair path; a label/audit-honesty gap remains until resolved.`,
    metadata,
  )
}
