/**
 * Facilitation Batch 12 — Admin Notification Template Editor SSOT (browser).
 *
 * Browser mirror of supabase/functions/_shared/facilitation-template-editor.ts.
 * Both files are pinned by scripts/check-facilitation-template-editor-contract.mjs.
 *
 * NO send path. NO approval. The requester-safe notification trigger
 * catalogue stays code-controlled in @/lib/facilitation-case-state.
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

export const TEMPLATE_PREVIEW_SAMPLE: Readonly<Record<string, string>> = Object.freeze({
  case_reference: "FAC-SAMPLE-0001",
  requester_org_name: "Sample Requester Pty Ltd",
  counterparty_org_name: "Sample Counterparty Ltd",
  contact_name: "Sample Contact",
  commodity: "Sample Commodity",
  jurisdiction_origin: "ZA",
  jurisdiction_destination: "GB",
});

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

export function renderPreview(template: string, sample = TEMPLATE_PREVIEW_SAMPLE): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = sample[key];
    return typeof v === "string" ? v : `{{${key}}}`;
  });
}

export function isEditableStatus(status: string): status is "draft" {
  return status === "draft";
}
