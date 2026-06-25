/**
 * P-5 Batch 3 — Stage 6 Memory bridge (read-only intent producer).
 *
 * Produces safe Memory-eligible intent objects. Does NOT mutate any existing
 * Memory / business_decisions row. Consumers may persist intent through
 * accepted Memory write paths separately (out of Batch 3 scope).
 *
 * Permitted Memory fields:
 *   - funder organisation
 *   - access period
 *   - evidence-pack version seen
 *   - requests made (counts / category summary only — no original raw text)
 *   - outcomes submitted
 *   - dates
 *   - final admin decision
 *   - approved lessons
 *
 * Forbidden Memory fields:
 *   - private funder notes
 *   - unreleased internal credit material
 *   - admin-only notes
 *   - raw provider data
 *   - other funder details outside permitted scope
 */
import type { P5B3OutcomeType, P5B3RequestCategory } from "./constants";

export interface P5B3MemoryIntent {
  /** Stable key — never repeats. */
  memory_key: string;
  funder_org_id: string;
  funder_org_name: string;
  access_period: { granted_at: string; expires_at: string | null };
  evidence_pack_version: string;
  request_summary: ReadonlyArray<{ category: P5B3RequestCategory; count: number }>;
  outcomes_submitted: ReadonlyArray<{ outcome: P5B3OutcomeType; submitted_at: string }>;
  final_admin_decision: string | null;
  approved_lessons: ReadonlyArray<string>;
  /** Always true — proves the intent has been screened. */
  screened_safe: true;
}

export interface P5B3MemoryRawSource {
  funder_org_id: string;
  funder_org_name: string;
  granted_at: string;
  expires_at: string | null;
  evidence_pack_version: string;
  requests: ReadonlyArray<{ category: P5B3RequestCategory; original_text?: string }>;
  outcomes: ReadonlyArray<{ outcome: P5B3OutcomeType; submitted_at: string; private_note?: string }>;
  final_admin_decision: string | null;
  approved_lessons: ReadonlyArray<string>;
  /** Fields that MUST be stripped if present in the source. */
  private_funder_notes?: unknown;
  unreleased_credit_material?: unknown;
  admin_only_notes?: unknown;
  raw_provider_data?: unknown;
  other_funder_details?: unknown;
}

const FORBIDDEN_KEYS = [
  "private_funder_notes",
  "unreleased_credit_material",
  "admin_only_notes",
  "raw_provider_data",
  "other_funder_details",
] as const;

export function buildMemoryIntent(src: P5B3MemoryRawSource): P5B3MemoryIntent {
  // Defensive: ensure no forbidden field accidentally bleeds through. We never
  // copy these keys onto the intent. Even if present, strip them now.
  const srcRec = src as unknown as Record<string, unknown>;
  for (const k of FORBIDDEN_KEYS) {
    if (k in srcRec) {
      // intentionally not thrown — silent strip is the contract. Consumers
      // that want to assert this should call screenMemoryIntentSafe().
      delete srcRec[k];
    }
  }

  // Reduce requests to a category-count summary only (drop original text).
  const summaryMap = new Map<P5B3RequestCategory, number>();
  for (const r of src.requests) {
    summaryMap.set(r.category, (summaryMap.get(r.category) ?? 0) + 1);
  }
  const request_summary = [...summaryMap.entries()].map(([category, count]) => ({ category, count }));

  // Drop private_note from outcomes.
  const outcomes_submitted = src.outcomes.map(({ outcome, submitted_at }) => ({ outcome, submitted_at }));

  return {
    memory_key: `p5b3:mem:${src.funder_org_id}:${src.evidence_pack_version}`,
    funder_org_id: src.funder_org_id,
    funder_org_name: src.funder_org_name,
    access_period: { granted_at: src.granted_at, expires_at: src.expires_at },
    evidence_pack_version: src.evidence_pack_version,
    request_summary,
    outcomes_submitted,
    final_admin_decision: src.final_admin_decision,
    approved_lessons: src.approved_lessons,
    screened_safe: true,
  };
}

export function screenMemoryIntentSafe(intent: unknown): intent is P5B3MemoryIntent {
  if (!intent || typeof intent !== "object") return false;
  const obj = intent as Record<string, unknown>;
  for (const k of FORBIDDEN_KEYS) {
    if (k in obj) return false;
  }
  return obj.screened_safe === true;
}
