import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Izenzo'

interface Props {
  incidentNumber?: string
  incidentTitle?: string
  status?: string
  severity?: string
  updateBody?: string
  affectedComponents?: string
  statusPageUrl?: string
}

const Email = ({ incidentNumber, incidentTitle, status, severity, updateBody, affectedComponents, statusPageUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Platform update: {incidentTitle || 'Incident update'}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Platform incident update</Heading>
        {incidentTitle && (
          <Text style={text}>
            <strong>{incidentTitle}</strong>
          </Text>
        )}
        {incidentNumber && (
          <Text style={textSmall}>Reference: {incidentNumber}</Text>
        )}
        <Section style={statusBox}>
          {status && (
            <Text style={statusText}>Status: <strong>{status.replace(/_/g, ' ')}</strong></Text>
          )}
          {severity && (
            <Text style={statusText}>Severity: <strong>{severity}</strong></Text>
          )}
          {affectedComponents && (
            <Text style={statusText}>Affected: <strong>{affectedComponents}</strong></Text>
          )}
        </Section>
        {updateBody && <Text style={text}>{updateBody}</Text>}
        {statusPageUrl && (
          <Text style={text}>
            Latest status: <a href={statusPageUrl}>{statusPageUrl}</a>
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>
          You are receiving this because you have an open support ticket that may be affected.
          Automated notification from {SITE_NAME}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `Platform ${data.severity || 'update'}: ${data.incidentTitle || 'Incident update'} — ${SITE_NAME}`,
  displayName: 'Support incident update',
  previewData: {
    incidentNumber: 'INC-20260715-A1B2',
    incidentTitle: 'Elevated latency on evidence uploads',
    status: 'monitoring',
    severity: 'minor',
    updateBody: 'A fix is in place; we are monitoring for the next 30 minutes.',
    affectedComponents: 'api, evidence',
    statusPageUrl: 'https://izenzo.co.za/support/incidents',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#0F172A', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#334155', lineHeight: '1.6', margin: '0 0 16px' }
const textSmall = { fontSize: '12px', color: '#94A3B8', lineHeight: '1.5', margin: '0 0 16px', fontFamily: "'JetBrains Mono', monospace" }
const statusBox = { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '12px 16px', margin: '0 0 20px' }
const statusText = { fontSize: '13px', color: '#0F172A', margin: '0 0 4px' }
const hr = { borderColor: '#E2E8F0', margin: '24px 0' }
const footer = { fontSize: '12px', color: '#94A3B8', margin: '24px 0 0' }
