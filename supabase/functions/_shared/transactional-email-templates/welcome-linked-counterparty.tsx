/**
 * Welcome — Linked Counterparty
 *
 * Sent automatically when a previously off-platform counterparty signs up
 * and the auto_link_engagement_on_signup trigger links their new
 * organisation to a pending Trade Request (POI).
 *
 * The recipient is the newly-registered user. The CTA is a deep link
 * straight to the Match Details page where the AcceptEngagementCard is
 * waiting for their response.
 */

import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'
const APP_BASE_URL = 'https://compliance-matching.lovable.app'

interface WelcomeLinkedCounterpartyProps {
  recipientName?: string
  commodity?: string
  initiatorOrgName?: string
  side?: string
  matchId?: string
  quantityAmount?: string
  quantityUnit?: string
  priceAmount?: string
  priceCurrency?: string
}

const WelcomeLinkedCounterpartyEmail = ({
  recipientName,
  commodity,
  initiatorOrgName,
  side,
  matchId,
  quantityAmount,
  quantityUnit,
  priceAmount,
  priceCurrency,
}: WelcomeLinkedCounterpartyProps) => {
  const greeting = recipientName ? `Welcome, ${recipientName}` : 'Welcome to Izenzo'
  const roleLabel = side === 'buyer' ? 'Buyer' : side === 'seller' ? 'Seller' : 'Counterparty'
  const deepLink = `${APP_BASE_URL}/desk/match/${matchId || ''}`

  const hasQuantity = quantityAmount && quantityUnit
  const hasPrice = priceAmount && priceCurrency

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        Your account is ready — a Trade Request is waiting for your response on {SITE_NAME}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{greeting}</Heading>

          <Text style={text}>
            Your {SITE_NAME} account is active. Because you were already named as
            a counterparty on an open Trade Request, we've linked it to your
            new organisation automatically — no further setup needed.
          </Text>

          <Section style={detailBox}>
            <Text style={detailLabel}>Trade Request waiting for you</Text>
            {commodity && (
              <Text style={detailText}>Commodity: <strong>{commodity}</strong></Text>
            )}
            {initiatorOrgName && (
              <Text style={detailText}>Initiated by: <strong>{initiatorOrgName}</strong></Text>
            )}
            <Text style={detailText}>Your role: <strong>{roleLabel}</strong></Text>
            {hasQuantity && (
              <Text style={detailText}>Quantity: <strong>{quantityAmount} {quantityUnit}</strong></Text>
            )}
            {hasPrice && (
              <Text style={detailText}>Indicative price: <strong>{priceAmount} {priceCurrency}</strong></Text>
            )}
            {matchId && (
              <Text style={detailText}>Reference: <strong>{matchId.slice(0, 8)}</strong></Text>
            )}
          </Section>

          <Text style={text}>
            Open the Trade Request to review the full details and either{' '}
            <strong>accept</strong> to progress the deal or <strong>decline</strong>{' '}
            if you're not interested. The initiator cannot move forward until
            you respond.
          </Text>

          <Section style={ctaSection}>
            <Button href={deepLink} style={button}>
              Open Trade Request
            </Button>
          </Section>

          <Text style={smallText}>
            Or copy this link into your browser:{' '}
            <span style={linkText}>{deepLink}</span>
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            You're receiving this because you were named as a counterparty on a
            Trade Request and have just registered with this email address. This
            is an automated notification from {SITE_NAME}. For help, contact{' '}
            support@izenzo.co.za.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeLinkedCounterpartyEmail,
  subject: (data: Record<string, any>) =>
    `[Izenzo] A ${data.commodity || 'Trade'} request is waiting in your dashboard`,
  displayName: 'Welcome — linked counterparty',
  previewData: {
    recipientName: 'Thabo Mokoena',
    commodity: 'Yellow Maize',
    initiatorOrgName: 'AgriTrade SA',
    side: 'seller',
    matchId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    quantityAmount: '5000',
    quantityUnit: 'MT',
    priceAmount: '4200',
    priceCurrency: 'ZAR',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px', letterSpacing: '-0.01em' }
const text = { fontSize: '14px', color: '#4B5563', lineHeight: '1.6', margin: '0 0 16px' }
const smallText = { fontSize: '12px', color: '#6B7280', lineHeight: '1.5', margin: '16px 0 0', wordBreak: 'break-all' as const }
const linkText = { color: '#111827', textDecoration: 'underline' }
const detailBox = { backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '4px', padding: '16px 20px', margin: '0 0 20px' }
const detailLabel = { fontSize: '11px', color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontWeight: '600' as const, margin: '0 0 10px' }
const detailText = { fontSize: '13px', color: '#1F2937', margin: '0 0 6px', lineHeight: '1.5' }
const ctaSection = { textAlign: 'center' as const, margin: '24px 0 8px' }
const button = { backgroundColor: '#111827', color: '#ffffff', padding: '12px 28px', borderRadius: '4px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#E5E7EB', margin: '28px 0 20px' }
const footer = { fontSize: '11px', color: '#9CA3AF', lineHeight: '1.6', margin: '0' }
