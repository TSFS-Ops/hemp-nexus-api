/**
 * Registry ↔ Counterparty unification — SSOT helpers.
 *
 * Purpose: when a user searches for counterparties from the Trade Desk,
 * we want one unified experience that ALSO surfaces and refines the
 * Business Registry. This SSOT defines:
 *
 *   - The link-state taxonomy between a counterparty hit and a registry hit.
 *   - The conservative name+country matching helper used to suggest
 *     candidate links (never to auto-link).
 *   - Canonical safe copy for each link state.
 *
 * Rules baked in:
 *   - Suggestions only — humans confirm every link via the existing
 *     `/registry/company/:id/claim` flow.
 *   - Name normalisation strips common legal-form suffixes so e.g.
 *     "Acme Trading (Pty) Ltd" matches "Acme Trading Ltd" loosely.
 *   - No raw bank or contact information is ever returned by this layer;
 *     it operates purely on names/countries/IDs already on screen.
 */

export const REGISTRY_COUNTERPARTY_LINK_STATES = [
  "linked",            // Counterparty record explicitly bound to a registry record.
  "candidate_match",   // Strong name+country match; awaiting human confirmation.
  "registry_only",     // Registry hit with no matching counterparty in scope.
  "counterparty_only", // Counterparty hit with no matching registry record.
] as const;

export type RegistryCounterpartyLinkState =
  (typeof REGISTRY_COUNTERPARTY_LINK_STATES)[number];

export const LINK_STATE_COPY: Record<
  RegistryCounterpartyLinkState,
  { label: string; helper: string }
> = {
  linked: {
    label: "Linked to registry",
    helper: "This counterparty is bound to a registry record.",
  },
  candidate_match: {
    label: "Possible registry match — propose link",
    helper:
      "Name and country look like a match. A reviewer must confirm the link before it takes effect.",
  },
  registry_only: {
    label: "Registry record — not yet a counterparty",
    helper:
      "This company is in the registry but is not on your counterparty list yet.",
  },
  counterparty_only: {
    label: "Not yet in registry — propose registry record",
    helper:
      "This counterparty has no registry record. Submitting a request adds it to the admin queue for review.",
  },
};

/* ─────────────────────────── Name normalisation ─────────────────────── */

const LEGAL_SUFFIXES = [
  "pty ltd",
  "(pty) ltd",
  "proprietary limited",
  "limited",
  "ltd",
  "llc",
  "inc",
  "incorporated",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "s.a.",
  "bv",
  "b.v.",
  "co",
  "company",
  "corporation",
  "corp",
];

const STOP_PUNCT = /[.,'"`’“”()\[\]{}\\/!?:;|]/g;

/**
 * Normalise a company name for conservative matching.
 *  - Lower-case.
 *  - Strip punctuation.
 *  - Collapse whitespace.
 *  - Remove a trailing legal-form suffix (one pass — conservative).
 */
export function normalizeCompanyName(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.toLowerCase().replace(STOP_PUNCT, " ").replace(/\s+/g, " ").trim();
  // Strip a trailing legal suffix once, longest first.
  const sorted = [...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    const re = new RegExp(`(?:\\s|^)${suffix.replace(/[.()]/g, "\\$&")}$`);
    if (re.test(s)) {
      s = s.replace(re, "").trim();
      break;
    }
  }
  return s;
}

/* ─────────────────────────── Match helpers ──────────────────────────── */

export interface MatchableCounterparty {
  id: string;
  name: string;
  countryCode?: string | null;
  registrationNumber?: string | null;
  legalForm?: string | null;
}

export interface MatchableRegistry {
  id: string;
  name: string;
  countryCode?: string | null;
  registrationNumber?: string | null;
  legalForm?: string | null;
}

export interface MatchConfidenceBreakdown {
  nameSimilarity: number;
  registrationNumberMatch: "match" | "mismatch" | "missing";
  countryRule: "match" | "mismatch" | "missing";
  legalFormRule: "compatible" | "different" | "missing";
}

export interface LinkSuggestion {
  state: RegistryCounterpartyLinkState;
  counterparty?: MatchableCounterparty;
  registry?: MatchableRegistry;
  score?: number;
  breakdown?: MatchConfidenceBreakdown;
}

/**
 * Conservative matcher: same normalised name AND, when both sides
 * declare a country code, same country. Never auto-links — caller
 * surfaces results as `candidate_match` for human confirmation.
 */
export function isCandidateMatch(
  cp: MatchableCounterparty,
  reg: MatchableRegistry,
): boolean {
  return calculateMatchConfidence(cp, reg).score >= 80;
}

function tokenOverlapSimilarity(a: string, b: string): number {
  const left = new Set(normalizeCompanyName(a).split(" ").filter(Boolean));
  const right = new Set(normalizeCompanyName(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((x) => right.has(x)).length;
  const union = new Set([...left, ...right]).size;
  return Math.round((intersection / union) * 100);
}

export function calculateMatchConfidence(
  cp: MatchableCounterparty,
  reg: MatchableRegistry,
): { score: number; breakdown: MatchConfidenceBreakdown } {
  const nameSimilarity = tokenOverlapSimilarity(cp.name, reg.name);
  const cpReg = cp.registrationNumber?.trim().toLowerCase() || "";
  const regReg = reg.registrationNumber?.trim().toLowerCase() || "";
  const registrationNumberMatch = cpReg && regReg
    ? cpReg === regReg ? "match" : "mismatch"
    : "missing";
  const countryRule = cp.countryCode && reg.countryCode
    ? cp.countryCode.toUpperCase() === reg.countryCode.toUpperCase() ? "match" : "mismatch"
    : "missing";
  const legalFormRule = cp.legalForm && reg.legalForm
    ? normalizeCompanyName(cp.legalForm) === normalizeCompanyName(reg.legalForm) ? "compatible" : "different"
    : "missing";

  let score = Math.round(nameSimilarity * 0.62);
  score += registrationNumberMatch === "match" ? 24 : registrationNumberMatch === "mismatch" ? -18 : 0;
  score += countryRule === "match" ? 10 : countryRule === "mismatch" ? -20 : 0;
  score += legalFormRule === "compatible" ? 4 : legalFormRule === "different" ? -4 : 0;
  score = Math.max(0, Math.min(100, score));

  return { score, breakdown: { nameSimilarity, registrationNumberMatch, countryRule, legalFormRule } };
}

/**
 * Build the unified-register suggestion list for a given query result
 * set. Pure function — easy to unit-test.
 */
export function buildLinkSuggestions(
  counterparties: MatchableCounterparty[],
  registry: MatchableRegistry[],
): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const matchedRegistryIds = new Set<string>();
  for (const cp of counterparties) {
    const ranked = registry
      .map((r) => ({ registry: r, confidence: calculateMatchConfidence(cp, r) }))
      .sort((a, b) => b.confidence.score - a.confidence.score);
    const best = ranked.find((r) => r.confidence.score >= 80);
    const reg = best?.registry;
    if (reg) {
      matchedRegistryIds.add(reg.id);
      out.push({ state: "candidate_match", counterparty: cp, registry: reg, score: best.confidence.score, breakdown: best.confidence.breakdown });
    } else {
      out.push({ state: "counterparty_only", counterparty: cp });
    }
  }
  for (const reg of registry) {
    if (!matchedRegistryIds.has(reg.id)) {
      out.push({ state: "registry_only", registry: reg });
    }
  }
  return out;
}

/**
 * Build the "Propose link" URL: route the user through the existing
 * claim flow which is already review-gated and audited. The query
 * params are presentational pre-fill only — the server never trusts
 * them to bypass the claim review.
 */
export function buildProposeLinkUrl(
  registryId: string,
  counterpartyName: string,
): string {
  const params = new URLSearchParams({
    from_counterparty: counterpartyName,
    proposed: "1",
  });
  return `/registry/company/${registryId}/claim?${params.toString()}`;
}

/**
 * Build the "Propose registry record" URL: pre-fills the public
 * new-company-request form. Server-side validation still applies; the
 * request enters the admin queue and is never auto-approved.
 */
export function buildProposeRegistryRecordUrl(
  counterpartyName: string,
  countryCode?: string | null,
): string {
  const params = new URLSearchParams({
    name: counterpartyName,
    from_counterparty: "1",
  });
  if (countryCode) params.set("country", countryCode.toUpperCase());
  return `/registry/new-company-request?${params.toString()}`;
}
