import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface Props {
  ticketNumber?: string
  subject?: string
  headline?: string
  bodyText?: string
  status?: string
  priority?: string
  ctaUrl?: string
}

const Email = ({ ticketNumber, subject, headline, bodyText, status, priority, ctaUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{headline || 'Support ticket update'} — {ticketNumber || ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{headline || 'Support ticket update'}</Heading>
        {subject && (
          <Text style={text}>
            <strong>Subject:</strong> {subject}
          </Text>
        )}
        {ticketNumber && (
          <Text style={textSmall}>Reference: {ticketNumber}</Text>
        )}
        <Section style={statusBox}>
          {status && (
            <Text style={statusText}>Status: <strong>{status.replace(/_/g, ' ')}</strong></Text>
          )}
          {priority && (
            <Text style={statusText}>Priority: <strong>{priority}</strong></Text>
          )}
        </Section>
        {bodyText && <Text style={text}>{bodyText}</Text>}
        {ctaUrl && (
          <Text style={text}>
            View this ticket in {SITE_NAME}: <a href={ctaUrl}>{ctaUrl}</a>
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          Automated notification from {SITE_NAME} Support. Do not reply to this email —
          reply from the ticket in-app so your message is recorded on the case.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `[${data.ticketNumber || 'Support'}] ${data.headline || 'Update'} — ${SITE_NAME}`,
  displayName: 'Support ticket customer update',
  previewData: {
    ticketNumber: 'ST-2026-0001',
    subject: 'Cannot upload evidence',
    headline: 'We have received your ticket',
    bodyText: 'Our team will review shortly.',
    status: 'new',
    priority: 'medium',
    ctaUrl: 'https://izenzo.co.za/support/tickets/abc',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#0F172A', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '12px', color: '#94A3B8', lineHeight: '1.5', margin: '0 0 16px', fontFamily: "'JetBrains Mono', monospace" }
const statusBox = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '12px 16px', margin: '0 0 20px' }
const statusText = { fontSize: '13px', color: '#0F172A', margin: '0 0 4px' }
const hr = { borderColor: '#E2E8F0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '24px 0 0' }
