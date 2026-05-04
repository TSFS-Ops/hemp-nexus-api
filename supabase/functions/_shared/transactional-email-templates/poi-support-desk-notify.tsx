import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface PoiSupportDeskNotifyProps {
  commodity?: string
  creatorOrgName?: string
  creatorEmail?: string
  matchId?: string
  buyerName?: string
  sellerName?: string
  quantityAmount?: string
  quantityUnit?: string
  priceAmount?: string
  priceCurrency?: string
  issuedAt?: string
}

const PoiSupportDeskNotifyEmail = ({
  commodity, creatorOrgName, creatorEmail, matchId,
  buyerName, sellerName,
  quantityAmount, quantityUnit, priceAmount, priceCurrency,
  issuedAt,
}: PoiSupportDeskNotifyProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Manual outreach required — counterparty not on platform for {commodity || 'trade'} POI</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Support Action Required</Heading>
        <Text style={text}>
          A Proof of Intent has been generated on {SITE_NAME} for a trade where the counterparty is <strong>not registered on the platform</strong>.
          Manual outreach is required to facilitate engagement.
        </Text>
        <Section style={detailBox}>
          <Text style={sectionTitle}>Trade Details</Text>
          {commodity && (
            <Text style={detailText}>Commodity: <strong>{commodity}</strong></Text>
          )}
          {buyerName && (
            <Text style={detailText}>Buyer: <strong>{buyerName}</strong></Text>
          )}
          {sellerName && (
            <Text style={detailText}>Seller: <strong>{sellerName}</strong></Text>
          )}
          {quantityAmount && (
            <Text style={detailText}>Quantity: <strong>{quantityAmount} {quantityUnit || ''}</strong></Text>
          )}
          {priceAmount && (
            <Text style={detailText}>Price: <strong>{priceCurrency || ''} {priceAmount}</strong></Text>
          )}
        </Section>
        <Section style={detailBox}>
          <Text style={sectionTitle}>Initiator</Text>
          {creatorOrgName && (
            <Text style={detailText}>Organisation: <strong>{creatorOrgName}</strong></Text>
          )}
          {creatorEmail && (
            <Text style={detailText}>Contact: <strong>{creatorEmail}</strong></Text>
          )}
        </Section>
        <Section style={detailBox}>
          <Text style={sectionTitle}>Reference</Text>
          {matchId && (
            <Text style={detailText}>Match ID: <strong>{matchId.slice(0, 8)}</strong></Text>
          )}
          {issuedAt && (
            <Text style={detailText}>Issued: <strong>{issuedAt}</strong></Text>
          )}
        </Section>
        <Button
          href={`https://api.trade.izenzo.co.za/desk/match/${matchId || ''}`}
          style={button}
        >
          View in Console
        </Button>
        <Hr style={hr} />
        <Text style={footer}>
          This is an automated support-desk notification from {SITE_NAME}. The counterparty must be contacted manually to proceed with this trade.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: PoiSupportDeskNotifyEmail,
  subject: (data: Record<string, any>) =>
    `[Izenzo Support] Manual outreach needed: ${data.commodity || 'Trade'} POI — ${data.sellerName || data.buyerName || 'unknown counterparty'}`,
  to: 'support@izenzo.co.za',
  displayName: 'POI support desk — unknown counterparty',
  previewData: {
    commodity: 'Rhodium',
    creatorOrgName: 'AgriTrade SA',
    creatorEmail: 'joshtkruger@gmail.com',
    matchId: '66422f18-5a28-4afb-a539',
    buyerName: 'joshtkruger@gmail.com',
    sellerName: 'Polska sp.z o.o.',
    quantityAmount: '50',
    quantityUnit: 'kg',
    priceAmount: '100',
    priceCurrency: 'USD',
    issuedAt: '2026-04-15T07:38:00Z',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const sectionTitle = { fontSize: '12px', fontWeight: '700' as const, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 8px' }
const detailBox = { backgroundColor: '#F3F4F6', borderRadius: '2px', padding: '12px 16px', margin: '0 0 16px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 6px' }
const button = { backgroundColor: '#111827', color: '#ffffff', padding: '10px 20px', borderRadius: '4px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
