/**
 * P-5 Batch 3 — Stage 6 notification derivation engine (pure TS).
 *
 * Maps Batch 3 lifecycle events to safe-wording notification intents with
 * idempotency keys. Split between EXTERNAL (funder/email-safe) and INTERNAL
 * (admin/operator) channels. External messages must never include admin-only
 * notes, raw sensitive data, other funders, internal risk flags, raw provider
 * responses or hidden governance reason codes.
 *
 * NO DB I/O here. Consumers (admin UI, Stage 6 monitor edge function) persist
 * the resulting intent through controlled server-side paths.
 */

export const P5B3_NOTIFICATION_TRIGGERS = [
  "funder_invited",
  "access_approved",
  "access_changed",
  "access_expiring",
  "access_revoked",
  "released_pack_available",
  "released_pack_version_changed",
  "admin_replied_request",
  "approved_information_request_answered",
  "request_closed",
  "funder_status_requires_action",
  "finality_reached",
  "transaction_closed",
  "funder_accepted_invitation",
  "funder_viewed_or_downloaded_pack",
  "funder_asked_question",
  "funder_requested_evidence",
  "funder_marked_interested_or_declined",
  "funder_submitted_outcome",
  "funder_uploaded_document",
  "api_usage_unusual_placeholder",
  "request_overdue",
] as const;
export type P5B3NotificationTrigger = (typeof P5B3_NOTIFICATION_TRIGGERS)[number];

export type P5B3NotificationAudience = "external_funder" | "internal_admin";

export interface P5B3NotificationIntent {
  trigger: P5B3NotificationTrigger;
  audience: P5B3NotificationAudience;
  /** Stable idempotency key — same input always yields the same key. */
  idempotency_key: string;
  /** Short subject (email-safe; no sensitive data). */
  subject: string;
  /** Body lines (email-safe; no sensitive data). */
  body_lines: readonly string[];
  /** Opaque correlation identifiers (no payload data). */
  refs: {
    grant_id?: string;
    request_id?: string;
    outcome_id?: string;
    org_id?: string;
    transaction_reference?: string;
    evidence_pack_version?: string;
  };
}

/** Tokens that must never appear in EXTERNAL funder/email messages. */
const FORBIDDEN_EXTERNAL_TOKENS: readonly RegExp[] = [
  /\bVerified\b/,
  /\bGuaranteed\b/,
  /\bCompliance Passed\b/,
  /\bSanctions Cleared\b/,
  /\bBankable\b/,
  /\bProvider Verified\b/,
  /\bInvestment Grade\b/,
  /\bDue Diligence Complete\b/,
  /\bother funder\b/i,
  /\binternal note\b/i,
  /\binternal risk\b/i,
  /\bgovernance reason code\b/i,
  /\braw bank\b/i,
  /\braw iban\b/i,
  /\braw passport\b/i,
  /\braw id\b/i,
];

export function isExternalSafe(text: string): boolean {
  return !FORBIDDEN_EXTERNAL_TOKENS.some((re) => re.test(text));
}

export function assertExternalSafe(intent: P5B3NotificationIntent): void {
  if (intent.audience !== "external_funder") return;
  const all = [intent.subject, ...intent.body_lines].join("\n");
  if (!isExternalSafe(all)) {
    throw new Error(
      `p5b3 notification (${intent.trigger}) violates external wording policy`,
    );
  }
}

/** Deterministic idempotency key. Inputs must be stable identifiers. */
export function deriveIdempotencyKey(
  trigger: P5B3NotificationTrigger,
  audience: P5B3NotificationAudience,
  parts: readonly (string | undefined | null)[],
): string {
  const norm = parts.map((p) => (p ?? "")).join("|");
  return `p5b3:${trigger}:${audience}:${norm}`;
}

export interface P5B3NotificationInput {
  trigger: P5B3NotificationTrigger;
  grant_id?: string;
  request_id?: string;
  outcome_id?: string;
  org_id?: string;
  transaction_reference?: string;
  evidence_pack_version?: string;
  /** Optional admin-only context — only used for internal_admin audience. */
  internal_context?: string;
  occurrence_token?: string;
}

// Generic mapping table: each trigger produces a safe external message (when
// applicable) plus an internal-admin message. Approval is always messaged as
// non-final to funders.
const EXTERNAL_DISABLED: ReadonlySet<P5B3NotificationTrigger> = new Set([
  "api_usage_unusual_placeholder", // internal-only future hook
  "funder_status_requires_action", // internal-only (admin reviews status)
]);

const EXTERNAL_TEMPLATES: Partial<Record<P5B3NotificationTrigger, (i: P5B3NotificationInput) => { subject: string; body: string[] }>> = {
  funder_invited: () => ({
    subject: "You have been invited to review a transaction",
    body: [
      "An administrator has invited you to review a released information pack.",
      "Access is scoped, time-limited, and may be revoked at any time.",
    ],
  }),
  access_approved: (i) => ({
    subject: "Access approved for the released information pack",
    body: [
      `Reference: ${i.transaction_reference ?? "—"}`,
      "Access is scoped to the released pack version and expires per the grant terms.",
    ],
  }),
  access_changed: () => ({
    subject: "Your access scope has changed",
    body: ["An administrator has updated the scope of your access. Please review."],
  }),
  access_expiring: () => ({
    subject: "Your access is approaching expiry",
    body: ["Your scoped access will expire shortly. Contact the administrator if extension is required."],
  }),
  access_revoked: () => ({
    subject: "Your access has been revoked",
    body: ["An administrator has revoked your access. Any pending requests are now closed."],
  }),
  released_pack_available: () => ({
    subject: "A released information pack is available",
    body: ["A released information pack is now available within your scoped access."],
  }),
  released_pack_version_changed: (i) => ({
    subject: "A new released pack version is available",
    body: [`A new released version (${i.evidence_pack_version ?? "—"}) is available within your scoped access.`],
  }),
  admin_replied_request: () => ({
    subject: "An administrator has replied to your request",
    body: ["An administrator has responded to one of your information requests."],
  }),
  approved_information_request_answered: () => ({
    subject: "Your approved information request has been answered",
    body: ["A response to your approved information request is now available."],
  }),
  request_closed: () => ({
    subject: "Your information request has been closed",
    body: ["An administrator has closed one of your information requests."],
  }),
  finality_reached: () => ({
    subject: "Administrator decision recorded",
    body: [
      "An administrator has recorded a final decision on this transaction.",
      "This decision does not constitute investment advice.",
    ],
  }),
  transaction_closed: () => ({
    subject: "This transaction is now closed",
    body: ["The transaction associated with your access has been closed by an administrator."],
  }),
  request_overdue: () => ({
    subject: "An information request is overdue for review",
    body: ["One of your submitted requests is overdue for administrator review."],
  }),
};

const INTERNAL_SUBJECTS: Record<P5B3NotificationTrigger, string> = {
  funder_invited: "[Batch 3] Funder invited",
  access_approved: "[Batch 3] Funder access approved",
  access_changed: "[Batch 3] Funder access scope changed",
  access_expiring: "[Batch 3] Funder access expiring",
  access_revoked: "[Batch 3] Funder access revoked",
  released_pack_available: "[Batch 3] Released pack available to funder",
  released_pack_version_changed: "[Batch 3] Released pack version changed",
  admin_replied_request: "[Batch 3] Admin replied to funder request",
  approved_information_request_answered: "[Batch 3] Approved request answered",
  request_closed: "[Batch 3] Request closed",
  funder_status_requires_action: "[Batch 3] Funder status requires admin action",
  finality_reached: "[Batch 3] Finality reached (admin-confirmed)",
  transaction_closed: "[Batch 3] Transaction closed",
  funder_accepted_invitation: "[Batch 3] Funder accepted invitation",
  funder_viewed_or_downloaded_pack: "[Batch 3] Funder viewed/downloaded pack",
  funder_asked_question: "[Batch 3] Funder asked question",
  funder_requested_evidence: "[Batch 3] Funder requested evidence",
  funder_marked_interested_or_declined: "[Batch 3] Funder marked interest",
  funder_submitted_outcome: "[Batch 3] Funder submitted outcome",
  funder_uploaded_document: "[Batch 3] Funder uploaded document",
  api_usage_unusual_placeholder: "[Batch 3] API usage placeholder (future)",
  request_overdue: "[Batch 3] Request overdue",
};

/**
 * Derive notification intents (zero, one external, one internal) for a
 * Batch 3 lifecycle event. Output is pure data — no I/O.
 */
export function deriveNotifications(input: P5B3NotificationInput): P5B3NotificationIntent[] {
  const out: P5B3NotificationIntent[] = [];
  const refs = {
    grant_id: input.grant_id,
    request_id: input.request_id,
    outcome_id: input.outcome_id,
    org_id: input.org_id,
    transaction_reference: input.transaction_reference,
    evidence_pack_version: input.evidence_pack_version,
  };
  const keyParts = [
    input.grant_id,
    input.request_id,
    input.outcome_id,
    input.org_id,
    input.transaction_reference,
    input.evidence_pack_version,
    input.occurrence_token,
  ];

  // External (funder-visible) intent
  if (!EXTERNAL_DISABLED.has(input.trigger)) {
    const tpl = EXTERNAL_TEMPLATES[input.trigger];
    if (tpl) {
      const { subject, body } = tpl(input);
      const intent: P5B3NotificationIntent = {
        trigger: input.trigger,
        audience: "external_funder",
        idempotency_key: deriveIdempotencyKey(input.trigger, "external_funder", keyParts),
        subject,
        body_lines: body,
        refs,
      };
      assertExternalSafe(intent);
      out.push(intent);
    }
  }

  // Internal (admin) intent — always emitted
  out.push({
    trigger: input.trigger,
    audience: "internal_admin",
    idempotency_key: deriveIdempotencyKey(input.trigger, "internal_admin", keyParts),
    subject: INTERNAL_SUBJECTS[input.trigger],
    body_lines: [
      `Trigger: ${input.trigger}`,
      input.transaction_reference ? `Transaction: ${input.transaction_reference}` : "",
      input.evidence_pack_version ? `Pack version: ${input.evidence_pack_version}` : "",
      input.internal_context ? `Context: ${input.internal_context}` : "",
    ].filter(Boolean),
    refs,
  });

  return out;
}
