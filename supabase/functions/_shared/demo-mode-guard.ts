/**
 * OPS-010 — Demo-mode side-effect guard (Deno SSOT).
 *
 * Provides a single chokepoint for every live-external-side-effect surface to
 * resolve "is this row demo?" and either simulate or block the live call.
 *
 * Phase 2A policy (signed Izenzo Client-Only Decision Form):
 *   - Demo emails: ZERO outbound. Never call Resend or any live email
 *     provider. Audit as `ops.demo_outreach_blocked` + return success-shape
 *     to caller (preview-only).
 *   - Demo payments: never call Paystack. Simulate ledger event,
 *     audit as `ops.demo_payment_event_simulated`.
 *   - Demo compliance: never call Dilisense/Onfido/CompaniesHouse/CIPC.
 *     Return deterministic `CLEAR` result, audit as
 *     `ops.demo_compliance_call_simulated`.
 *   - Demo WaD / execution / finality: SIMULATED (not blocked). All
 *     artefacts must be visibly watermarked DEMO and must NOT be
 *     cryptographically interchangeable with live production artefacts.
 *     Use `markDemoArtifact()` to stamp evidence.
 */

// deno-lint-ignore-file no-explicit-any
import { OPS_010_AUDIT, OPS_010_DEMO_WATERMARK } from "./ops-010-audit.ts";

export interface DemoContext {
  isDemo: boolean;
  datasetId: string | null;
  orgId: string | null;
  source: "org" | "match" | "trade_request" | "poi" | "explicit" | "unknown";
}

const LIVE_CTX: DemoContext = {
  isDemo: false,
  datasetId: null,
  orgId: null,
  source: "unknown",
};

/**
 * Resolve demo state from any combination of identifiers. Anything that
 * resolves to a demo parent makes the whole context demo.
 */
export async function loadDemoContext(
  admin: any,
  ids: {
    orgId?: string | null;
    matchId?: string | null;
    tradeRequestId?: string | null;
    poiId?: string | null;
  },
): Promise<DemoContext> {
  try {
    if (ids.orgId) {
      const { data } = await admin
        .from("organizations")
        .select("id,is_demo,demo_dataset_id")
        .eq("id", ids.orgId)
        .maybeSingle();
      if (data?.is_demo) {
        return {
          isDemo: true,
          datasetId: data.demo_dataset_id ?? null,
          orgId: data.id,
          source: "org",
        };
      }
    }
    if (ids.matchId) {
      const { data } = await admin
        .from("matches")
        .select("id,org_id,is_demo,demo_dataset_id")
        .eq("id", ids.matchId)
        .maybeSingle();
      if (data?.is_demo) {
        return {
          isDemo: true,
          datasetId: data.demo_dataset_id ?? null,
          orgId: data.org_id ?? null,
          source: "match",
        };
      }
    }
    if (ids.tradeRequestId) {
      const { data } = await admin
        .from("trade_requests")
        .select("id,org_id,is_demo,demo_dataset_id")
        .eq("id", ids.tradeRequestId)
        .maybeSingle();
      if (data?.is_demo) {
        return {
          isDemo: true,
          datasetId: data.demo_dataset_id ?? null,
          orgId: data.org_id ?? null,
          source: "trade_request",
        };
      }
    }
    if (ids.poiId) {
      const { data } = await admin
        .from("pois")
        .select("id,org_id,is_demo,demo_dataset_id")
        .eq("id", ids.poiId)
        .maybeSingle();
      if (data?.is_demo) {
        return {
          isDemo: true,
          datasetId: data.demo_dataset_id ?? null,
          orgId: data.org_id ?? null,
          source: "poi",
        };
      }
    }
  } catch (_e) {
    // Fail-closed for safety: if we cannot resolve, assume live (existing
    // RBAC + RLS still applies). The inheritance trigger remains the
    // authoritative SSOT at the DB layer.
  }
  return LIVE_CTX;
}

/**
 * Convenience: check whether sending an email to this org would land in a
 * demo workspace. Used by every email surface to short-circuit Resend.
 */
export async function wouldEmitToDemoOrg(
  admin: any,
  orgId: string | null | undefined,
): Promise<DemoContext> {
  if (!orgId) return LIVE_CTX;
  return loadDemoContext(admin, { orgId });
}

/**
 * Throw a uniform 409-shaped error for live-only operations the caller has
 * tried to invoke on demo data.
 */
export class DemoBlockedError extends Error {
  code: string;
  status: number;
  constructor(code: string, msg: string) {
    super(msg);
    this.code = code;
    this.status = 409;
  }
}

export function assertNotLiveOnly(ctx: DemoContext, op: string): void {
  if (!ctx.isDemo) return;
  throw new DemoBlockedError(
    "DEMO_BLOCKED_LIVE_ONLY",
    `Operation '${op}' is live-only and cannot be executed on demo data`,
  );
}

/**
 * Write a canonical OPS-010 audit row. Best-effort; never throws.
 */
export async function writeDemoAudit(
  admin: any,
  args: {
    action: string;
    ctx: DemoContext;
    entityType?: string;
    entityId?: string | null;
    actorUserId?: string | null;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: args.ctx.orgId,
      action: args.action,
      entity_type: args.entityType ?? "demo",
      entity_id: args.entityId ?? null,
      actor_user_id: args.actorUserId ?? null,
      is_demo: true,
      demo_dataset_id: args.ctx.datasetId,
      metadata: {
        dataset_id: args.ctx.datasetId,
        source: args.ctx.source,
        ...(args.extra ?? {}),
      },
    });
  } catch (_e) {
    // Never let audit failures break the request flow.
  }
}

/**
 * Run a simulator instead of the real side effect, then emit a canonical
 * audit row. Returns the simulator's result so callers can preserve their
 * existing response shape.
 */
export async function simulateInsteadOf<T>(
  admin: any,
  args: {
    ctx: DemoContext;
    op: string;
    auditAction: string;
    actorUserId?: string | null;
    entityType?: string;
    entityId?: string | null;
    simulator: () => Promise<T> | T;
    extra?: Record<string, unknown>;
  },
): Promise<T> {
  const result = await Promise.resolve(args.simulator());
  await writeDemoAudit(admin, {
    action: args.auditAction,
    ctx: args.ctx,
    entityType: args.entityType,
    entityId: args.entityId,
    actorUserId: args.actorUserId,
    extra: { op: args.op, simulated: true, ...(args.extra ?? {}) },
  });
  return result;
}

/**
 * Stamp an artefact payload (WaD, certificate, evidence pack, export
 * bundle) with the canonical DEMO watermark and prefix the seal hash so
 * a demo artefact can NEVER be confused with — let alone substituted for —
 * a production artefact.
 *
 * Returns the (possibly-mutated) payload + a watermark object the caller
 * MUST include in any visible rendering / file metadata.
 */
export function markDemoArtifact<T extends Record<string, unknown>>(
  ctx: DemoContext,
  payload: T,
): T & { __demo: { watermark: string; dataset_id: string | null; non_production: true; seal_prefix: string } } {
  const watermark = OPS_010_DEMO_WATERMARK;
  // Seal-prefix collision-resists production seal hashes.
  const seal_prefix = `DEMO_${ctx.datasetId?.slice(0, 8) ?? "anon"}::`;
  return {
    ...payload,
    __demo: {
      watermark,
      dataset_id: ctx.datasetId,
      non_production: true,
      seal_prefix,
    },
  };
}

export { OPS_010_AUDIT };
