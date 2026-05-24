import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2.39.3'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import {
  getCategoryForTemplate,
  getPreferenceKeyForTemplate,
  isBlockedByUnsubscribe,
  getSignedCategoryForTemplate,
  evaluateUnsubscribedDisposition,
  UNSUBSCRIBED_ESSENTIAL_FOOTER,
  UNSUBSCRIBED_ESSENTIAL_FOOTER_HTML,
  AUDIT_SEND_EVALUATED_UNSUBSCRIBED,
} from '../_shared/email-categories.ts'
import { checkAndAuditPreference } from '../_shared/notification-preferences.ts'
import { recordNotificationSkipped } from '../_shared/notification-skip-audit.ts'

// Configuration baked in at scaffold time - do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "compliance-matching"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers - never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.izenzo.co.za"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// When display_from_root is enabled, this can be the root domain for cleaner branding,
// even though actual sending uses the subdomain above.
const FROM_DOMAIN = "izenzo.co.za"

import { handleCorsPreflight, withCors } from '../_shared/cors.ts'

const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth note: this function uses verify_jwt = true in config.toml, so Supabase's
// gateway validates the caller's JWT (anon or service_role) before the request
// reaches this code. No in-function auth check is needed.

Deno.serve(async (req) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;
  const wrap = (r: Response) => withCors(req, r);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return wrap(new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string
  let templateData: Record<string, any> = {}
  try {
    const body = await req.json()
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = crypto.randomUUID()
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } catch {
    return wrap(new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  if (!templateName) {
    return wrap(new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  // 1. Look up template from registry (early - needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return wrap(new Response(
      JSON.stringify({
        error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`,
      }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the caller-provided recipientEmail. This allows notification templates
  // to always send to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return wrap(new Response(
      JSON.stringify({
        error: 'recipientEmail is required (unless the template defines a fixed recipient)',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // POI-004 stage-2: idempotency short-circuit. If a caller supplied an
  // explicit `idempotencyKey` and we have a prior email_send_log row with
  // that key, return the prior messageId/status instead of enqueuing a
  // second send. Callers that omit `idempotencyKey` opt out of dedupe
  // (the field defaults to messageId, which is unique-per-call).
  const callerSuppliedKey =
    idempotencyKey && idempotencyKey !== messageId ? idempotencyKey : null
  if (callerSuppliedKey) {
    const { data: prior, error: priorErr } = await supabase
      .from('email_send_log')
      .select('message_id, status, recipient_email, template_name')
      .eq('idempotency_key', callerSuppliedKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (priorErr) {
      console.error('Idempotency lookup failed', { error: priorErr, callerSuppliedKey })
    } else if (prior) {
      console.log('Idempotent replay — returning prior send', {
        idempotencyKey: callerSuppliedKey,
        priorMessageId: prior.message_id,
        priorStatus: prior.status,
      })
      return wrap(new Response(
        JSON.stringify({
          success: true,
          queued: false,
          idempotent: true,
          messageId: prior.message_id,
          status: prior.status,
          idempotencyKey: callerSuppliedKey,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      ))
    }
  }

  // ── Batch M Fix 1+3: resolve template category for suppression/preference ──
  const category = getCategoryForTemplate(templateName)
  const prefKey = getPreferenceKeyForTemplate(templateName)

  // 2. Check suppression list, honouring category. Security/compliance bypass.
  if (isBlockedByUnsubscribe(category)) {
    const { data: suppressed, error: suppressionError } = await supabase
      .from('suppressed_emails')
      .select('id')
      .eq('email', effectiveRecipient.toLowerCase())
      .maybeSingle()

    if (suppressionError) {
      console.error('Suppression check failed - refusing to send', {
        error: suppressionError,
        effectiveRecipient,
      })
      return wrap(new Response(
        JSON.stringify({ error: 'Failed to verify suppression status' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      ))
    }

    if (suppressed) {
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        idempotency_key: callerSuppliedKey,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'suppressed',
      })
      await recordNotificationSkipped(supabase, {
        reason: 'category_unsubscribed',
        sourceFunction: 'send-transactional-email',
        sourceEventType: templateName,
        channel: 'email',
        recipientEmail: effectiveRecipient,
        extra: { category, pref_key: prefKey },
      })
      console.log('Email suppressed', { effectiveRecipient, templateName, category })
      return wrap(new Response(
        JSON.stringify({ success: false, reason: 'email_suppressed', category }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      ))
    }
  } else {
    console.log('Suppression bypassed for safety-critical category', { templateName, category })
  }

  // 2b. Per-user notification preference enforcement (Batch M Fix 2).
  // Best-effort recipient → user lookup via profiles.email; failure to find
  // a user is not an error (e.g. external counterparty addresses).
  if (prefKey) {
    const { data: recipientProfile } = await supabase
      .from('profiles')
      .select('id, org_id')
      .eq('email', effectiveRecipient.toLowerCase())
      .maybeSingle()
    if (recipientProfile?.id) {
      const decision = await checkAndAuditPreference(supabase, {
        userId: recipientProfile.id as string,
        prefKey,
        category,
        sourceFunction: 'send-transactional-email',
        sourceEventType: templateName,
        channel: 'email',
        orgId: (recipientProfile.org_id as string) ?? null,
      })
      if (!decision.allowed) {
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          idempotency_key: callerSuppliedKey,
          template_name: templateName,
          recipient_email: effectiveRecipient,
          status: 'suppressed',
        })
        return wrap(new Response(
          JSON.stringify({
            success: false,
            reason: 'preference_disabled',
            pref_key: prefKey,
            category,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        ))
      }
    }
  }


  // 3. Get or create unsubscribe token (one token per email address)
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string

  // Check for existing token for this email
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', {
      error: tokenLookupError,
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      idempotency_key: callerSuppliedKey,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return wrap(new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  if (existingToken && !existingToken.used_at) {
    // Reuse existing unused token
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    // Create new token - upsert handles concurrent inserts gracefully
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', {
        error: tokenError,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        idempotency_key: callerSuppliedKey,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return wrap(new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      ))
    }

    // If another request raced us, our upsert was silently ignored.
    // Re-read to get the actual stored token.
    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', {
        error: reReadError,
        email: normalizedEmail,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        idempotency_key: callerSuppliedKey,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return wrap(new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      ))
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token exists but is already used - email should have been caught by suppression check above.
    // This is a safety fallback; log and skip sending.
    console.warn('Unsubscribe token already used but email not suppressed', {
      email: normalizedEmail,
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      idempotency_key: callerSuppliedKey,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    return wrap(new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    ))
  }

  // 4. Render React Email template to HTML and plain text
  const html = await renderAsync(
    React.createElement(template.component, templateData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )

  // Resolve subject - supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Enqueue the pre-rendered email for async processing by the dispatcher.
  // The dispatcher (process-email-queue) handles sending, retries, and rate-limit backoff.

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes.
  // `subject_length` is persisted in metadata so the 200-char contract is
  // forensically auditable from email_send_log alone (no need to replay
  // template rendering).
  const { error: pendingInsertError } = await supabase
    .from('email_send_log')
    .insert({
      message_id: messageId,
      idempotency_key: callerSuppliedKey,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'pending',
      metadata: {
        subject_length: typeof resolvedSubject === 'string' ? resolvedSubject.length : null,
        subject_over_limit: typeof resolvedSubject === 'string' && resolvedSubject.length > 200,
      },
    })

  // POI-004 stage-2 race: a concurrent caller with the same idempotencyKey
  // may have written the pending row first. Re-fetch and short-circuit
  // (do NOT enqueue a second message). Postgres unique-violation = 23505.
  if (pendingInsertError && callerSuppliedKey && (pendingInsertError as any).code === '23505') {
    const { data: prior } = await supabase
      .from('email_send_log')
      .select('message_id, status')
      .eq('idempotency_key', callerSuppliedKey)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    console.log('Idempotent replay (race) — returning prior pending send', {
      idempotencyKey: callerSuppliedKey,
      priorMessageId: prior?.message_id,
    })
    return wrap(new Response(
      JSON.stringify({
        success: true,
        queued: false,
        idempotent: true,
        messageId: prior?.message_id ?? messageId,
        status: prior?.status ?? 'pending',
        idempotencyKey: callerSuppliedKey,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    ))
  }


  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue email', {
      error: enqueueError,
      templateName,
      effectiveRecipient,
    })

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      idempotency_key: callerSuppliedKey,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })

    return wrap(new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }))
  }

  console.log('Transactional email enqueued', { templateName, effectiveRecipient })

  // Return the messageId so callers (e.g. dispatch-acceptance-receipts) can
  // perform a parity check against email_send_log without guessing.
  return wrap(new Response(
    JSON.stringify({ success: true, queued: true, messageId, idempotencyKey }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  ))
})
