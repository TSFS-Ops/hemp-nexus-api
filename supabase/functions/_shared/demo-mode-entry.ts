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

import { corsHeaders as __buildCorsHeaders } from "./cors.ts";

/**
 * Build per-request CORS headers honouring the project ALLOWED_ORIGINS allowlist.
 * Falls back to safe no-echo headers when no Request is provided.
 */
function buildCors(req?: Request): Record<string, string> {
  const allowed = (globalThis as any).Deno?.env?.get?.("ALLOWED_ORIGINS") || "";
  const origin = req?.headers.get("origin") ?? null;
  return { ...__buildCorsHeaders(allowed, origin), "Content-Type": "application/json" };
}

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
  req?: Request,
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
    headers: buildCors(req),
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

/**
 * Convenience wrapper: clones the request (so the original body remains
 * readable by the caller), extracts identifiers from URL/JSON body, and
 * short-circuits if the target row is demo. Safe to call at the top of
 * any POST handler immediately after CORS handling.
 */
export async function tryDemoShortCircuit(
  admin: any,
  req: Request,
  opts: {
    op: string;
    artefact?: boolean;
    auditAction?: string;
    actorUserId?: string | null;
  },
): Promise<Response | null> {
  if (req.method === "OPTIONS" || req.method === "GET") return null;
  let ids: DemoShortCircuitArgs["ids"] = {};
  try {
    const url = new URL(req.url);
    let body: any = null;
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      const cloned = req.clone();
      const text = await cloned.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
    }
    ids = extractDemoIds(body, url);
  } catch {
    ids = {};
  }
  // No identifiers → cannot prove demo; let live flow proceed.
  if (!ids.orgId && !ids.matchId && !ids.tradeRequestId && !ids.poiId) {
    return null;
  }
  return demoShortCircuit(admin, {
    ids,
    op: opts.op,
    artefact: opts.artefact,
    auditAction: opts.auditAction,
    actorUserId: opts.actorUserId ?? null,
  });
}
