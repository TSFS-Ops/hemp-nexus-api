import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface MatchNotificationProps {
  commodity?: string
  matchId?: string
  counterpartyHint?: string
}

const MatchNotificationEmail = ({ commodity, matchId, counterpartyHint }: MatchNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New match found for {commodity || 'your interest'} on {SITE_NAME}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New Match Found</Heading>
        <Text style={text}>
          A potential counterparty has been identified for your {commodity ? <strong>{commodity}</strong> : 'interest'} on the {SITE_NAME} platform.
        </Text>
        {counterpartyHint && (
          <Text style={text}>
            Counterparty: <strong>{counterpartyHint}</strong>
          </Text>
        )}
        {matchId && (
          <Text style={textSmall}>
            Match reference: {matchId.slice(0, 8)}
          </Text>
        )}
        <Hr style={hr} />
        <Text style={text}>
          Log in to your console to review the match details and take the next step.
        </Text>
        <Text style={footer}>
          This is an automated notification from {SITE_NAME}. Do not reply to this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: MatchNotificationEmail,
  subject: (data: Record<string, any>) =>
    `New match: ${data.commodity || 'Interest'} - ${SITE_NAME}`,
  displayName: 'Match notification',
  previewData: { commodity: 'Refined Sunflower Oil', matchId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', counterpartyHint: 'Acme Trading Ltd' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '12px', color: '#9CA3AF', lineHeight: '1.5', margin: '0 0 16px', fontFamily: "'JetBrains Mono', monospace" }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
