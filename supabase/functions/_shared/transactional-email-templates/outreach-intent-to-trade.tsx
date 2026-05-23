import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Text, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'
const REPLY_TO_DESK = 'support@izenzo.co.za'
const PLATFORM_BASE_URL = 'https://api.trade.izenzo.co.za'

/**
 * Build a deep-link into the trade. Unregistered recipients are routed via
 * /auth with a `returnTo` so they land on the match the moment they finish
 * onboarding. Registered recipients (already signed in) are bounced straight
 * through to the match page.
 */
const buildAcceptUrl = (matchId?: string): string | null => {
  if (!matchId) return null
  const target = `/desk/match/${matchId}`
  return `${PLATFORM_BASE_URL}/auth?returnTo=${encodeURIComponent(target)}`
}

interface OutreachIntentToTradeProps {
  // Counterparty
  counterpartyName?: string
  // Trade context
  commodity?: string
  side?: string                  // 'buyer' | 'seller' (the INITIATOR's side)
  counterpartyRole?: string      // What role we're inviting THEM to play
  quantityAmount?: number | string
  quantityUnit?: string
  priceAmount?: number | string
  priceCurrency?: string
  location?: string
  jurisdiction?: string
  // Initiator (registered counterparty on platform)
  initiatorOrgName?: string
  // Admin sending on behalf of
  adminName?: string
  adminTitle?: string
  // Free-form body the admin can edit before send
  customMessage?: string
  // Internal reference
  matchId?: string
}

const fmt = (v: number | string | undefined) =>
  v === undefined || v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString() : v

const OutreachIntentToTradeEmail = (props: OutreachIntentToTradeProps) => {
  const {
    counterpartyName,
    commodity,
    counterpartyRole,
    quantityAmount,
    quantityUnit,
    priceAmount,
    priceCurrency,
    location,
    jurisdiction,
    initiatorOrgName,
    adminName,
    customMessage,
    matchId,
  } = props

  const greeting = counterpartyName ? `Dear ${counterpartyName},` : 'Hello,'
  const roleLabel = counterpartyRole === 'buyer' ? 'buy' : counterpartyRole === 'seller' ? 'supply' : 'trade'

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        You have been invited to review a proposed trade on {SITE_NAME}{commodity ? ` — ${commodity}` : ''}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Proposed Trade — Invitation to Review</Heading>

          <Text style={text}>{greeting}</Text>

          <Text style={text}>
            You have been invited to review a proposed trade on {SITE_NAME}. This invitation does not confirm your acceptance. Please review the details and confirm whether you accept or decline participation.
          </Text>

          <Text style={text}>
            <strong>{initiatorOrgName || 'An organisation on the platform'}</strong> has
            proposed to {roleLabel}{commodity ? <> <strong>{commodity}</strong></> : ' a commodity'}
            {' '}with you. No engagement is recorded against you until you confirm.
          </Text>

          <Section style={detailBox}>
            <Text style={detailHeading}>Trade Details</Text>
            {commodity && (
              <Text style={detailText}>Commodity: <strong>{commodity}</strong></Text>
            )}
            {counterpartyRole && (
              <Text style={detailText}>
                Your invited role: <strong>{counterpartyRole === 'buyer' ? 'Buyer' : 'Seller'}</strong>
              </Text>
            )}
            {(quantityAmount || quantityUnit) && (
              <Text style={detailText}>
                Volume: <strong>{fmt(quantityAmount)} {quantityUnit || ''}</strong>
              </Text>
            )}
            {(priceAmount || priceCurrency) && (
              <Text style={detailText}>
                Indicative price: <strong>{priceCurrency || ''} {fmt(priceAmount)}</strong>
              </Text>
            )}
            {location && (
              <Text style={detailText}>Location: <strong>{location}</strong></Text>
            )}
            {jurisdiction && (
              <Text style={detailText}>Jurisdiction: <strong>{jurisdiction}</strong></Text>
            )}
            {matchId && (
              <Text style={detailText}>Reference: <strong style={mono}>{matchId.slice(0, 8)}</strong></Text>
            )}
          </Section>

          {customMessage && customMessage.trim().length > 0 && (
            <Section style={messageBox}>
              <Text style={text} dangerouslySetInnerHTML={undefined as any}>
                {customMessage.split('\n').map((line, i) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < customMessage.split('\n').length - 1 && <br />}
                  </React.Fragment>
                ))}
              </Text>
            </Section>
          )}

          {(() => {
            const acceptUrl = buildAcceptUrl(matchId)
            if (!acceptUrl) return null
            return (
              <Section style={{ margin: '8px 0 24px' }}>
                <Button href={acceptUrl} style={ctaButton}>
                  Review on {SITE_NAME}
                </Button>
                <Text style={ctaHint}>
                  Opens the {SITE_NAME} platform. If you do not yet have an account, you will be guided through a short onboarding before reviewing the trade.
                </Text>
              </Section>
            )
          })()}

          <Text style={text}>
            Alternatively, reply directly to this email — replies route to our
            compliance desk at <strong>{REPLY_TO_DESK}</strong> and we will
            facilitate the introduction manually.
          </Text>

          <Text style={text}>
            {SITE_NAME} provides a governed environment for cross-border commodity trading,
            including counterparty due-diligence workflows, recorded Proof-of-Intent records,
            and dispute governance. Records become mutual only once both parties have confirmed.
          </Text>

          <Hr style={hr} />

          <Text style={signature}>
            Kind regards,<br />
            <strong>{adminName || 'The Izenzo Compliance Desk'}</strong><br />
            <span style={{ color: '#6B7280' }}>{SITE_NAME} Compliance Desk</span><br />
            <span style={{ color: '#6B7280' }}>{REPLY_TO_DESK}</span>
          </Text>

          <Text style={footer}>
            This message was sent by an authorised member of the {SITE_NAME} compliance team
            following an explicit trade-interest registration. If you believe you received this in
            error, please reply and we will remove your address from our records.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: OutreachIntentToTradeEmail,
  subject: (data: Record<string, any>) => {
    const c = data.commodity ? ` — ${data.commodity}` : ''
    const ref = data.matchId ? ` [${String(data.matchId).slice(0, 8)}]` : ''
    return `Invitation to review a proposed trade on ${SITE_NAME}${c}${ref}`
  },
  displayName: 'Outreach — Intent to trade',
  previewData: {
    counterpartyName: 'Jane Smith',
    commodity: 'Yellow Maize',
    counterpartyRole: 'seller',
    quantityAmount: 25000,
    quantityUnit: 'MT',
    priceAmount: 245,
    priceCurrency: 'USD',
    location: 'Durban, South Africa',
    jurisdiction: 'ZA',
    initiatorOrgName: 'AgriTrade SA',
    adminName: 'Nicole van der Merwe',
    customMessage:
      'We understand from public records that your organisation operates in this commodity and region. We would be glad to share further context on a brief introductory call.',
    matchId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }
const h1 = { fontSize: '20px', fontWeight: '700' as const, color: '#111827', margin: '0 0 24px', borderBottom: '1px solid #E5E7EB', paddingBottom: '12px' }
const text = { fontSize: '14px', color: '#374151', lineHeight: '1.65', margin: '0 0 16px' }
const detailBox = { backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '4px', padding: '16px 20px', margin: '16px 0 20px' }
const detailHeading = { fontSize: '11px', fontWeight: '700' as const, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0 0 10px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 6px', lineHeight: '1.5' }
const messageBox = { backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '4px', padding: '14px 18px', margin: '0 0 20px' }
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }
const hr = { borderColor: '#E5E7EB', margin: '28px 0 20px' }
const signature = { fontSize: '13px', color: '#374151', lineHeight: '1.6', margin: '0 0 20px' }
const footer = { fontSize: '11px', color: '#9CA3AF', lineHeight: '1.5', margin: '20px 0 0', fontStyle: 'italic' as const }
const ctaButton = {
  backgroundColor: '#1B4533',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  padding: '12px 24px',
  borderRadius: '4px',
  textDecoration: 'none',
  display: 'inline-block',
}
const ctaHint = { fontSize: '12px', color: '#6B7280', lineHeight: '1.5', margin: '8px 0 0' }
