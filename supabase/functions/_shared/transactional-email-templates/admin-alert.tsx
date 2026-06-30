/**
 * admin-alert — platform admin operational alert template (C7.2).
 *
 * Purpose
 * -------
 * The single React Email template used by `notification-dispatch` when
 * routing admin alerts through the platform email queue
 * (`send-transactional-email` → pgmq `transactional_emails`), in place
 * of the previous direct Resend POST that was failing with http_403.
 *
 * Scope
 * -----
 *   - Recipients: platform-admin recipients resolved by
 *     `resolveAdminRecipients` in notification-dispatch.
 *   - Content: the original alert subject / message / event_type /
 *     metadata are preserved verbatim. No new content, no upsell,
 *     no marketing language.
 *
 * SAFETY:
 *   - This template never renders end-user PII; it carries operational
 *     event metadata only.
 *   - The metadata blob is JSON-stringified server-side and rendered as
 *     escaped <pre> text. React props are escaped — no
 *     dangerouslySetInnerHTML.
 */

import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface AdminAlertProps {
  /** Free-form alert subject already clamped by the caller. */
  subject?: string
  /** Operational message body — preserved verbatim from the caller. */
  message?: string
  /** Catalogue event type, e.g. `breach.detected`. */
  eventType?: string
  /** ISO timestamp the alert was raised. */
  occurredAt?: string
  /** Optional JSON-stringified metadata blob; rendered as preformatted text. */
  metadataJson?: string
}

const AdminAlertEmail = ({
  subject,
  message,
  eventType,
  occurredAt,
  metadataJson,
}: AdminAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{subject || `Platform alert: ${eventType || 'event'}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{subject || `Platform alert: ${eventType || 'event'}`}</Heading>
        <Section style={card}>
          <Text style={text}>{message || 'A platform alert was raised.'}</Text>
        </Section>
        <Section style={metaBlock}>
          {eventType && <Text style={metaLine}>Event: {eventType}</Text>}
          {occurredAt && <Text style={metaLine}>Time: {occurredAt}</Text>}
        </Section>
        {metadataJson && (
          <Section style={card}>
            <Text style={preText}>{metadataJson}</Text>
          </Section>
        )}
        <Text style={footer}>
          This is an operational platform alert from {SITE_NAME}. It is
          routed through the platform email queue.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AdminAlertEmail,
  subject: (data: Record<string, any>) =>
    typeof data?.subject === 'string' && data.subject.length > 0
      ? data.subject
      : `Platform alert: ${typeof data?.eventType === 'string' ? data.eventType : 'event'}`,
  displayName: 'Platform admin operational alert',
  previewData: {
    subject: '[Alert] breach.detected',
    message: 'A new breach was detected for org Acme Co.',
    eventType: 'breach.detected',
    occurredAt: '2026-06-30T09:15:00.000Z',
    metadataJson: '{\n  "breach_id": "00000000-0000-0000-0000-0000000000aa"\n}',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '640px' }
const h1 = { fontSize: '20px', fontWeight: 'bold', color: '#0F172A', margin: '0 0 16px' }
const card = { padding: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', margin: '0 0 12px' }
const text = { fontSize: '14px', color: '#0F172A', lineHeight: '1.55', margin: '0', whiteSpace: 'pre-wrap' as const }
const metaBlock = { margin: '4px 0 12px' }
const metaLine = { fontSize: '12px', color: '#475569', margin: '2px 0' }
const preText = { fontSize: '12px', color: '#0F172A', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap' as const, margin: '0' }
const footer = { fontSize: '12px', color: '#64748B', margin: '24px 0 0' }
