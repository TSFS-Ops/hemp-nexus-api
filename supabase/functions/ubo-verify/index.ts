import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { isBypassEnabled, recordBypassUsage, bypassEnvelope } from "../_shared/test-mode-bypass.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";

/**
 * OWN-001: UBO Ownership Verification
 *
 * POST: Verify UBO chain for a given entity sums to 100% (natural persons).
 *       Escalates if ownership chain exceeds 3 layers.
 *
 * GET:  Get current UBO verification status for an entity.
 */

interface OwnershipNode {
  entityId: string;
  entityType: string;
  legalName: string;
  ownershipPct: number;
  depth: number;
  children: OwnershipNode[];
  verified: boolean;
}

async function buildOwnershipTree(
  admin: ReturnType<typeof createClient>,
  companyEntityId: string,
  orgId: string,
  depth: number = 0,
  visited: Set<string> = new Set()
): Promise<{ nodes: OwnershipNode[]; totalPct: number; maxDepth: number; escalation: boolean }> {
  if (visited.has(companyEntityId)) {
    return { nodes: [], totalPct: 0, maxDepth: depth, escalation: false };
  }
  visited.add(companyEntityId);

  // Get direct UBO links for this company entity
  const { data: links } = await admin
    .from("ubo_links")
    .select("person_entity_id, ownership_percentage, status, verified_at")
    .eq("company_entity_id", companyEntityId)
    .eq("org_id", orgId);

  if (!links || links.length === 0) {
    return { nodes: [], totalPct: 0, maxDepth: depth, escalation: false };
  }

  let totalPct = 0;
  let maxDepth = depth;
  let escalation = depth >= 3;
  const nodes: OwnershipNode[] = [];

  for (const link of links) {
    // Get entity details
    const { data: entity } = await admin
      .from("entities")
      .select("id, entity_type, legal_name, status")
      .eq("id", link.person_entity_id)
      .maybeSingle();

    if (!entity) continue;

    const isVerified = link.status === "verified" && !!link.verified_at;

    if (entity.entity_type === "company" || entity.entity_type === "corporate") {
      // Recursive: this owner is itself a company - traverse deeper
      const sub = await buildOwnershipTree(admin, entity.id, orgId, depth + 1, visited);
      nodes.push({
        entityId: entity.id,
        entityType: entity.entity_type,
        legalName: entity.legal_name,
        ownershipPct: Number(link.ownership_percentage),
        depth: depth + 1,
        children: sub.nodes,
        verified: isVerified,
      });
      if (sub.maxDepth > maxDepth) maxDepth = sub.maxDepth;
      if (sub.escalation) escalation = true;
      // Weighted contribution: this company's total natural person ownership
      totalPct += Number(link.ownership_percentage) * (sub.totalPct / 100);
    } else {
      // Natural person - terminal node
      totalPct += Number(link.ownership_percentage);
      nodes.push({
        entityId: entity.id,
        entityType: entity.entity_type,
        legalName: entity.legal_name,
        ownershipPct: Number(link.ownership_percentage),
        depth: depth + 1,
        children: [],
        verified: isVerified,
      });
    }
  }

  return { nodes, totalPct, maxDepth, escalation };
}

Deno.serve(async (req: Request) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "ubo-verify", artefact: false });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation", 403);

    if (req.method === "POST") {
      assertIdempotencyKey(req);
      const body = await req.json();
      const { entity_id } = body;
      if (!entity_id) throw new ApiException("VALIDATION_ERROR", "entity_id required", 400);

      // Verify entity belongs to org
      const { data: entity } = await admin
        .from("entities")
        .select("id, entity_type, legal_name, status")
        .eq("id", entity_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

      if (entity.entity_type === "individual" || entity.entity_type === "natural_person") {
        return new Response(JSON.stringify({
          success: true,
          entity_id,
          entity_type: entity.entity_type,
          verification: "not_applicable",
          reason: "Individual entities do not require UBO verification",
          total_ownership_pct: 100,
          is_complete: true,
          escalation_required: false,
        }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      }

      // ── Test-mode bypass: report a complete, fully-verified ownership chain ──
      if (await isBypassEnabled(admin, "ubo", "ubo-verify")) {
        // Batch I Fix 1: stamp entity.metadata so a bypassed UBO-verified entity
        // is distinguishable from a real verification without joining audit logs.
        const bypassedAt = new Date().toISOString();
        const existingMeta = (entity.metadata as Record<string, unknown> | null) ?? {};
        const existingGates = Array.isArray((existingMeta as { bypass_gates?: unknown }).bypass_gates)
          ? ((existingMeta as { bypass_gates?: string[] }).bypass_gates as string[])
          : [];
        const nextGates = Array.from(new Set([...existingGates, "ubo"]));
        await admin.from("entities").update({
          status: "verified",
          metadata: {
            ...existingMeta,
            bypass: true,
            bypass_gates: nextGates,
            test_mode: true,
            last_bypass_at: bypassedAt,
            last_bypass_actor: authCtx.userId || null,
          },
        }).eq("id", entity_id);

        await recordBypassUsage(admin, {
          gate: "ubo",
          source: "ubo-verify",
          orgId,
          actorUserId: authCtx.userId || null,
          details: { entity_id, entity_type: entity.entity_type, legal_name: entity.legal_name },
        });

        return new Response(JSON.stringify(bypassEnvelope({
          success: true,
          entity_id,
          entity_type: entity.entity_type,
          legal_name: entity.legal_name,
          total_ownership_pct: 100,
          is_complete: true,
          all_verified: true,
          max_depth: 0,
          escalation_required: false,
          escalation_reason: null,
          ownership_tree: [],
        })), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      }

      const tree = await buildOwnershipTree(admin, entity_id, orgId);

      const isComplete = tree.totalPct >= 100;
      const allVerified = tree.nodes.length > 0 && tree.nodes.every(function checkVerified(n: OwnershipNode): boolean {
        return n.verified && n.children.every(checkVerified);
      });

      // Update entity status if fully verified
      if (isComplete && allVerified && entity.status !== "verified") {
        await admin.from("entities").update({ status: "verified" }).eq("id", entity_id);
      }

      // Audit log
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: authCtx.userId || null,
        action: "ubo.ownership.verified",
        entity_type: "entity",
        entity_id,
        metadata: {
          total_pct: tree.totalPct,
          max_depth: tree.maxDepth,
          escalation_required: tree.escalation,
          is_complete: isComplete,
          all_verified: allVerified,
          node_count: tree.nodes.length,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        entity_id,
        entity_type: entity.entity_type,
        legal_name: entity.legal_name,
        total_ownership_pct: Math.round(tree.totalPct * 100) / 100,
        is_complete: isComplete,
        all_verified: allVerified,
        max_depth: tree.maxDepth,
        escalation_required: tree.escalation,
        escalation_reason: tree.escalation ? `Ownership chain exceeds 3 layers (depth: ${tree.maxDepth})` : null,
        ownership_tree: tree.nodes,
      }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Use POST", 405);
  } catch (err) {
    console.error(`[${requestId}] UBO verify error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
