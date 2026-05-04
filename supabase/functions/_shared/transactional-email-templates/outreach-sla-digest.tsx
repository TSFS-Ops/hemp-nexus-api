import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface OverdueItem {
  engagementId: string
  matchId: string | null
  commodity: string | null
  initiatorOrgName: string | null
  counterpartyEmail: string | null
  counterpartyName: string | null
  status: string
  ageHours: number
  reminderCount: number
}

interface OutreachSlaDigestProps {
  thresholdHours?: number
  overdueCount?: number
  items?: OverdueItem[]
  generatedAt?: string
}

const OutreachSlaDigest = ({
  thresholdHours = 48,
  overdueCount = 0,
  items = [],
  generatedAt,
}: OutreachSlaDigestProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${overdueCount} POI engagement${overdueCount === 1 ? '' : 's'} overdue beyond ${thresholdHours}h`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Outreach SLA Breach</Heading>
        <Text style={text}>
          The following counterparty engagements have been awaiting outreach for
          longer than the configured SLA of <strong>{thresholdHours} hours</strong>.
          Please action them from the Pending Engagements console.
        </Text>

        <Section style={summaryBox}>
          <Text style={summaryNumber}>{overdueCount}</Text>
          <Text style={summaryLabel}>overdue engagement{overdueCount === 1 ? '' : 's'}</Text>
        </Section>

        {items.map((it) => (
          <Section key={it.engagementId} style={itemBox}>
            <Text style={itemHeader}>
              {it.commodity || 'Trade'} — {it.initiatorOrgName || 'Unknown initiator'}
            </Text>
            <Text style={detailText}>
              Counterparty: <strong>{it.counterpartyName || it.counterpartyEmail || '(no contact)'}</strong>
            </Text>
            <Text style={detailText}>
              Status: <strong>{it.status}</strong> · Age: <strong>{Math.round(it.ageHours)}h</strong>
              {it.reminderCount > 0 && (
                <> · Reminders sent: <strong>{it.reminderCount}</strong></>
              )}
            </Text>
            <Text style={refText}>Engagement ref: {it.engagementId.slice(0, 8)}</Text>
          </Section>
        ))}

        <Button
          href="https://api.trade.izenzo.co.za/admin?tab=engagements"
          style={button}
        >
          Open Pending Engagements
        </Button>

        <Hr style={hr} />
        <Text style={footer}>
          Automated SLA digest from {SITE_NAME}. Configure threshold and digest
          recipient in Admin → Settings → Outreach SLA.
          {generatedAt && <> Generated {generatedAt}.</>}
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: OutreachSlaDigest,
  subject: (data: Record<string, any>) =>
    `[Izenzo SLA] ${data.overdueCount ?? 0} engagement${(data.overdueCount ?? 0) === 1 ? '' : 's'} overdue >${data.thresholdHours ?? 48}h`,
  displayName: 'Outreach SLA digest',
  previewData: {
    thresholdHours: 48,
    overdueCount: 2,
    generatedAt: new Date().toISOString(),
    items: [
      {
        engagementId: '66422f18-5a28-4afb-a539-aa11bb22cc33',
        matchId: '66422f18-5a28-4afb-a539-aa11bb22cc33',
        commodity: 'Rhodium',
        initiatorOrgName: 'AgriTrade SA',
        counterpartyEmail: 'jane.doe@example.com',
        counterpartyName: null,
        status: 'pending',
        ageHours: 72,
        reminderCount: 0,
      },
      {
        engagementId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        matchId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        commodity: 'Copper Cathode',
        initiatorOrgName: 'NorthMine Ltd',
        counterpartyEmail: 'ops@buyer.example',
        counterpartyName: 'Buyer Co',
        status: 'notification_sent',
        ageHours: 96,
        reminderCount: 1,
      },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '600px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#6B7280', lineHeight: '1.6', margin: '0 0 16px' }
const summaryBox = { backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '4px', padding: '16px', margin: '0 0 20px', textAlign: 'center' as const }
const summaryNumber = { fontSize: '32px', fontWeight: '700' as const, color: '#92400E', margin: '0' }
const summaryLabel = { fontSize: '12px', color: '#92400E', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '4px 0 0' }
const itemBox = { backgroundColor: '#F9FAFB', borderLeft: '3px solid #F59E0B', borderRadius: '2px', padding: '12px 16px', margin: '0 0 12px' }
const itemHeader = { fontSize: '14px', fontWeight: '700' as const, color: '#111827', margin: '0 0 6px' }
const detailText = { fontSize: '13px', color: '#374151', margin: '0 0 4px' }
const refText = { fontSize: '11px', color: '#9CA3AF', fontFamily: 'monospace', margin: '6px 0 0' }
const button = { backgroundColor: '#111827', color: '#ffffff', padding: '10px 20px', borderRadius: '4px', fontSize: '14px', fontWeight: '600' as const, textDecoration: 'none', display: 'inline-block', margin: '8px 0 0' }
const hr = { borderColor: '#D1D5DB', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: '24px 0 0', lineHeight: '1.6' }
