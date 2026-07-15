import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface Props {
  ticketNumber?: string
  subject?: string
  alertKind?: string
  detail?: string
  status?: string
  priority?: string
  team?: string
  slaGate?: string
  ctaUrl?: string
}

const Email = ({ ticketNumber, subject, alertKind, detail, status, priority, team, slaGate, ctaUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>[{alertKind || 'support'}] {ticketNumber || ''} {subject || ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Support queue: {alertKind || 'update'}</Heading>
        {subject && <Text style={text}><strong>{subject}</strong></Text>}
        {ticketNumber && <Text style={textSmall}>{ticketNumber}</Text>}
        <Section style={statusBox}>
          {status && <Text style={statusText}>Status: <strong>{status.replace(/_/g, ' ')}</strong></Text>}
          {priority && <Text style={statusText}>Priority: <strong>{priority}</strong></Text>}
          {team && <Text style={statusText}>Team: <strong>{team}</strong></Text>}
          {slaGate && <Text style={statusText}>SLA gate: <strong>{slaGate.replace(/_/g, ' ')}</strong></Text>}
        </Section>
        {detail && <Text style={text}>{detail}</Text>}
        {ctaUrl && (
          <Text style={text}>
            Open in triage: <a href={ctaUrl}>{ctaUrl}</a>
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          Internal alert from {SITE_NAME} Support Ops. Sent to staff on record for this queue.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `[Support ${data.alertKind || 'alert'}] ${data.ticketNumber || ''} ${data.subject || ''}`.trim(),
  displayName: 'Support staff alert',
  previewData: {
    ticketNumber: 'ST-2026-0001',
    subject: 'Cannot upload evidence',
    alertKind: 'auto-escalated',
    detail: 'First-response SLA breached; priority raised from medium to high.',
    status: 'new',
    priority: 'high',
    team: 'tier1',
    slaGate: 'first_response',
    ctaUrl: 'https://izenzo.co.za/admin/support/tickets/abc',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#0F172A', margin: '0 0 12px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '12px', color: '#94A3B8', lineHeight: '1.5', margin: '0 0 16px', fontFamily: "'JetBrains Mono', monospace" }
const statusBox = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '12px 16px', margin: '0 0 20px' }
const statusText = { fontSize: '13px', color: '#0F172A', margin: '0 0 4px' }
const hr = { borderColor: '#E2E8F0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '24px 0 0' }
