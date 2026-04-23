/**
 * dispatch-acceptance-receipts
 * ────────────────────────────
 * Drains pending email rows in `notification_dispatches` for acceptance
 * receipts and invokes `send-transactional-email` for each. On success the
 * dispatch row is marked `delivered` with the message_id. On failure it is
 * marked `failed` with the error. Backfilled receipts are processed too so
 * historical rows (e.g. Daniel/platinum) become observable.
 *
 * Triggered by pg_cron every 2 minutes. Safe to invoke manually for
 * targeted reprocessing.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  accepted_at: string
  counterparty_email: string | null
  signature_hash: string
  metadata: Record<string, unknown> | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  // Pull a small batch of pending email dispatches for acceptance receipts.
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
    // Resolve recipient address: column first, then auth lookup by user_id.
    let recipient = dispatch.recipient_address?.trim() || null
    if (!recipient && dispatch.recipient_user_id) {
      const { data: userRow } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', dispatch.recipient_user_id)
        .maybeSingle()
      recipient = (userRow as { email?: string } | null)?.email ?? null
    }

    // Pull the receipt + match info for templateData.
    const { data: receipt } = await supabase
      .from('acceptance_receipts')
      .select('id, match_id, accepted_at, counterparty_email, signature_hash, metadata')
      .eq('id', dispatch.reference_id)
      .maybeSingle()

    if (!recipient || !receipt) {
      const reason = !recipient ? 'no recipient address resolvable' : 'receipt not found'
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

    const invokeRes = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'acceptance-receipt',
        recipientEmail: recipient,
        idempotencyKey: `acceptance-receipt-${r.id}`,
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

    const messageId =
      ((invokeRes.data as Record<string, unknown> | null)?.messageId as string | undefined) ??
      ((invokeRes.data as Record<string, unknown> | null)?.message_id as string | undefined) ??
      null

    await supabase
      .from('notification_dispatches')
      .update({
        status: 'delivered',
        dispatched_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        message_id: messageId,
      })
      .eq('id', dispatch.id)

    results.push({ id: dispatch.id, status: 'delivered', message_id: messageId })
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
})
