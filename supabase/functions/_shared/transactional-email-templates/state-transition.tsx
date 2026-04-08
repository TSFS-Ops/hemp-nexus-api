import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

const STATE_LABELS: Record<string, string> = {
  matched: 'Matched',
  intent_declared: 'Intent Declared',
  counterparty_revealed: 'Counterparty Revealed',
  committed: 'Committed',
  completed: 'Completed',
  disputed: 'Disputed',
}

interface StateTransitionProps {
  matchId?: string
  commodity?: string
  fromState?: string
  toState?: string
}

const StateTransitionEmail = ({ matchId, commodity, fromState, toState }: StateTransitionProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Match status update: {STATE_LABELS[toState || ''] || toState || 'updated'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Match Status Update</Heading>
        {commodity && (
          <Text style={text}>
            Commodity: <strong>{commodity}</strong>
          </Text>
        )}
        <Section style={statusBox}>
          <Text style={statusText}>
            {STATE_LABELS[fromState || ''] || fromState || '...'} → <strong>{STATE_LABELS[toState || ''] || toState || '...'}</strong>
          </Text>
        </Section>
        <Text style={text}>
          Your match has progressed to the next stage. Log in to {SITE_NAME} to review and take action.
        </Text>
        {matchId && (
          <Text style={textSmall}>
            Reference: {matchId.slice(0, 8)}
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          This is an automated notification from {SITE_NAME}. Do not reply to this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: StateTransitionEmail,
  subject: (data: Record<string, any>) =>
    `Match update: ${STATE_LABELS[data.toState] || data.toState || 'Status changed'} - ${SITE_NAME}`,
  displayName: 'State transition',
  previewData: { matchId: 'a1b2c3d4-e5f6', commodity: 'Crude Soybean Oil', fromState: 'matched', toState: 'intent_declared' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '12px', color: '#9CA3AF', lineHeight: '1.5', margin: '0 0 16px', fontFamily: "'JetBrains Mono', monospace" }
const statusBox = { backgroundColor: '#F3F4F6', borderRadius: '2px', padding: '12px 16px', margin: '0 0 20px' }
const statusText = { fontSize: '14px', color: '#111827', margin: '0', textAlign: 'center' as const }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
