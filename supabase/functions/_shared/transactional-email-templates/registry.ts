/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as matchNotification } from './match-notification.tsx'
import { template as stateTransition } from './state-transition.tsx'
import { template as poiIssuance } from './poi-issuance.tsx'
import { template as poiInvite } from './poi-invite.tsx'
import { template as poiCounterpartyNotify } from './poi-counterparty-notify.tsx'
import { template as poiSupportDeskNotify } from './poi-support-desk-notify.tsx'
import { template as outreachIntentToTrade } from './outreach-intent-to-trade.tsx'
import { template as outreachSlaDigest } from './outreach-sla-digest.tsx'
import { template as acceptanceReceipt } from './acceptance-receipt.tsx'
import { template as revenueEventNotify } from './revenue-event-notify.tsx'
import { template as batchDInitiatorAlert } from './batch-d-initiator-alert.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'match-notification': matchNotification,
  'state-transition': stateTransition,
  'poi-issuance': poiIssuance,
  'poi-invite': poiInvite,
  'poi-counterparty-notify': poiCounterpartyNotify,
  'poi-support-desk-notify': poiSupportDeskNotify,
  'outreach-intent-to-trade': outreachIntentToTrade,
  'outreach-sla-digest': outreachSlaDigest,
  'acceptance-receipt': acceptanceReceipt,
  'revenue-event-notify': revenueEventNotify,
  // D4c-2: registered but NOT wired into any production trigger site.
  // Sole intended caller is `dispatchD4cInitiatorAlert`.
  'batch-d-initiator-alert': batchDInitiatorAlert,
}
