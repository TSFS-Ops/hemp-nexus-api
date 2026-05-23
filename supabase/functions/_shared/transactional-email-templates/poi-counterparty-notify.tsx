import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface PoiCounterpartyNotifyProps {
  commodity?: string
  creatorOrgName?: string
  matchId?: string
  side?: string
  issuedAt?: string
}

// DEC-006: pre-acceptance POI labelling. Recipient has not yet accepted,
// so the POI is described as a Draft, not "issued" / "sealed".
const PoiCounterpartyNotifyEmail = ({ commodity, creatorOrgName, matchId, side, issuedAt }: PoiCounterpartyNotifyProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You have been invited to review a proposed trade on {SITE_NAME}{commodity ? ` — ${commodity}` : ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Trade Request — Your Confirmation Needed</Heading>
        <Text style={text}>
          A Draft Proof of Intent (POI) — an initiator-generated intent record, awaiting your confirmation —
          has been recorded on the {SITE_NAME} platform for a trade involving your organisation. This is
          not yet a mutual intent record. Nothing is recorded against your organisation until you confirm.
        </Text>
        <Section style={detailBox}>
          {commodity && (
            <Text style={detailText}>Commodity: <strong>{commodity}</strong></Text>
          )}
          {creatorOrgName && (
            <Text style={detailText}>Initiated by: <strong>{creatorOrgName}</strong></Text>
          )}
          {side && (
            <Text style={detailText}>Your role: <strong>{side === 'buyer' ? 'Buyer' : 'Seller'}</strong></Text>
          )}
          {issuedAt && (
            <Text style={detailText}>Recorded: <strong>{issuedAt}</strong></Text>
          )}
          {matchId && (
            <Text style={detailText}>Reference: <strong>{matchId.slice(0, 8)}</strong></Text>
          )}
        </Section>
        <Text style={text}>
          Please log in to your console to review the details and confirm whether you accept or decline.
        </Text>
        <Button
          href={`https://api.trade.izenzo.co.za/desk/match/${matchId || ''}`}
          style={button}
        >
          Review Trade Request
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          This is an automated notification from {SITE_NAME}. Do not reply to this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PoiCounterpartyNotifyEmail,
  subject: (data: Record<string, any>) =>
    `[Izenzo] Trade Request — your confirmation needed${data.commodity ? `: ${data.commodity}` : ''}`,
  displayName: 'POI counterparty notification',
  previewData: {
    commodity: 'Yellow Maize',
    creatorOrgName: 'AgriTrade SA',
    matchId: 'a1b2c3d4-e5f6-7890',
    side: 'seller',
    issuedAt: '2026-04-14T10:00:00Z',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const detailBox = { backgroundColor: '#F3F4F6', borderRadius: '2px', padding: '12px 16px', margin: '0 0 20px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 6px' }
const button = { backgroundColor: '#111827', color: '#ffffff', padding: '10px 20px', borderRadius: '4px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
