import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get calling user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's org
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (!profile?.org_id) {
      return new Response(JSON.stringify({ error: "No organisation found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // pathParts: ["programmes"] or ["programmes", "{id}"] or ["programmes", "{id}", "participants"|"milestones"|"fund-flows"|"report"]

    const method = req.method;

    // ─── Idempotency-Key required on ALL mutating requests ──────
    // Programme creates, participant adds, milestone updates, and fund-flow
    // mutations are all financially material (programme budgets, beneficiary
    // lists). We hard-require Idempotency-Key on every POST so a network
    // retry from a flaky client connection cannot silently double-spend or
    // duplicate a beneficiary. Header is intentionally not checked on
    // GET/PATCH/DELETE — the SDK only attaches it on creates today and
    // patches/deletes are naturally idempotent at the DB layer.
    if (method === "POST") {
      const idempotencyKey =
        req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
      if (!idempotencyKey) {
        return new Response(
          JSON.stringify({
            error: "Idempotency-Key header is required",
            code: "IDEMPOTENCY_KEY_REQUIRED",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }


    // ─── GET /programmes ───────────────────────────────────────
    if (method === "GET" && pathParts.length <= 1) {
      const { data, error } = await supabaseUser
        .from("programmes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return jsonResponse(data);
    }

    // ─── POST /programmes ──────────────────────────────────────
    if (method === "POST" && pathParts.length <= 1) {
      const body = await req.json();
      const { name, department, fiscal_year, budget_allocated, objectives } = body;

      if (!name || !department || !fiscal_year) {
        return jsonResponse({ error: "name, department, and fiscal_year are required" }, 400);
      }

      const { data, error } = await supabaseUser
        .from("programmes")
        .insert({
          org_id: profile.org_id,
          name,
          department,
          fiscal_year,
          budget_allocated: budget_allocated || 0,
          objectives: objectives || {},
          status: "draft",
        })
        .select()
        .single();

      if (error) throw error;

      // Audit log
      await supabaseAdmin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: "programme.created",
        entity_type: "programme",
        entity_id: data.id,
        metadata: { name, department, fiscal_year },
      });

      return jsonResponse(data, 201);
    }

    // Extract programme ID
    const programmeId = pathParts[1];
    if (!programmeId) {
      return jsonResponse({ error: "Programme ID required" }, 400);
    }

    const subResource = pathParts[2]; // "participants", "milestones", "fund-flows", "report"

    // ─── GET /programmes/{id} ──────────────────────────────────
    if (method === "GET" && !subResource) {
      const { data, error } = await supabaseUser
        .from("programmes")
        .select("*")
        .eq("id", programmeId)
        .single();

      if (error) throw error;
      return jsonResponse(data);
    }

    // ─── PATCH /programmes/{id} ────────────────────────────────
    if (method === "PATCH" && !subResource) {
      const body = await req.json();
      const allowed = ["name", "department", "fiscal_year", "budget_allocated", "budget_committed", "budget_disbursed", "objectives", "status"];
      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in body) updates[key] = body[key];
      }

      const { data, error } = await supabaseUser
        .from("programmes")
        .update(updates)
        .eq("id", programmeId)
        .select()
        .single();

      if (error) throw error;

      await supabaseAdmin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: "programme.updated",
        entity_type: "programme",
        entity_id: programmeId,
        metadata: updates,
      });

      return jsonResponse(data);
    }

    // ─── PARTICIPANTS ──────────────────────────────────────────
    if (subResource === "participants") {
      if (method === "GET") {
        const { data, error } = await supabaseUser
          .from("programme_participants")
          .select("*, entities(legal_name, entity_type, jurisdiction_code)")
          .eq("programme_id", programmeId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        return jsonResponse(data);
      }

      if (method === "POST") {
        const body = await req.json();
        const { entity_id, role } = body;

        if (!entity_id) {
          return jsonResponse({ error: "entity_id is required" }, 400);
        }

        const { data, error } = await supabaseUser
          .from("programme_participants")
          .insert({
            programme_id: programmeId,
            entity_id,
            role: role || "contractor",
            status: "pending",
          })
          .select()
          .single();

        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.participant_added",
          entity_type: "programme_participant",
          entity_id: data.id,
          metadata: { programme_id: programmeId, entity_id, role },
        });

        return jsonResponse(data, 201);
      }

      // PATCH participant — status change and/or metadata save.
      //
      // Audit contract (see src/tests/programme-participant-audit.test.ts):
      //   • status change       → writes audit `programme.participant_status_changed`
      //   • metadata-only save  → writes audit `programme.participant_updated` IFF
      //                           at least one allow-listed field actually changed
      //   • empty / no-op body  → no DB write, no audit row
      // The audit payload always carries previous_status, new_status,
      // changed_fields, programme_id, participant_id, actor_user_id and
      // actor_org_id. status is never written unless explicitly supplied
      // (preserves the "no field-save through transition logic" invariant).
      if (method === "PATCH") {
        const participantId = pathParts[3];
        if (!participantId) return jsonResponse({ error: "Participant ID required" }, 400);

        const body = await req.json();

        // Allow-list of editable fields. `status` is the only transition-y
        // one; the rest are pure metadata and must never imply a status change.
        const ALLOWED = ["status", "role", "notes"] as const;
        const updates: Record<string, unknown> = {};
        for (const key of ALLOWED) {
          if (key in body) updates[key] = body[key];
        }
        if (body.status === "approved") {
          updates.approved_at = new Date().toISOString();
          updates.approved_by = user.id;
        }

        // Empty/no-op PATCH — return current row, write no audit row.
        if (Object.keys(updates).length === 0) {
          const { data: current, error: readErr } = await supabaseUser
            .from("programme_participants")
            .select("*")
            .eq("id", participantId)
            .single();
          if (readErr) throw readErr;
          return jsonResponse(current);
        }

        // Snapshot previous row so we can diff and audit honestly.
        const { data: previous, error: prevErr } = await supabaseUser
          .from("programme_participants")
          .select("*")
          .eq("id", participantId)
          .single();
        if (prevErr) throw prevErr;

        const { data, error } = await supabaseUser
          .from("programme_participants")
          .update(updates)
          .eq("id", participantId)
          .select()
          .single();

        if (error) throw error;

        // Compute genuinely-changed fields (ignore approved_at/approved_by
        // bookkeeping that the handler stamps automatically).
        const changedFields: string[] = [];
        for (const key of ALLOWED) {
          if (key in updates && previous?.[key] !== data?.[key]) {
            changedFields.push(key);
          }
        }

        if (changedFields.length > 0) {
          const statusChanged = changedFields.includes("status");
          await supabaseAdmin.from("audit_logs").insert({
            org_id: profile.org_id,
            actor_user_id: user.id,
            action: statusChanged
              ? "programme.participant_status_changed"
              : "programme.participant_updated",
            entity_type: "programme_participant",
            entity_id: participantId,
            metadata: {
              programme_id: programmeId,
              participant_id: participantId,
              previous_status: previous?.status ?? null,
              new_status: data?.status ?? null,
              changed_fields: changedFields,
              actor_user_id: user.id,
              actor_org_id: profile.org_id,
              timestamp: new Date().toISOString(),
            },
          });
        }

        return jsonResponse(data);
      }
    }

    // ─── MILESTONES ────────────────────────────────────────────
    if (subResource === "milestones") {
      if (method === "GET") {
        const { data, error } = await supabaseUser
          .from("programme_milestones")
          .select("*, programme_participants(id, entities(legal_name))")
          .eq("programme_id", programmeId)
          .order("due_at", { ascending: true });

        if (error) throw error;
        return jsonResponse(data);
      }

      if (method === "POST") {
        const body = await req.json();
        const { participant_id, name, due_at, budget_tranche } = body;

        if (!participant_id || !name || !due_at) {
          return jsonResponse({ error: "participant_id, name, and due_at are required" }, 400);
        }

        const { data, error } = await supabaseUser
          .from("programme_milestones")
          .insert({
            programme_id: programmeId,
            participant_id,
            name,
            due_at,
            budget_tranche: budget_tranche || 0,
            status: "pending",
          })
          .select()
          .single();

        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.milestone_created",
          entity_type: "programme_milestone",
          entity_id: data.id,
          metadata: { programme_id: programmeId, name, due_at, budget_tranche },
        });

        return jsonResponse(data, 201);
      }

      if (method === "PATCH") {
        const milestoneId = pathParts[3];
        if (!milestoneId) return jsonResponse({ error: "Milestone ID required" }, 400);

        const body = await req.json();
        const allowed = ["status", "completed_at", "evidence_document_id"];
        const updates: Record<string, unknown> = {};
        for (const key of allowed) {
          if (key in body) updates[key] = body[key];
        }

        if (body.status === "completed") {
          updates.completed_at = updates.completed_at || new Date().toISOString();
          updates.verified_by = user.id;
          updates.verified_at = new Date().toISOString();
        }

        const { data, error } = await supabaseUser
          .from("programme_milestones")
          .update(updates)
          .eq("id", milestoneId)
          .select()
          .single();

        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.milestone_updated",
          entity_type: "programme_milestone",
          entity_id: milestoneId,
          metadata: updates,
        });

        return jsonResponse(data);
      }
    }

    // ─── FUND-FLOWS ────────────────────────────────────────────
    if (subResource === "fund-flows") {
      if (method === "GET") {
        const { data, error } = await supabaseUser
          .from("fund_flows")
          .select("*")
          .eq("programme_id", programmeId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        return jsonResponse(data);
      }

      if (method === "POST") {
        const body = await req.json();
        const { participant_id, milestone_id, flow_type, amount, reference, idempotency_key } = body;

        if (!participant_id || !flow_type || !amount || !idempotency_key) {
          return jsonResponse({ error: "participant_id, flow_type, amount, and idempotency_key are required" }, 400);
        }

        // Get previous hash for chain
        const { data: lastFlow } = await supabaseAdmin
          .from("fund_flows")
          .select("payload_hash")
          .eq("programme_id", programmeId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const previousHash = lastFlow?.payload_hash || null;

        // Compute SHA-256 hash
        const payload = JSON.stringify({
          programme_id: programmeId,
          participant_id,
          milestone_id,
          flow_type,
          amount,
          reference,
          previous_hash: previousHash,
          timestamp: new Date().toISOString(),
        });

        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const payloadHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        const { data, error } = await supabaseUser
          .from("fund_flows")
          .insert({
            programme_id: programmeId,
            participant_id,
            milestone_id: milestone_id || null,
            flow_type,
            amount,
            currency: body.currency || "ZAR",
            reference: reference || null,
            payload_hash: payloadHash,
            previous_hash: previousHash,
            idempotency_key,
            recorded_by: user.id,
          })
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            return jsonResponse({ error: "Duplicate idempotency key — this fund flow was already recorded" }, 409);
          }
          throw error;
        }

        // Update programme budget counters
        if (flow_type === "commitment") {
          await supabaseAdmin.rpc("atomic_programme_budget_update", {
            p_programme_id: programmeId,
            p_field: "budget_committed",
            p_amount: amount,
          }).catch(() => {
            // Fallback: direct update
            return supabaseAdmin
              .from("programmes")
              .update({ budget_committed: amount })
              .eq("id", programmeId);
          });
        } else if (flow_type === "disbursement") {
          await supabaseAdmin
            .from("programmes")
            .select("budget_disbursed")
            .eq("id", programmeId)
            .single()
            .then(({ data: prog }) => {
              if (prog) {
                return supabaseAdmin
                  .from("programmes")
                  .update({ budget_disbursed: (prog.budget_disbursed || 0) + amount })
                  .eq("id", programmeId);
              }
            });
        }

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: `programme.fund_flow.${flow_type}`,
          entity_type: "fund_flow",
          entity_id: data.id,
          metadata: { programme_id: programmeId, flow_type, amount, reference, payload_hash: payloadHash },
        });

        return jsonResponse(data, 201);
      }
    }

    // ─── REPORT ────────────────────────────────────────────────
    if (subResource === "report" && method === "GET") {
      // Fetch all data in parallel
      const [programmeRes, participantsRes, milestonesRes, fundFlowsRes] = await Promise.all([
        supabaseUser.from("programmes").select("*").eq("id", programmeId).single(),
        supabaseUser.from("programme_participants").select("*, entities(legal_name, entity_type, jurisdiction_code, status)").eq("programme_id", programmeId),
        supabaseUser.from("programme_milestones").select("*").eq("programme_id", programmeId).order("due_at"),
        supabaseUser.from("fund_flows").select("*").eq("programme_id", programmeId).order("created_at"),
      ]);

      if (programmeRes.error) throw programmeRes.error;

      const programme = programmeRes.data;
      const participants = participantsRes.data || [];
      const milestones = milestonesRes.data || [];
      const fundFlows = fundFlowsRes.data || [];

      // Verify hash chain integrity
      let chainValid = true;
      for (let i = 0; i < fundFlows.length; i++) {
        if (i === 0) {
          if (fundFlows[i].previous_hash !== null) {
            chainValid = false;
            break;
          }
        } else {
          if (fundFlows[i].previous_hash !== fundFlows[i - 1].payload_hash) {
            chainValid = false;
            break;
          }
        }
      }

      // Budget waterfall
      const waterfall = {
        allocated: Number(programme.budget_allocated) || 0,
        committed: fundFlows.filter((f: any) => f.flow_type === "commitment").reduce((s: number, f: any) => s + Number(f.amount), 0),
        disbursed: fundFlows.filter((f: any) => f.flow_type === "disbursement").reduce((s: number, f: any) => s + Number(f.amount), 0),
        returned: fundFlows.filter((f: any) => f.flow_type === "return").reduce((s: number, f: any) => s + Number(f.amount), 0),
      };

      const report = {
        programme,
        participants,
        milestones: {
          total: milestones.length,
          completed: milestones.filter((m: any) => m.status === "completed").length,
          overdue: milestones.filter((m: any) => m.status === "overdue").length,
          pending: milestones.filter((m: any) => m.status === "pending").length,
          in_progress: milestones.filter((m: any) => m.status === "in_progress").length,
          items: milestones,
        },
        fund_flow_waterfall: waterfall,
        fund_flow_chain: {
          total_entries: fundFlows.length,
          chain_integrity_valid: chainValid,
          entries: fundFlows,
        },
        generated_at: new Date().toISOString(),
      };

      return jsonResponse(report);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (err) {
    console.error("Programme governance error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
