/**
 * Admin Export Controls Batch 6 — Legal-Hold Context Auto-Detection.
 *
 * Read-only helper that determines whether a Governance Record export
 * request touches material currently under legal hold, and returns a
 * SAFE summary suitable for storage in `export_requests.verification`
 * and for surfacing in HQ list/audit views.
 *
 * Source of truth: `public.legal_holds` (status='active').
 *
 * Anchor: per project memory, a Governance Record is anchored to
 * `match_id`. Detection therefore walks the relationships rooted at
 * the match:
 *
 *   confirmed paths (implemented):
 *     - match              → legal_holds.scope_type='match',     scope_id=match_id
 *     - buyer_org          → legal_holds.scope_type='org',       scope_id=matches.buyer_org_id
 *     - seller_org         → legal_holds.scope_type='org',       scope_id=matches.seller_org_id
 *     - target_org         → legal_holds.scope_type='org',       scope_id=request.target_org_id (if supplied)
 *     - dispute(s)         → legal_holds.scope_type='dispute',   scope_id IN (disputes.id WHERE match_id=match_id)
 *     - poi_engagement(s)  → legal_holds.scope_type='engagement',scope_id IN (poi_engagements.id WHERE match_id=match_id)
 *
 *   deliberately DEFERRED (not enough confirmed mapping yet):
 *     - per-document holds       (scope_type='evidence' on match_documents.id)
 *     - per-evidence-row holds   (scope_type='evidence' on match_evidence.id)
 *     - poi-record holds         (scope_type='poi' — current schema scopes
 *                                 POIs through poi_engagements which is
 *                                 already covered as 'engagement')
 *     - user-scope holds         (no stable user→governance-record path
 *                                 outside the requester themselves)
 *
 * The helper NEVER:
 *   - mutates legal_holds
 *   - returns `reason`
 *   - returns `metadata`
 *   - returns `released_reason`
 *   - returns `applied_by` / `released_by`
 *   - reads or returns document/evidence payloads
 *   - hits external services
 *
 * The helper ALWAYS:
 *   - runs as service_role (caller responsibility)
 *   - returns has_legal_hold = false if any sub-query errors (FAIL-OPEN
 *     for visibility ONLY — detection is informational and additive;
 *     it must never block a request/approval that previously worked).
 *     Errors are surfaced in `detection_errors[]` so the caller can
 *     decide whether to record a partial-detection audit.
 */

// deno-lint-ignore-file no-explicit-any

export const LEGAL_HOLD_DETECTION_VERSION = "batch-6.v1";

export const LEGAL_HOLD_DETECTION_CONFIRMED_PATHS = [
  "match",
  "buyer_org",
  "seller_org",
  "target_org",
  "dispute",
  "engagement",
] as const;

export const LEGAL_HOLD_DETECTION_DEFERRED_PATHS = [
  "match_document_evidence",
  "match_evidence_row",
  "poi_record",
  "user_scope",
] as const;

export type LegalHoldDetectedScope =
  (typeof LEGAL_HOLD_DETECTION_CONFIRMED_PATHS)[number];

export interface SafeLegalHoldScopeHit {
  /** Source relationship — never the scope_id of the hold itself. */
  source: LegalHoldDetectedScope;
  /** Hold scope_type as stored on `legal_holds`. Non-sensitive. */
  scope_type: string;
  /** Hold UUID — reference only. No reason/metadata follows it. */
  legal_hold_id: string;
}

export interface SafeDetectedLegalHoldContext {
  has_legal_hold: boolean;
  hold_count: number;
  /** Distinct sources implicated, e.g. ["match","seller_org"]. */
  hold_sources: LegalHoldDetectedScope[];
  /** First/primary source used to render the "scope" badge in HQ list. */
  primary_scope: LegalHoldDetectedScope | null;
  /** Detection metadata. */
  detected_at: string;
  detection_source: "auto";
  detection_version: typeof LEGAL_HOLD_DETECTION_VERSION;
  confirmed_paths: ReadonlyArray<typeof LEGAL_HOLD_DETECTION_CONFIRMED_PATHS[number]>;
  deferred_paths: ReadonlyArray<typeof LEGAL_HOLD_DETECTION_DEFERRED_PATHS[number]>;
  /** Reference-only hits. Never includes reason / metadata. */
  hits: SafeLegalHoldScopeHit[];
  /** Soft errors during detection (informational). */
  detection_errors: string[];
}

export interface DetectLegalHoldContextOptions {
  /** Optional explicit target org from the export request body. */
  targetOrgId?: string | null;
}

const EMPTY = (): SafeDetectedLegalHoldContext => ({
  has_legal_hold: false,
  hold_count: 0,
  hold_sources: [],
  primary_scope: null,
  detected_at: new Date().toISOString(),
  detection_source: "auto",
  detection_version: LEGAL_HOLD_DETECTION_VERSION,
  confirmed_paths: LEGAL_HOLD_DETECTION_CONFIRMED_PATHS,
  deferred_paths: LEGAL_HOLD_DETECTION_DEFERRED_PATHS,
  hits: [],
  detection_errors: [],
});

/** Strip ALL sensitive fields from a legal_holds row. */
function safeHit(
  row: { id: string; scope_type: string },
  source: LegalHoldDetectedScope,
): SafeLegalHoldScopeHit {
  return {
    source,
    scope_type: row.scope_type,
    legal_hold_id: row.id,
  };
}

/**
 * Detect legal-hold context for a Governance Record (match-anchored).
 *
 * Returns the SAFE summary only. Caller stores under
 * `export_requests.verification.legal_hold_context_detected`.
 */
export async function detectGovernanceRecordLegalHold(
  admin: any,
  governanceRecordId: string,
  opts: DetectLegalHoldContextOptions = {},
): Promise<SafeDetectedLegalHoldContext> {
  const result = EMPTY();
  if (!governanceRecordId) {
    result.detection_errors.push("missing_governance_record_id");
    return result;
  }

  // ---- (1) Resolve buyer/seller org via the match itself. ----
  let buyerOrgId: string | null = null;
  let sellerOrgId: string | null = null;
  try {
    const { data: match, error } = await admin
      .from("matches")
      .select("id, buyer_org_id, seller_org_id")
      .eq("id", governanceRecordId)
      .maybeSingle();
    if (error) {
      result.detection_errors.push(`match_lookup_failed:${error.message}`);
    } else if (match) {
      buyerOrgId = (match.buyer_org_id as string | null) ?? null;
      sellerOrgId = (match.seller_org_id as string | null) ?? null;
    }
  } catch (e) {
    result.detection_errors.push(
      `match_lookup_threw:${(e as Error)?.message ?? String(e)}`,
    );
  }

  // ---- (2) Disputes related to the match. ----
  const disputeIds: string[] = [];
  try {
    const { data, error } = await admin
      .from("disputes")
      .select("id")
      .eq("match_id", governanceRecordId);
    if (error) {
      result.detection_errors.push(`disputes_lookup_failed:${error.message}`);
    } else if (Array.isArray(data)) {
      for (const r of data) if (r?.id) disputeIds.push(r.id as string);
    }
  } catch (e) {
    result.detection_errors.push(
      `disputes_lookup_threw:${(e as Error)?.message ?? String(e)}`,
    );
  }

  // ---- (3) POI engagements related to the match. ----
  const engagementIds: string[] = [];
  try {
    const { data, error } = await admin
      .from("poi_engagements")
      .select("id")
      .eq("match_id", governanceRecordId);
    if (error) {
      result.detection_errors.push(
        `engagements_lookup_failed:${error.message}`,
      );
    } else if (Array.isArray(data)) {
      for (const r of data) if (r?.id) engagementIds.push(r.id as string);
    }
  } catch (e) {
    result.detection_errors.push(
      `engagements_lookup_threw:${(e as Error)?.message ?? String(e)}`,
    );
  }

  // ---- (4) Resolve active holds across all confirmed scopes in one query. ----
  // Build (scope_type, scope_id) tuples we care about.
  type Probe = { scope_type: string; scope_id: string; source: LegalHoldDetectedScope };
  const probes: Probe[] = [
    { scope_type: "match", scope_id: governanceRecordId, source: "match" },
  ];
  if (buyerOrgId) probes.push({ scope_type: "org", scope_id: buyerOrgId, source: "buyer_org" });
  if (sellerOrgId && sellerOrgId !== buyerOrgId) {
    probes.push({ scope_type: "org", scope_id: sellerOrgId, source: "seller_org" });
  }
  if (opts.targetOrgId && opts.targetOrgId !== buyerOrgId && opts.targetOrgId !== sellerOrgId) {
    probes.push({ scope_type: "org", scope_id: opts.targetOrgId, source: "target_org" });
  }
  for (const id of disputeIds) {
    probes.push({ scope_type: "dispute", scope_id: id, source: "dispute" });
  }
  for (const id of engagementIds) {
    probes.push({ scope_type: "engagement", scope_id: id, source: "engagement" });
  }

  // Map (scope_type, scope_id) -> source for hit attribution.
  const probeIndex = new Map<string, LegalHoldDetectedScope>();
  for (const p of probes) {
    probeIndex.set(`${p.scope_type}::${p.scope_id}`, p.source);
  }
  const scopeIds = Array.from(new Set(probes.map((p) => p.scope_id)));
  const scopeTypes = Array.from(new Set(probes.map((p) => p.scope_type)));

  if (scopeIds.length === 0) return result;

  try {
    // We deliberately fetch ONLY non-sensitive columns. No `reason`,
    // no `metadata`, no `released_*`, no `applied_by`.
    const { data, error } = await admin
      .from("legal_holds")
      .select("id, scope_type, scope_id")
      .eq("status", "active")
      .in("scope_type", scopeTypes)
      .in("scope_id", scopeIds);
    if (error) {
      result.detection_errors.push(`legal_holds_query_failed:${error.message}`);
      return result;
    }
    const rows = (data ?? []) as Array<{
      id: string;
      scope_type: string;
      scope_id: string;
    }>;
    for (const row of rows) {
      const source = probeIndex.get(`${row.scope_type}::${row.scope_id}`);
      if (!source) continue; // unrelated hit (shouldn't happen given .in filters)
      result.hits.push(safeHit(row, source));
    }
  } catch (e) {
    result.detection_errors.push(
      `legal_holds_query_threw:${(e as Error)?.message ?? String(e)}`,
    );
    return result;
  }

  result.hold_count = result.hits.length;
  result.has_legal_hold = result.hold_count > 0;
  const sources = new Set<LegalHoldDetectedScope>();
  for (const h of result.hits) sources.add(h.source);
  result.hold_sources = Array.from(sources);
  // Stable primary scope ordering — narrowest first.
  const order: LegalHoldDetectedScope[] = [
    "match",
    "dispute",
    "engagement",
    "buyer_org",
    "seller_org",
    "target_org",
  ];
  result.primary_scope =
    order.find((s) => sources.has(s)) ?? result.hold_sources[0] ?? null;

  return result;
}

/**
 * Sanitise operator-provided legal_hold_context: keep only safe fields,
 * drop any free-text reason / metadata / notes / sensitive blobs.
 */
export function sanitiseOperatorLegalHoldContext(
  input: unknown,
): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const src = input as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (typeof src.hold_id === "string") safe.hold_id = src.hold_id;
  if (typeof src.scope === "string") safe.scope = src.scope;
  // NOTE: operator `reason` is intentionally NOT copied through to the
  // stored sanitised context. Free-text legal-hold reasons must not be
  // persisted on export_requests beyond the originating audit.
  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Diff helper used by the approval path to record whether detected
 * context changed since the request was filed. Returns null when
 * nothing meaningful changed.
 */
export function diffDetectedLegalHoldContext(
  before: SafeDetectedLegalHoldContext | null | undefined,
  after: SafeDetectedLegalHoldContext,
): { changed: boolean; before_count: number; after_count: number; before_sources: string[]; after_sources: string[] } {
  const b = before ?? EMPTY();
  const beforeSources = [...(b.hold_sources ?? [])].sort();
  const afterSources = [...after.hold_sources].sort();
  const changed =
    b.has_legal_hold !== after.has_legal_hold ||
    b.hold_count !== after.hold_count ||
    JSON.stringify(beforeSources) !== JSON.stringify(afterSources);
  return {
    changed,
    before_count: b.hold_count,
    after_count: after.hold_count,
    before_sources: beforeSources,
    after_sources: afterSources,
  };
}
