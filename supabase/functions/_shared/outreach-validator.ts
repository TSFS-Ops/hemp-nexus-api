/**
 * Phase 5 — server-side first-outreach content validator.
 *
 * Reused at:
 *   - draft send-confirmation time inside ai-outreach-draft-v2-decision
 *     (action='approve' and action='mark_sent_by_human')
 *
 * Only applies when `is_first_outreach === true`. Later (non-first) outreach
 * is not blocked by this validator.
 *
 * Returns an array of category strings that failed. An empty array means
 * the content is acceptable for first outreach. The categories are stable
 * and safe to surface in the UI — they describe the failure class, never
 * the offending value.
 */

export const FORBIDDEN_CATEGORIES = [
  "buyer_identity",
  "seller_identity",
  "price",
  "volume",
  "bank_details",
  "documents",
  "personal_phone",
  "exact_location",
  "confidential_notes",
  "internal_strategy",
  "ai_confidence_score",
  "unapproved_risk_comments",
  "sensitive_commercial",
] as const;

export type ForbiddenCategory = (typeof FORBIDDEN_CATEGORIES)[number];

/**
 * Patterns intentionally conservative. The goal is to catch the obvious
 * leak vectors at send time — not to be a perfect NLP filter.
 */
const PATTERNS: Array<{ category: ForbiddenCategory; re: RegExp }> = [
  // Buyer/seller identity (explicit labels — counterparty names live in
  // structured columns, never in the body text for first outreach)
  { category: "buyer_identity", re: /\b(buyer\s+name|buyer\s+is|on behalf of buyer|buyer\s*:)/i },
  { category: "seller_identity", re: /\b(seller\s+name|seller\s+is|on behalf of seller|seller\s*:)/i },

  // Price / volume — numbers in commercial context
  { category: "price", re: /(\$|€|£|R\s*)\s?\d[\d,]*(?:\.\d+)?\s*(?:\/|per)?\s*(?:mt|tonne|ton|kg|bbl|barrel|unit)?/i },
  { category: "price", re: /\b(price|priced at|usd|zar|eur|gbp)\b[^.\n]{0,40}\b\d/i },
  { category: "volume", re: /\b\d[\d,]*(?:\.\d+)?\s*(mt|metric tons?|tonnes?|tons?|kg|kilograms?|bbl|barrels?)\b/i },
  { category: "volume", re: /\b(volume|quantity|qty)\b[^.\n]{0,40}\b\d/i },

  // Bank details
  { category: "bank_details", re: /\b(iban|swift|bic|sort code|routing( number)?|account\s*(no|number|#))\b/i },
  { category: "bank_details", re: /\b(bank\s+(account|details|name)|wire\s+(transfer|instructions))\b/i },

  // Documents / attachments
  { category: "documents", re: /\b(attached|attachment|see attached|please find attached|enclosed|invoice|bill of lading|b\/l|coa|spa|loi|icpo|fco|proof of (funds|product))\b/i },

  // Personal phone (any phone-shaped number)
  { category: "personal_phone", re: /(?:\+\d[\d\s().-]{7,}\d|\b0\d[\d\s().-]{7,}\d)/ },

  // Exact warehouse / location
  { category: "exact_location", re: /\b(warehouse|depot|terminal|berth|silo|tank farm)\s*(no\.?|#|number)?\s*[\w-]+/i },
  { category: "exact_location", re: /\b\d{1,5}\s+[A-Z][a-zA-Z]+\s+(street|st\.?|road|rd\.?|avenue|ave\.?|lane|drive|way)\b/i },

  // Confidential notes / internal strategy
  { category: "confidential_notes", re: /\b(confidential|internal\s+(note|only|memo)|do\s+not\s+share)\b/i },
  { category: "internal_strategy", re: /\b(our\s+strategy|negotiation\s+(position|range)|reserve\s+price|walk[- ]away)\b/i },

  // AI confidence / unapproved risk commentary
  { category: "ai_confidence_score", re: /\b(ai\s+confidence|confidence\s+score|model\s+confidence|fit\s+score)\b/i },
  { category: "ai_confidence_score", re: /\b\d{1,3}\s*%?\s*(confidence|match\s+score|fit)\b/i },
  { category: "unapproved_risk_comments", re: /\b(risk\s+(flag|score|rating)|sanction(ed|s)?|pep|adverse\s+media|kyb\s+(fail|pass|status)|wad\s+(ready|status)|bank[- ]?verified|verified|cleared)\b/i },

  // Sensitive commercial
  { category: "sensitive_commercial", re: /\b(incoterms?|fob|cif|cfr|exw|ddp|letter of credit|lc\b|advance payment|deposit\s+\d)/i },
  { category: "sensitive_commercial", re: /\{\{?\s*(price|volume|amount|qty|quantity|buyer|seller|bank|iban|swift)\b[^}]*\}\}?/i }, // unfilled placeholders
];

export function validateFirstOutreach(subject: string, body: string): ForbiddenCategory[] {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const hits = new Set<ForbiddenCategory>();
  for (const { category, re } of PATTERNS) {
    if (re.test(text)) hits.add(category);
  }
  return Array.from(hits);
}

export const APPROVED_OUTCOMES = [
  "no_response",
  "bounced",
  "interested",
  "not_interested",
  "wrong_contact",
  "call_booked",
  "onboarded",
  "converted_to_match",
  "converted_to_POI",
  "closed",
] as const;

export type ApprovedOutcome = (typeof APPROVED_OUTCOMES)[number];

export function isApprovedOutcome(v: unknown): v is ApprovedOutcome {
  return typeof v === "string" && (APPROVED_OUTCOMES as readonly string[]).includes(v);
}

export const SEND_CONFIRMATION_TEXT =
  "I confirm this outreach has been reviewed and contains no sensitive commercial, verification, bank, price, volume, document or personal-phone information.";
