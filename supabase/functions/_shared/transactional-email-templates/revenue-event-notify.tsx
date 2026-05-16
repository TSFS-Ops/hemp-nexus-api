/**
 * Revenue Event Notification — internal alert to support@izenzo.co.za
 * whenever Izenzo earns or recognises revenue. Single template, three event
 * shapes, so the support inbox stays consolidated and searchable by subject
 * prefix:
 *
 *   [Izenzo Revenue] POI minted        — bilateral POI generated (R10 credit burn)
 *   [Izenzo Revenue] Credits purchased — Paystack charge.success
 *   [Izenzo Revenue] WaD sealed        — trade certified / sale completed
 *
 * NEVER add unsubscribe text — system appends compliant footer automatically.
 */

import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

type RevenueEventType = 'poi_minted' | 'credits_purchased' | 'credits_refunded' | 'wad_sealed'

interface RevenueEventNotifyProps {
  eventType: RevenueEventType
  /** Plain-language headline already localised by the caller */
  headline?: string
  /** Org that triggered the event */
  orgName?: string
  orgId?: string
  /** Optional contact email for the triggering org */
  contactEmail?: string
  /** Free-form key/value pairs rendered as a detail block */
  details?: Record<string, string | number | undefined | null>
  /** Optional deep-link into the admin console */
  consoleUrl?: string
  consoleLabel?: string
  /** ISO timestamp of the event */
  occurredAt?: string
  /** Stable identifier for support-desk reference */
  referenceId?: string
}

const LABELS: Record<RevenueEventType, { tag: string; intro: string }> = {
  poi_minted: {
    tag: 'POI minted',
    intro: 'A Proof of Intent was generated. A credit was burned (revenue recognised).',
  },
  credits_purchased: {
    tag: 'Credits purchased',
    intro: 'A credit top-up was successfully paid via Paystack.',
  },
  wad_sealed: {
    tag: 'WaD sealed',
    intro: 'A Without-a-Doubt certificate was sealed — the trade has been certified.',
  },
}

const RevenueEventNotifyEmail = ({
  eventType,
  headline,
  orgName,
  orgId,
  contactEmail,
  details,
  consoleUrl,
  consoleLabel,
  occurredAt,
  referenceId,
}: RevenueEventNotifyProps) => {
  const meta = LABELS[eventType] ?? { tag: 'Revenue event', intro: 'A revenue event occurred.' }
  const detailEntries = Object.entries(details || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${meta.tag} — ${headline || orgName || 'Izenzo revenue event'}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={tag}>{meta.tag}</Text>
          <Heading style={h1}>{headline || meta.tag}</Heading>
          <Text style={text}>{meta.intro}</Text>

          {(orgName || orgId || contactEmail) && (
            <Section style={detailBox}>
              <Text style={sectionTitle}>Organisation</Text>
              {orgName && <Text style={detailText}>Name: <strong>{orgName}</strong></Text>}
              {orgId && <Text style={detailText}>Org ID: <strong>{orgId}</strong></Text>}
              {contactEmail && <Text style={detailText}>Contact: <strong>{contactEmail}</strong></Text>}
            </Section>
          )}

          {detailEntries.length > 0 && (
            <Section style={detailBox}>
              <Text style={sectionTitle}>Event details</Text>
              {detailEntries.map(([k, v]) => (
                <Text key={k} style={detailText}>
                  {k}: <strong>{String(v)}</strong>
                </Text>
              ))}
            </Section>
          )}

          {(referenceId || occurredAt) && (
            <Section style={detailBox}>
              <Text style={sectionTitle}>Reference</Text>
              {referenceId && <Text style={detailText}>Reference: <strong>{referenceId}</strong></Text>}
              {occurredAt && <Text style={detailText}>Occurred: <strong>{occurredAt}</strong></Text>}
            </Section>
          )}

          {consoleUrl && (
            <Button href={consoleUrl} style={button}>
              {consoleLabel || 'Open in console'}
            </Button>
          )}

          <Hr style={hr} />
          <Text style={footer}>
            Automated revenue notification from {SITE_NAME}. Forwarded to the support desk for awareness — no action is required unless the event details look anomalous.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: RevenueEventNotifyEmail,
  subject: (data: Record<string, any>) => {
    const tag = LABELS[(data.eventType as RevenueEventType)]?.tag ?? 'Revenue event'
    const who = data.orgName || data.headline || 'Izenzo'
    return `[Izenzo Revenue] ${tag} — ${who}`
  },
  to: 'support@izenzo.co.za',
  displayName: 'Revenue event — internal',
  previewData: {
    eventType: 'poi_minted',
    headline: 'POI minted by AgriTrade SA — Rhodium 50 kg',
    orgName: 'AgriTrade SA',
    orgId: '03ac6e2c-fbb8-4593-b619-cb752a175fff',
    contactEmail: 'ops@agritrade.example',
    details: {
      Commodity: 'Rhodium',
      Quantity: '50 kg',
      Price: 'USD 100',
      'Match ID': '66422f18-5a28-4afb-a539',
      Counterparty: 'Polska sp. z o.o.',
      'Credits burned': 1,
    },
    consoleUrl: 'https://api.trade.izenzo.co.za/desk/match/66422f18-5a28-4afb-a539',
    consoleLabel: 'Open match',
    occurredAt: '2026-04-26T08:14:11Z',
    referenceId: '66422f18-5a28-4afb-a539',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const tag = { fontSize: '11px', fontWeight: '700' as const, color: '#0F766E', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 8px' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 12px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 20px' }
const sectionTitle = { fontSize: '12px', fontWeight: '700' as const, color: '#9CA3AF', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 8px' }
const detailBox = { backgroundColor: '#F3F4F6', borderRadius: '2px', padding: '12px 16px', margin: '0 0 16px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 6px' }
const button = { backgroundColor: '#111827', color: '#ffffff', padding: '10px 20px', borderRadius: '4px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0' }
