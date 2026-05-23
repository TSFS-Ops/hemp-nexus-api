import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface PoiIssuanceProps {
  matchId?: string
  commodity?: string
  poiState?: string
  issuedAt?: string
}

// DEC-006: initiator-facing recording confirmation. POI is described as a
// Draft record (initiator-generated intent record), not as "binding" or
// "sealed". Acceptance by the counterparty is still required.
const PoiIssuanceEmail = ({ matchId, commodity, poiState, issuedAt }: PoiIssuanceProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Draft Proof of Intent recorded for {commodity || 'your match'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Draft Proof of Intent Recorded</Heading>
        <Text style={text}>
          A Draft Proof of Intent (POI) — an initiator-generated intent record, awaiting counterparty
          confirmation — has been recorded for your {commodity ? <strong>{commodity}</strong> : 'match'} on
          the {SITE_NAME} platform. WaD, execution, and finality remain subject to the next required
          workflow steps.
        </Text>
        <Section style={detailBox}>
          {poiState && (
            <Text style={detailText}>POI State: <strong>{poiState}</strong></Text>
          )}
          {issuedAt && (
            <Text style={detailText}>Recorded: <strong>{issuedAt}</strong></Text>
          )}
          {matchId && (
            <Text style={detailText}>Reference: <strong>{matchId.slice(0, 8)}</strong></Text>
          )}
        </Section>
        <Text style={text}>
          This record forms part of your evidence chain. The cryptographic hash of this event has been
          recorded.
        </Text>
        <Text style={text}>
          Log in to your console to view the full evidence pack.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          This is an automated notification from {SITE_NAME}. Do not reply to this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PoiIssuanceEmail,
  subject: (data: Record<string, any>) =>
    `Draft POI recorded: ${data.commodity || 'Match'} - ${SITE_NAME}`,
  displayName: 'POI issuance',
  previewData: { matchId: 'a1b2c3d4-e5f6', commodity: 'Refined Sunflower Oil', poiState: 'intent_declared', issuedAt: '2026-04-08T12:00:00Z' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const detailBox = { backgroundColor: '#F3F4F6', borderRadius: '2px', padding: '12px 16px', margin: '0 0 20px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 6px' }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
