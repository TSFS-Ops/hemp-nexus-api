/**
 * Batch D — initiator-side operational alert template (D4c-2).
 *
 * Minimal, neutral, operational notice rendered for INITIATING-org
 * admins only. Subject and body come from the canonical Batch D
 * event catalogue (`safeWording`) — never from free-text fields and
 * never from counterparty / candidate / disputed identity.
 *
 * SAFETY:
 *   - No counterparty name, email, or org name is ever rendered.
 *   - No candidate-org or binding-candidate data is ever rendered.
 *   - No disputed-counterparty identity is ever rendered.
 *   - No commodity, deal value, or PII is ever rendered.
 *
 * This template is registered for use ONLY by
 * `dispatchD4cInitiatorAlert` (see `_shared/batch-d-initiator-notify.ts`).
 * It is NOT wired into any production trigger site in D4c-2.
 */

import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface InitiatorAlertProps {
  /** Catalogue safeWording. Required at runtime by the helper. */
  safeWording?: string
  /** Catalogue label. Used as a short heading. */
  label?: string
  /** Engagement id — admin trace tail only. */
  engagementId?: string
  /** Catalogue subject line (fully clamped by the helper). */
  subject?: string
}

const BatchDInitiatorAlertEmail = ({
  safeWording,
  label,
  engagementId,
}: InitiatorAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{label || 'Pending Engagement update'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{label || 'Pending Engagement update'}</Heading>
        <Section style={card}>
          <Text style={text}>
            {safeWording ||
              'A Pending Engagement on your account requires your attention. Sign in to review.'}
          </Text>
        </Section>
        {engagementId && (
          <Text style={traceText}>Reference: {engagementId.slice(0, 8)}</Text>
        )}
        <Text style={footer}>
          This is an operational notice from {SITE_NAME} relating to a Pending
          Engagement on your account.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BatchDInitiatorAlertEmail,
  // Subject is dynamic — the helper passes the clamped catalogue subject.
  subject: (data: Record<string, any>) =>
    typeof data?.subject === 'string' && data.subject.length > 0
      ? data.subject
      : 'Pending Engagement update',
  displayName: 'Batch D initiator operational alert',
  previewData: {
    label: 'Binding review resolved',
    safeWording:
      'Binding review resolved. The engagement state has been updated by the platform.',
    subject: 'Pending Engagement update',
    engagementId: '00000000-0000-0000-0000-0000000000aa',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', fontWeight: 'bold', color: '#0F172A', margin: '0 0 16px' }
const card = { padding: '16px', backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px' }
const text = { fontSize: '14px', color: '#0F172A', lineHeight: '1.55', margin: '0' }
const traceText = { fontSize: '12px', color: '#475569', margin: '20px 0 0' }
const footer = { fontSize: '12px', color: '#64748B', margin: '24px 0 0' }
