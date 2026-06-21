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

const LEGAL_SUFFIXES = ["pty ltd", "(pty) ltd", "proprietary limited", "limited", "ltd", "llc", "inc", "incorporated", "plc", "gmbh", "ag", "sa", "s.a.", "bv", "b.v.", "co", "company", "corporation", "corp"];
const STOP_PUNCT = /[.,'"`’“”()\[\]{}\\/!?:;|]/g;

export function normalizeCompanyName(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.toLowerCase().replace(STOP_PUNCT, " ").replace(/\s+/g, " ").trim();
  for (const suffix of [...LEGAL_SUFFIXES].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?:\\s|^)${suffix.replace(/[.()]/g, "\\$&")}$`);
    if (re.test(s)) return s.replace(re, "").trim();
  }
  return s;
}

function tokenOverlapSimilarity(a: string, b: string): number {
  const left = new Set(normalizeCompanyName(a).split(" ").filter(Boolean));
  const right = new Set(normalizeCompanyName(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((x) => right.has(x)).length;
  const union = new Set([...left, ...right]).size;
  return Math.round((intersection / union) * 100);
}

export function calculateMatchConfidence(cp: MatchableCounterparty, reg: MatchableRegistry): { score: number; breakdown: MatchConfidenceBreakdown } {
  const nameSimilarity = tokenOverlapSimilarity(cp.name, reg.name);
  const cpReg = cp.registrationNumber?.trim().toLowerCase() || "";
  const regReg = reg.registrationNumber?.trim().toLowerCase() || "";
  const registrationNumberMatch = cpReg && regReg ? (cpReg === regReg ? "match" : "mismatch") : "missing";
  const countryRule = cp.countryCode && reg.countryCode ? (cp.countryCode.toUpperCase() === reg.countryCode.toUpperCase() ? "match" : "mismatch") : "missing";
  const legalFormRule = cp.legalForm && reg.legalForm ? (normalizeCompanyName(cp.legalForm) === normalizeCompanyName(reg.legalForm) ? "compatible" : "different") : "missing";
  let score = Math.round(nameSimilarity * 0.62);
  score += registrationNumberMatch === "match" ? 24 : registrationNumberMatch === "mismatch" ? -18 : 0;
  score += countryRule === "match" ? 10 : countryRule === "mismatch" ? -20 : 0;
  score += legalFormRule === "compatible" ? 4 : legalFormRule === "different" ? -4 : 0;
  return { score: Math.max(0, Math.min(100, score)), breakdown: { nameSimilarity, registrationNumberMatch, countryRule, legalFormRule } };
}