// Batch J3 / tracker item #22 — Auth email suppression split disposition.
//
// Client/product decision:
//   • security-critical account emails (recovery/password reset, email
//     change, re-authentication) may still be sent to suppressed
//     recipients WITH a clear disclaimer;
//   • less critical auth emails (signup, invite, magic-link) MUST be
//     suppressed when the recipient is on suppressed_emails.
//
// This helper is the single source of truth for that decision. It is
// consumed by:
//   • supabase/functions/auth-email-hook  (pre-enqueue gate)
//   • supabase/functions/process-email-queue  (pre-provider-send gate,
//     defense-in-depth for direct queue producers)
//
// It intentionally does NOT touch suppressed_emails or unsubscribe
// records — read-only, no mutations.

export type AuthEmailTemplate =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'reauthentication'

export type AuthSuppressionDisposition =
  | 'send'
  | 'send_with_disclaimer'
  | 'suppress'

// Security-critical: MUST still be delivered with a disclaimer even if the
// recipient is suppressed/unsubscribed/bounced. These relate directly to
// account access or account security.
export const AUTH_SECURITY_CRITICAL_TEMPLATES = new Set<string>([
  'recovery',
  'email_change',
  'reauthentication',
])

// Non-critical: MUST be dropped when the recipient is suppressed.
export const AUTH_NON_CRITICAL_TEMPLATES = new Set<string>([
  'signup',
  'invite',
  'magiclink',
])

// Audit / risk marker constants — referenced by static tests so wording
// cannot drift silently.
export const AUDIT_ACTION_AUTH_SUPPRESSED = 'email.auth_suppressed'
export const AUDIT_ACTION_AUTH_SECURITY_SENT_WITH_DISCLAIMER =
  'email.auth_security_sent_with_disclaimer'
export const RISK_KIND_AUTH_EMAIL_TO_SUPPRESSED_RECIPIENT =
  'auth_email_to_suppressed_recipient'

// Disclaimer copy used ONLY on the security-critical suppressed path.
// Keep short and unambiguous — this is the entire justification the
// recipient will see for why an unsubscribed/suppressed address received
// mail.
export const AUTH_SECURITY_DISCLAIMER_TEXT =
  'This is an essential account-security email. You are receiving it even though this address is suppressed or unsubscribed because it relates to access or security for your Izenzo account.'

export const AUTH_SECURITY_DISCLAIMER_HTML =
  '<div style="margin:0 0 16px 0;padding:12px 16px;border:1px solid #f0d078;background:#fff8e1;color:#5a4a1a;font-size:13px;line-height:1.5;font-family:Arial,sans-serif;border-radius:6px;">' +
  AUTH_SECURITY_DISCLAIMER_TEXT +
  '</div>'

export function isSecurityCriticalAuthTemplate(name: string): boolean {
  return AUTH_SECURITY_CRITICAL_TEMPLATES.has(name)
}

export function isNonCriticalAuthTemplate(name: string): boolean {
  return AUTH_NON_CRITICAL_TEMPLATES.has(name)
}

export interface AuthSuppressionEvaluation {
  disposition: AuthSuppressionDisposition
  recipientSuppressed: boolean
  templateName: string
  isSecurityCritical: boolean
  suppressionReason?: string | null
}

// Query suppressed_emails for the recipient and return the split-approach
// disposition. Any lookup error is treated fail-open for security-critical
// templates (send) and fail-closed for non-critical templates (suppress)
// — callers should log the underlying error.
export async function evaluateAuthEmailSuppression(
  supabase: any,
  templateName: string,
  recipientEmail: string,
): Promise<AuthSuppressionEvaluation> {
  const isSecurityCritical = isSecurityCriticalAuthTemplate(templateName)

  const { data: row, error } = await supabase
    .from('suppressed_emails')
    .select('email, reason')
    .eq('email', recipientEmail)
    .maybeSingle()

  if (error) {
    // Fail-open only for security-critical (they must reach the user);
    // fail-closed for non-critical (we would rather drop than mis-send).
    return {
      disposition: isSecurityCritical ? 'send' : 'suppress',
      recipientSuppressed: false,
      templateName,
      isSecurityCritical,
      suppressionReason: null,
    }
  }

  const recipientSuppressed = !!row

  if (!recipientSuppressed) {
    return {
      disposition: 'send',
      recipientSuppressed: false,
      templateName,
      isSecurityCritical,
      suppressionReason: null,
    }
  }

  if (isSecurityCritical) {
    return {
      disposition: 'send_with_disclaimer',
      recipientSuppressed: true,
      templateName,
      isSecurityCritical: true,
      suppressionReason: row?.reason ?? null,
    }
  }

  // Non-critical + suppressed → drop
  return {
    disposition: 'suppress',
    recipientSuppressed: true,
    templateName,
    isSecurityCritical: false,
    suppressionReason: row?.reason ?? null,
  }
}

// Inject the disclaimer into an existing rendered HTML body. Idempotent:
// if the disclaimer is already present, the input is returned unchanged.
export function injectSecurityDisclaimerHtml(html: string): string {
  if (typeof html !== 'string' || !html) return html
  if (html.includes(AUTH_SECURITY_DISCLAIMER_TEXT)) return html
  const bodyOpen = html.match(/<body[^>]*>/i)
  if (bodyOpen && bodyOpen.index !== undefined) {
    const idx = bodyOpen.index + bodyOpen[0].length
    return html.slice(0, idx) + AUTH_SECURITY_DISCLAIMER_HTML + html.slice(idx)
  }
  return AUTH_SECURITY_DISCLAIMER_HTML + html
}

export function injectSecurityDisclaimerText(text: string): string {
  if (typeof text !== 'string') return text
  if (text.includes(AUTH_SECURITY_DISCLAIMER_TEXT)) return text
  return `${AUTH_SECURITY_DISCLAIMER_TEXT}\n\n${text}`
}
