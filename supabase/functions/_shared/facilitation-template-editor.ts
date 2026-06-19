/**
 * Facilitation Batch 12 — Admin Notification Template Editor SSOT (server).
 *
 * Vocabulary + safety constants shared between:
 *   - supabase/functions/facilitation-template-editor/index.ts (handler)
 *   - src/lib/facilitation-template-editor.ts                  (browser mirror)
 *
 * NO send path. NO email/Slack/SMS/WhatsApp/webhook dispatch.
 * NO approval. NO POI/WaD/match/token/credit/payment/refund mutation.
 * NO requester-safe notification trigger editing — that catalogue stays
 * code-controlled in facilitation-case-state.ts.
 */

export const FACILITATION_TEMPLATE_EDITOR_ACTIONS = [
  "create_draft",
  "update_draft",
  "submit_for_approval",
] as const;
export type FacilitationTemplateEditorAction =
  (typeof FACILITATION_TEMPLATE_EDITOR_ACTIONS)[number];

export const FACILITATION_TEMPLATE_AUDIT_NAMES = [
  "facilitation_template.draft_created",
  "facilitation_template.draft_updated",
] as const;
export type FacilitationTemplateAuditName =
  (typeof FACILITATION_TEMPLATE_AUDIT_NAMES)[number];

/**
 * Fixed sample payload used for variable-substitution preview.
 * Preview is read-only and must NEVER trigger a real send.
 */
export const TEMPLATE_PREVIEW_SAMPLE: Readonly<Record<string, string>> = Object.freeze({
  case_reference: "FAC-SAMPLE-0001",
  requester_org_name: "Sample Requester Pty Ltd",
  counterparty_org_name: "Sample Counterparty Ltd",
  contact_name: "Sample Contact",
  commodity: "Sample Commodity",
  jurisdiction_origin: "ZA",
  jurisdiction_destination: "GB",
});

/**
 * Defence-in-depth: forbid obvious unsafe / smuggled markup in template bodies.
 * The outreach send path has its own checks; this is an editor-time guard so
 * authors get feedback before submitting for approval.
 */
const FORBIDDEN_BODY_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /<script[\s>]/i, label: "<script> tag" },
  { re: /\son[a-z]+\s*=/i, label: "inline event handler (onclick=, onerror=, …)" },
  { re: /javascript:/i, label: "javascript: URL" },
  { re: /data:text\/html/i, label: "data:text/html URL" },
  { re: /<iframe[\s>]/i, label: "<iframe> tag" },
];

export function findForbiddenBodyMatches(body: string | null | undefined): string[] {
  if (!body) return [];
  const hits: string[] = [];
  for (const { re, label } of FORBIDDEN_BODY_PATTERNS) {
    if (re.test(body)) hits.push(label);
  }
  return hits;
}

/**
 * Variable preview — replaces `{{var}}` tokens with the fixed sample payload.
 * Pure string function; no I/O.
 */
export function renderPreview(template: string, sample = TEMPLATE_PREVIEW_SAMPLE): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = sample[key];
    return typeof v === "string" ? v : `{{${key}}}`;
  });
}

export type EditableTemplateStatus = "draft";

export function isEditableStatus(status: string): status is EditableTemplateStatus {
  return status === "draft";
}

/** Used by the editor when submitting a draft for approval. */
export function submittedMarker(now = new Date(), userId: string) {
  return {
    submitted_for_approval_at: now.toISOString(),
    submitted_for_approval_by: userId,
  };
}
