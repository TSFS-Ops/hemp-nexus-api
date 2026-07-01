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

// -------------------------------------------------------------------
// Batch I2 — verify-path post-credit audit/event/notification parity.
//
// These helpers are called ONLY after `atomic_paid_credit_purchase`
// has already succeeded in the verify/return branch of `token-purchase`.
// Credit is real; these calls exist so admins are not blind if the
// post-credit audit/event/notification writes fail. They never mutate
// balances, ledger, or provider state.
// -------------------------------------------------------------------

interface VerifyPostCreditArgs {
  provider: 'paystack'
  reference: string
  orgId: string
  packageId?: string | null
  credits?: number | null
  errorMessage: string
}

export async function recordVerifyPostCreditAuditFailed(
  admin: Admin,
  args: VerifyPostCreditArgs,
): Promise<void> {
  const metadata = {
    provider: args.provider,
    source_function: 'token-purchase/verify',
    payment_reference: args.reference,
    org_id: args.orgId,
    package_id: args.packageId ?? null,
    credits: args.credits ?? null,
    error_message: args.errorMessage,
    at: new Date().toISOString(),
    note: 'credit already succeeded; audit row insert failed after credit',
  }
  await safeAudit(admin, 'payment.verify_post_credit_audit_failed', metadata)
  await safeUpsertRisk(
    admin,
    'payment_verify_post_credit_audit_failed',
    `payment_verify_post_credit_audit_failed:${args.reference}`,
    'high',
    `Verify path: credits.purchased audit failed after credit (${args.reference})`,
    `atomic_paid_credit_purchase succeeded but the credits.purchased audit insert failed in token-purchase/verify. Credit is real; the audit trail is incomplete. Error: ${args.errorMessage}`,
    metadata,
  )
}

export async function recordVerifyPostCreditEventFailed(
  admin: Admin,
  args: VerifyPostCreditArgs,
): Promise<void> {
  const metadata = {
    provider: args.provider,
    source_function: 'token-purchase/verify',
    payment_reference: args.reference,
    org_id: args.orgId,
    package_id: args.packageId ?? null,
    credits: args.credits ?? null,
    error_message: args.errorMessage,
    at: new Date().toISOString(),
    note: 'credit already succeeded; payment.event_created write failed after credit',
  }
  await safeAudit(admin, 'payment.verify_post_credit_event_failed', metadata)
  await safeUpsertRisk(
    admin,
    'payment_verify_post_credit_event_failed',
    `payment_verify_post_credit_event_failed:${args.reference}`,
    'high',
    `Verify path: payment.event_created failed after credit (${args.reference})`,
    `atomic_paid_credit_purchase succeeded but the canonical payment.event_created write failed in token-purchase/verify. Credit is real; the governance event row is missing. Error: ${args.errorMessage}`,
    metadata,
  )
}

export async function recordVerifyRevenueNotificationFailed(
  admin: Admin,
  args: VerifyPostCreditArgs,
): Promise<void> {
  const metadata = {
    provider: args.provider,
    source_function: 'token-purchase/verify',
    payment_reference: args.reference,
    org_id: args.orgId,
    package_id: args.packageId ?? null,
    credits: args.credits ?? null,
    error_message: args.errorMessage,
    at: new Date().toISOString(),
    note: 'credit already succeeded; revenue notification emit failed',
  }
  await safeAudit(admin, 'payment.verify_revenue_notification_failed', metadata)
  await safeUpsertRisk(
    admin,
    'payment_verify_revenue_notification_failed',
    `payment_verify_revenue_notification_failed:${args.reference}`,
    'medium',
    `Verify path: revenue notification failed after credit (${args.reference})`,
    `emitRevenueNotification threw in token-purchase/verify after credit succeeded. Credit is real; support may not have been notified. Error: ${args.errorMessage}`,
    metadata,
  )
}

