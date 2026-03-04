import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * PoD (Proof-of-Delivery) Edge Function — V3 Sprint 4
 *
 * POST /pods:           Create PoD from an ISSUED WaD, with milestone definitions.
 * GET  /pods:           List PoDs for org.
 * POST /pods/milestone: Complete a milestone (attach evidence document).
 * POST /pods/breach:    Detect and record a breach (7-day grace period).
 * POST /pods/finalise:  Finalise PoD when all milestones complete.
 */

const BREACH_GRACE_DAYS = 7;

const PodCreateSchema = z.object({
  wad_id: z.string().uuid(),
  milestones: z.array(
    z.object({
      name: z.string().min(1).max(256),
      due_at: z.string().datetime(),
    })
  ).min(1).max(20),
});

const MilestoneCompleteSchema = z.object({
  milestone_id: z.string().uuid(),
  evidence_document_id: z.string().uuid().optional(),
});

const BreachRecordSchema = z.object({
  pod_id: z.string().uuid(),
  milestone_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(1024),
});

const PodFinaliseSchema = z.object({
  pod_id: z.string().uuid(),
});

function successEnvelope(data: unknown, correlationId: string) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    data,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ── POST: Create PoD ──
    if (req.method === "POST" && (!action || action === "create")) {
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);

      // Idempotency check
      const { data: existing } = await admin
        .from("idempotency_keys")
        .select("response_data, response_status_code")
        .eq("org_id", orgId)
        .eq("idempotency_key", idempotencyKey)
        .eq("endpoint", "pods")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const parsed = PodCreateSchema.parse(body);

      // Verify WaD exists and is ISSUED
      const { data: wad } = await admin
        .from("p3_wads")
        .select("id, state, org_id")
        .eq("id", parsed.wad_id)
        .maybeSingle();

      if (!wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.org_id !== orgId) throw new ApiException("FORBIDDEN", "Not authorised for this WaD", 403);
      if (wad.state !== "ISSUED") {
        throw new ApiException("PRECONDITION_FAILED", `WaD must be ISSUED to create PoD. Current: ${wad.state}`, 412);
      }

      // Check no existing active PoD for this WaD
      const { data: existingPod } = await admin
        .from("pods")
        .select("id")
        .eq("wad_id", parsed.wad_id)
        .neq("state", "CANCELLED")
        .maybeSingle();

      if (existingPod) throw new ApiException("CONFLICT", "Active PoD already exists for this WaD", 409);

      // Create PoD
      const { data: pod, error: podErr } = await admin
        .from("pods")
        .insert({ org_id: orgId, wad_id: parsed.wad_id, state: "IN_PROGRESS" })
        .select()
        .single();

      if (podErr) throw new ApiException("INTERNAL_ERROR", podErr.message, 500);

      // Create milestones
      const milestoneInserts = parsed.milestones.map((m) => ({
        org_id: orgId,
        pod_id: pod.id,
        name: m.name,
        due_at: m.due_at,
        status: "pending",
      }));

      const { data: milestones, error: msErr } = await admin
        .from("pod_milestones")
        .insert(milestoneInserts)
        .select();

      if (msErr) throw new ApiException("INTERNAL_ERROR", msErr.message, 500);

      // Record event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "delivery",
        aggregate_type: "pod",
        aggregate_id: pod.id,
        event_type: "delivery.pod.created",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { wad_id: parsed.wad_id, milestone_count: parsed.milestones.length },
        event_hash: await computeHash(JSON.stringify({ pod_id: pod.id })),
      });

      const responseData = successEnvelope(
        { pod_id: pod.id, state: pod.state, wad_id: pod.wad_id, milestones: milestones || [] },
        correlationId
      );

      await admin.from("idempotency_keys").insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        endpoint: "pods",
        request_hash: await computeHash(JSON.stringify(parsed)),
        response_data: responseData,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responseData), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST: Complete Milestone ──
    if (req.method === "POST" && action === "complete-milestone") {
      const body = await req.json();
      const parsed = MilestoneCompleteSchema.parse(body);

      const { data: milestone } = await admin
        .from("pod_milestones")
        .select("*, pods!inner(org_id, state)")
        .eq("id", parsed.milestone_id)
        .maybeSingle();

      if (!milestone) throw new ApiException("NOT_FOUND", "Milestone not found", 404);
      if ((milestone as any).pods.org_id !== orgId) throw new ApiException("FORBIDDEN", "Not authorised", 403);
      if ((milestone as any).pods.state !== "IN_PROGRESS") {
        throw new ApiException("PRECONDITION_FAILED", "PoD is not in progress", 412);
      }
      if (milestone.status === "completed") {
        throw new ApiException("CONFLICT", "Milestone already completed", 409);
      }

      const { data: updated, error } = await admin
        .from("pod_milestones")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          evidence_document_id: parsed.evidence_document_id || null,
        })
        .eq("id", parsed.milestone_id)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "delivery",
        aggregate_type: "pod_milestone",
        aggregate_id: milestone.id,
        event_type: "delivery.milestone.completed",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { pod_id: milestone.pod_id, milestone_name: milestone.name },
        event_hash: await computeHash(JSON.stringify({ milestone_id: milestone.id })),
      });

      return new Response(JSON.stringify(successEnvelope(updated, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST: Record Breach ──
    if (req.method === "POST" && action === "breach") {
      const body = await req.json();
      const parsed = BreachRecordSchema.parse(body);

      const { data: pod } = await admin
        .from("pods")
        .select("id, org_id, state")
        .eq("id", parsed.pod_id)
        .maybeSingle();

      if (!pod) throw new ApiException("NOT_FOUND", "PoD not found", 404);
      if (pod.org_id !== orgId && !authCtx.roles.includes("admin") && !authCtx.roles.includes("platform_admin")) {
        throw new ApiException("FORBIDDEN", "Not authorised", 403);
      }

      const { data: breach, error } = await admin
        .from("breaches")
        .insert({
          org_id: orgId,
          pod_id: parsed.pod_id,
          milestone_id: parsed.milestone_id || null,
          reason: parsed.reason,
          status: "open",
          detected_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // If milestone provided, mark it as deficient
      if (parsed.milestone_id) {
        await admin
          .from("pod_milestones")
          .update({
            status: "deficient",
            detected_deficiency_at: new Date().toISOString(),
          })
          .eq("id", parsed.milestone_id);
      }

      // Update PoD state to BREACHED
      await admin.from("pods").update({ state: "BREACHED" }).eq("id", parsed.pod_id);

      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "delivery",
        aggregate_type: "breach",
        aggregate_id: breach.id,
        event_type: "delivery.breach.detected",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: {
          pod_id: parsed.pod_id,
          milestone_id: parsed.milestone_id,
          reason: parsed.reason,
          grace_period_days: BREACH_GRACE_DAYS,
        },
        event_hash: await computeHash(JSON.stringify({ breach_id: breach.id })),
      });

      return new Response(
        JSON.stringify(
          successEnvelope(
            { ...breach, grace_period_days: BREACH_GRACE_DAYS, grace_deadline: gracePeriodDeadline() },
            correlationId
          )
        ),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── POST: Finalise PoD ──
    if (req.method === "POST" && action === "finalise") {
      const body = await req.json();
      const parsed = PodFinaliseSchema.parse(body);

      const { data: pod } = await admin
        .from("pods")
        .select("*")
        .eq("id", parsed.pod_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!pod) throw new ApiException("NOT_FOUND", "PoD not found", 404);
      if (pod.state === "FINALISED") throw new ApiException("CONFLICT", "PoD already finalised", 409);

      // Check all milestones are completed
      const { data: milestones } = await admin
        .from("pod_milestones")
        .select("id, status")
        .eq("pod_id", parsed.pod_id);

      const incomplete = (milestones || []).filter((m) => m.status !== "completed");
      if (incomplete.length > 0) {
        throw new ApiException(
          "PRECONDITION_FAILED",
          `${incomplete.length} milestone(s) not yet completed`,
          412
        );
      }

      // Check no open breaches
      const { data: openBreaches } = await admin
        .from("breaches")
        .select("id")
        .eq("pod_id", parsed.pod_id)
        .eq("status", "open")
        .limit(1);

      if (openBreaches && openBreaches.length > 0) {
        throw new ApiException("PRECONDITION_FAILED", "Open breaches must be resolved before finalisation", 412);
      }

      const { data: finalised, error } = await admin
        .from("pods")
        .update({ state: "FINALISED", finalised_at: new Date().toISOString() })
        .eq("id", parsed.pod_id)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "delivery",
        aggregate_type: "pod",
        aggregate_id: pod.id,
        event_type: "delivery.pod.finalised",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { milestone_count: (milestones || []).length },
        event_hash: await computeHash(JSON.stringify({ pod_id: pod.id, finalised: true })),
      });

      return new Response(JSON.stringify(successEnvelope(finalised, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: List PoDs ──
    if (req.method === "GET") {
      const podId = url.searchParams.get("pod_id");

      if (podId) {
        const { data: pod } = await admin
          .from("pods")
          .select("*")
          .eq("id", podId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (!pod) throw new ApiException("NOT_FOUND", "PoD not found", 404);

        const [msRes, brRes] = await Promise.all([
          admin.from("pod_milestones").select("*").eq("pod_id", podId).order("due_at", { ascending: true }),
          admin.from("breaches").select("*").eq("pod_id", podId).order("detected_at", { ascending: false }),
        ]);

        return new Response(
          JSON.stringify(
            successEnvelope(
              { ...pod, milestones: msRes.data || [], breaches: brRes.data || [] },
              correlationId
            )
          ),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: pods, error } = await admin
        .from("pods")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(successEnvelope(pods || [], correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(
        JSON.stringify({
          status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
          error: { code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      return new Response(
        JSON.stringify({
          status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
          error: { code: err.code, message: err.message },
        }),
        { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({
        status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function gracePeriodDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
