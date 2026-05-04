/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface PoiInviteProps {
  commodity?: string
  quantity?: string
  unit?: string
  price?: string
  currency?: string
  senderName?: string
  acceptUrl?: string
}

const PoiInviteEmail = ({
  commodity,
  quantity,
  unit,
  price,
  currency,
  senderName,
  acceptUrl,
}: PoiInviteProps) => {
  const termsLine = [
    quantity && unit ? `${quantity} ${unit}` : quantity,
    commodity,
    price && currency ? `at ${price} ${currency}/unit` : null,
  ].filter(Boolean).join(' of ') || 'a commodity'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>A Trade Request has been drafted for your review on {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>IZENZO</Text>
          <Hr style={divider} />
          <Heading style={h1}>Trade Request - Invitation</Heading>
          <Text style={text}>
            {senderName ? <><strong>{senderName}</strong> has</> : <>A trading partner has</>}{' '}
            drafted a Trade Request (POI) for your review regarding:
          </Text>
          <Text style={terms}>{termsLine}</Text>
          <Text style={text}>
            Create an account on {SITE_NAME} to review the full terms and securely
            accept this intent.
          </Text>
          {acceptUrl && (
            <Button style={button} href={acceptUrl}>
              Review &amp; Accept
            </Button>
          )}
          <Hr style={divider} />
          <Text style={footer}>
            If you were not expecting this invitation, you can safely ignore this email.
            This is an automated notification from {SITE_NAME}.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PoiInviteEmail,
  subject: (data: Record<string, any>) =>
    `POI drafted for your review: ${data.commodity || 'Trade Intent'} - ${SITE_NAME}`,
  displayName: 'POI trading partner invite',
  previewData: {
    commodity: 'Non-GMO Soybeans',
    quantity: '25000',
    unit: 'MT',
    price: '495',
    currency: 'USD',
    senderName: 'Festus Trading Ltd',
    acceptUrl: 'https://api.trade.izenzo.co.za/auth?redirect=/dashboard/matches/abc12345',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const brand = {
  fontSize: '13px',
  fontWeight: '700' as const,
  letterSpacing: '0.12em',
  color: '#1B4533',
  margin: '0 0 16px',
  fontFamily: "'JetBrains Mono', Courier, monospace",
}
const divider = { borderColor: '#D1D5DB', margin: '24px 0' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const terms = {
  fontSize: '16px',
  fontWeight: '600' as const,
  color: '#111827',
  backgroundColor: '#F3F4F6',
  padding: '12px 16px',
  borderRadius: '4px',
  margin: '0 0 20px',
  fontFamily: "'JetBrains Mono', monospace",
}
const button = {
  backgroundColor: '#1B4533',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '2px',
  padding: '12px 24px',
  textDecoration: 'none',
  fontWeight: '600' as const,
  margin: '0 0 8px',
}
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '0' }
