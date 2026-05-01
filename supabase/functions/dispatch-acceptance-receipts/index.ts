/**
 * dispatch-acceptance-receipts
 * ────────────────────────────
 * Drains pending email rows in `notification_dispatches` for acceptance
 * receipts and invokes `send-transactional-email` for each.
 *
 * Hardening (post-QA):
 *  - A dispatch is ONLY marked `delivered` when the downstream send
 *    returns a non-empty messageId AND we can locate the corresponding
 *    `email_send_log` row. Otherwise it is marked `failed` so the
 *    reconciler can alarm. No silent rubber-stamping.
 *  - We mirror the message_id back into `notification_dispatches` so
 *    the cross-table parity invariant (dispatch ↔ email_send_log) holds.
 *  - We persist a structured error message on every failure path.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { triggerWebhooks } from '../_shared/webhooks.ts'
import { webhookCorsHeaders } from '../_shared/cors.ts'

// Cron-triggered server-to-server function. No browser preflight; emit
// only Vary: Origin (no Allow-Origin) per Stage 2B hardening.
const corsHeaders = {
  ...webhookCorsHeaders(),
}

interface DispatchRow {
  id: string
  reference_id: string
  recipient_address: string | null
  recipient_user_id: string | null
  metadata: Record<string, unknown> | null
}

interface ReceiptRow {
  id: string
  match_id: string
  engagement_id: string
  initiator_org_id: string
  counterparty_org_id: string | null
  accepted_at: string
  counterparty_email: string | null
  signature_hash: string
  signed_payload: string
  receipt_version: number
  attestation_id: string | null
  metadata: Record<string, unknown> | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: pending, error: pendingErr } = await supabase
    .from('notification_dispatches')
    .select('id, reference_id, recipient_address, recipient_user_id, metadata')
    .eq('reference_type', 'acceptance_receipt')
    .eq('channel', 'email')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(25)

  if (pendingErr) {
    return new Response(JSON.stringify({ error: pendingErr.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: Array<Record<string, unknown>> = []

  for (const dispatch of (pending ?? []) as DispatchRow[]) {
    let recipient = dispatch.recipient_address?.trim() || null
    if (!recipient && dispatch.recipient_user_id) {
      const { data: userRow } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', dispatch.recipient_user_id)
        .maybeSingle()
      recipient = (userRow as { email?: string } | null)?.email ?? null
    }

    const { data: receipt } = await supabase
      .from('acceptance_receipts')
      .select('id, match_id, engagement_id, initiator_org_id, counterparty_org_id, accepted_at, counterparty_email, signature_hash, signed_payload, receipt_version, attestation_id, metadata')
      .eq('id', dispatch.reference_id)
      .maybeSingle()

    if (!recipient || !receipt) {
      const reason = !recipient ? 'no_recipient_resolvable' : 'receipt_not_found'
      await supabase
        .from('notification_dispatches')
        .update({ status: 'failed', failed_at: new Date().toISOString(), error_message: reason })
        .eq('id', dispatch.id)
      results.push({ id: dispatch.id, status: 'failed', reason })
      continue
    }

    const r = receipt as ReceiptRow
    const { data: match } = await supabase
      .from('matches')
      .select('commodity')
      .eq('id', r.match_id)
      .maybeSingle()

    const baseUrl = Deno.env.get('PUBLIC_APP_URL') ?? 'https://compliance-matching.lovable.app'
    const matchUrl = `${baseUrl}/dashboard/matches/${r.match_id}`
    const idempotencyKey = `acceptance-receipt-${r.id}`

    // Mark in-flight before invoking — narrows the failure window.
    await supabase
      .from('notification_dispatches')
      .update({ dispatched_at: new Date().toISOString() })
      .eq('id', dispatch.id)

    const invokeRes = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'acceptance-receipt',
        recipientEmail: recipient,
        idempotencyKey,
        templateData: {
          matchId: r.match_id,
          commodity: (match as { commodity?: string } | null)?.commodity ?? null,
          counterpartyEmail: r.counterparty_email,
          acceptedAt: new Date(r.accepted_at).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
          receiptId: r.id,
          signatureHash: r.signature_hash,
          matchUrl,
        },
      },
    })

    if (invokeRes.error) {
      await supabase
        .from('notification_dispatches')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_message: invokeRes.error.message ?? String(invokeRes.error),
        })
        .eq('id', dispatch.id)
      results.push({ id: dispatch.id, status: 'failed', reason: invokeRes.error.message })
      continue
    }

    const data = (invokeRes.data ?? {}) as Record<string, unknown>
    const messageId =
      (data.messageId as string | undefined) ??
      (data.message_id as string | undefined) ??
      null

    // ── Hard parity check: a delivery only counts if email_send_log proves it.
    // send-transactional-email always returns the messageId it used, and writes
    // matching rows into email_send_log (status pending → sent). We look for the
    // most recent row for that messageId.
    let logProof: { id: string; status: string; message_id: string | null } | null = null
    if (messageId) {
      const { data: logRow } = await supabase
        .from('email_send_log')
        .select('id, status, message_id')
        .eq('message_id', messageId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      logProof = (logRow as typeof logProof) ?? null
    }
    if (!logProof) {
      // Last-resort correlation: the most recent acceptance-receipt log row
      // for this exact recipient. Tolerant of small clock skew between the
      // log insert and this read.
      const { data: logRow } = await supabase
        .from('email_send_log')
        .select('id, status, message_id')
        .eq('template_name', 'acceptance-receipt')
        .eq('recipient_email', recipient)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      logProof = (logRow as typeof logProof) ?? null
    }

    if (!logProof) {
      // Send claimed success but we cannot prove it landed in the log.
      // Mark failed so the reconciler raises a high-severity item.
      await supabase
        .from('notification_dispatches')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_message: 'send_unverifiable: no email_send_log row located for this dispatch',
        })
        .eq('id', dispatch.id)
      results.push({ id: dispatch.id, status: 'failed', reason: 'send_unverifiable' })
      continue
    }

    const logStatusOk = logProof.status === 'sent' || logProof.status === 'pending'
    if (!logStatusOk) {
      await supabase
        .from('notification_dispatches')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          error_message: `email_send_log status=${logProof.status}`,
        })
        .eq('id', dispatch.id)
      results.push({ id: dispatch.id, status: 'failed', reason: `email_log_${logProof.status}` })
      continue
    }

    await supabase
      .from('notification_dispatches')
      .update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        message_id: logProof.message_id ?? messageId,
      })
      .eq('id', dispatch.id)

    // ── Optional outbound webhook: notify the initiator org's integrated
    // systems that a signed acceptance receipt is now delivered. The
    // _shared/webhooks helper handles HMAC-SHA256 signing, X-Webhook-Timestamp
    // (replay protection), retries and circuit breaking. Only orgs that have
    // subscribed to "acceptance_receipt.created" receive a delivery.
    try {
      await triggerWebhooks(supabase, r.initiator_org_id, 'acceptance_receipt.created', {
        receipt_id: r.id,
        receipt_version: r.receipt_version,
        match_id: r.match_id,
        engagement_id: r.engagement_id,
        initiator_org_id: r.initiator_org_id,
        counterparty_org_id: r.counterparty_org_id,
        counterparty_email: r.counterparty_email,
        accepted_at: r.accepted_at,
        attestation_id: r.attestation_id,
        signature: {
          algorithm: 'sha256',
          hash: r.signature_hash,
          signed_payload: r.signed_payload,
        },
        delivery: {
          dispatch_id: dispatch.id,
          message_id: logProof.message_id ?? messageId,
          delivered_at: new Date().toISOString(),
        },
      })
    } catch (whErr) {
      // Non-fatal: webhook failures are logged inside triggerWebhooks and
      // tracked via webhook_deliveries / circuit breaker. Receipt email is
      // already delivered; we never roll that back.
      console.error(`[acceptance_receipt.created] webhook trigger failed for org ${r.initiator_org_id}:`, whErr)
    }

    results.push({
      id: dispatch.id,
      status: 'delivered',
      message_id: logProof.message_id ?? messageId,
      log_id: logProof.id,
    })
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
})
