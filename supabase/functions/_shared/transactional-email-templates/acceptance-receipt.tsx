/**
 * Acceptance Receipt Email
 * ─────────────────────────
 * Sent to the initiator the moment a counterparty formally accepts a POI
 * engagement. Carries the immutable receipt ID and signature hash so the
 * recipient can self-verify the trade transition without contacting support.
 */

import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { ACCEPTANCE_RECEIPT_CLAUSE } from '../audit-ledger-copy.ts'

const SITE_NAME = 'Izenzo'

interface AcceptanceReceiptProps {
  recipientName?: string
  matchId?: string
  commodity?: string
  counterpartyEmail?: string
  acceptedAt?: string
  receiptId?: string
  signatureHash?: string
  matchUrl?: string
}

const AcceptanceReceiptEmail = ({
  recipientName,
  matchId,
  commodity,
  counterpartyEmail,
  acceptedAt,
  receiptId,
  signatureHash,
  matchUrl,
}: AcceptanceReceiptProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Your counterparty has accepted{commodity ? ` the ${commodity} engagement` : ' the engagement'}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {recipientName ? `${recipientName}, your counterparty has accepted` : 'Your counterparty has accepted'}
        </Heading>
        <Text style={text}>
          {ACCEPTANCE_RECEIPT_CLAUSE}
          {' '}You do not need to contact support to confirm this transition.
        </Text>

        <Section style={panel}>
          {commodity && (
            <Text style={panelRow}><strong>Commodity:</strong> {commodity}</Text>
          )}
          {counterpartyEmail && (
            <Text style={panelRow}><strong>Accepted by:</strong> {counterpartyEmail}</Text>
          )}
          {acceptedAt && (
            <Text style={panelRow}><strong>Accepted at:</strong> {acceptedAt}</Text>
          )}
          {matchId && (
            <Text style={panelRow}><strong>Match ID:</strong> {matchId}</Text>
          )}
          {receiptId && (
            <Text style={panelRow}><strong>Receipt ID:</strong> {receiptId}</Text>
          )}
        </Section>

        {signatureHash && (
          <>
            <Text style={hashLabel}>SHA-256 signature hash</Text>
            <Text style={hashValue}>{signatureHash}</Text>
          </>
        )}

        {matchUrl && (
          <Section style={{ textAlign: 'center', margin: '28px 0 12px' }}>
            <Button href={matchUrl} style={button}>View signed receipt</Button>
          </Section>
        )}

        <Hr style={hr} />
        <Text style={footer}>
          This is an automated trade-state notification from {SITE_NAME}.
          The receipt above is a permanent audit record of the acceptance event.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: AcceptanceReceiptEmail,
  subject: (data: Record<string, unknown>) =>
    data?.commodity
      ? `Acceptance receipt — ${data.commodity}`
      : 'Acceptance receipt for your engagement',
  displayName: 'Acceptance receipt',
  previewData: {
    recipientName: 'Daniel',
    matchId: '2378d188-78a6-49fd-ba12-c74fc594c3a5',
    commodity: 'Platinum',
    counterpartyEmail: 'counterparty@example.com',
    acceptedAt: '2026-04-23 07:42:11 UTC',
    receiptId: '3d830d66-5114-4b6f-bb79-0ca0f1c3ce53',
    signatureHash: 'a0f78d8d16778f1fcd9067e89cb3d11a05605b6a4d6136ce1f6777da706ce1f6',
    matchUrl: 'https://izenzo.co.za/dashboard/matches/2378d188-78a6-49fd-ba12-c74fc594c3a5',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '20px', fontWeight: 'bold' as const, color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.55', margin: '0 0 18px' }
const panel = { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '14px 16px', margin: '0 0 18px' }
const panelRow = { fontSize: '13px', color: '#0f172a', margin: '4px 0' }
const hashLabel = { fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: '#64748b', margin: '12px 0 4px' }
const hashValue = { fontSize: '11px', fontFamily: 'Menlo, Consolas, monospace', color: '#0f172a', backgroundColor: '#f1f5f9', padding: '8px 10px', borderRadius: '3px', wordBreak: 'break-all' as const, margin: '0 0 8px' }
const button = { backgroundColor: '#0f172a', color: '#ffffff', padding: '10px 18px', borderRadius: '4px', textDecoration: 'none', fontSize: '13px', fontWeight: 'bold' as const }
const hr = { borderColor: '#e2e8f0', margin: '24px 0 12px' }
const footer = { fontSize: '11px', color: '#94a3b8', lineHeight: '1.5', margin: 0 }
