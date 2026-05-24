/**
 * OPS-010 — Generic entry-level demo short-circuit.
 *
 * Surfaces that perform live external side effects (payment provider calls,
 * sanctions/IDV/UBO provider calls, outbound webhook delivery, finality
 * artefact production, exports) call `demoShortCircuit()` immediately after
 * authentication / body parsing. If any referenced parent row is flagged
 * `is_demo=true`, this returns a 202-shaped simulated response, emits the
 * canonical OPS-010 audit, and prevents the live call from ever executing.
 *
 * For artefact surfaces (WaD, p3-WaD, collapse, deal-certificate,
 * evidence-pack, export-prepare/download) the response payload is stamped
 * with `markDemoArtifact()` so demo artefacts can never be confused with —
 * or substituted for — production artefacts.
 */

// deno-lint-ignore-file no-explicit-any
import {
  DemoContext,
  loadDemoContext,
  markDemoArtifact,
  writeDemoAudit,
} from "./demo-mode-guard.ts";
import { OPS_010_AUDIT } from "./ops-010-audit.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

export interface DemoShortCircuitArgs {
  /** Best-effort identifier extraction from request body / query params. */
  ids: {
    orgId?: string | null;
    matchId?: string | null;
    tradeRequestId?: string | null;
    poiId?: string | null;
  };
  /** Canonical OPS-010 audit name (defaults to SIDE_EFFECT_SUPPRESSED). */
  auditAction?: string;
  /** Function name, used for audit metadata. */
  op: string;
  /** When true, the simulated payload is marked DEMO artefact. */
  artefact?: boolean;
  /** Optional actor user id for audit attribution. */
  actorUserId?: string | null;
}

/**
 * Returns a `Response` if the request targets demo data (caller MUST
 * return it immediately). Returns `null` for live requests (caller
 * proceeds with normal live flow).
 */
export async function demoShortCircuit(
  admin: any,
  args: DemoShortCircuitArgs,
): Promise<Response | null> {
  const ctx = await loadDemoContext(admin, args.ids);
  if (!ctx.isDemo) return null;

  const auditAction = args.auditAction ?? OPS_010_AUDIT.SIDE_EFFECT_SUPPRESSED;

  await writeDemoAudit(admin, {
    action: auditAction,
    ctx,
    actorUserId: args.actorUserId ?? null,
    entityType: "demo",
    extra: { op: args.op, simulated: true, suppressed_live_call: true },
  });

  const base = {
    ok: true,
    simulated: true,
    op: args.op,
    demo: true,
    dataset_id: ctx.datasetId,
    message:
      "OPS-010: demo data — live external call suppressed, simulated response returned.",
  };
  const payload = args.artefact ? markDemoArtifact(ctx, base) : base;

  return new Response(JSON.stringify(payload), {
    status: 202,
    headers: CORS,
  });
}

/**
 * Helper: pull common identifier shapes out of a (possibly-untyped) body.
 * Safe to pass `null`/`undefined`.
 */
export function extractDemoIds(body: any, url?: URL): DemoShortCircuitArgs["ids"] {
  const b = body ?? {};
  const u = url ?? null;
  const fromUrl = (k: string) => (u ? u.searchParams.get(k) : null);
  return {
    orgId: b.org_id ?? b.organization_id ?? b.organisation_id ?? fromUrl("org_id"),
    matchId: b.match_id ?? b.matchId ?? fromUrl("match_id"),
    tradeRequestId:
      b.trade_request_id ?? b.tradeRequestId ?? fromUrl("trade_request_id"),
    poiId: b.poi_id ?? b.poiId ?? fromUrl("poi_id"),
  };
}

export { type DemoContext, markDemoArtifact };
