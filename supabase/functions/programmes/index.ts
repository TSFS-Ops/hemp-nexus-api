// Batch R hardening (2026-05-16):
//  - Zod validation on every PATCH/POST body, including unknown-key rejection.
//  - Programme participants: status transition is enforced at the DB layer
//    (validate_programme_participant_transition trigger); free-text status
//    rejected by validate_programme_participant_status trigger.
//  - Participants without email/phone are recorded as
//    contact_completeness_state='pending_contact' and cannot be promoted
//    to 'approved' without an explicit manual_follow_up_reason (>=10 chars).
//  - Before/after values for role / notes / email / phone / status all
//    flow through the audit row metadata.
//  - No-op patch still writes no audit row.
//  - POST /participants/:id/archive performs a soft archive via the
//    archive_programme_participant SECURITY DEFINER helper, which writes
//    a before-snapshot audit row and refuses to silently drop a
//    participant with linked fund-flows / open milestones / trade approvals.
//  - AAL2 required on every state-changing route that mutates money,
//    promotes/suspends participants, archives a participant, or exports a
//    sensitive programme report.
//  - GET /report redacts payload_hash, previous_hash, idempotency_key,
//    recorded_by and any free-form metadata by default; sensitive=true
//    requires AAL2 and writes an export-audit row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Schemas ──────────────────────────────────────────────────────
const ProgrammeCreate = z.object({
  name: z.string().trim().min(1).max(200),
  department: z.string().trim().min(1).max(200),
  fiscal_year: z.string().trim().min(1).max(50),
  budget_allocated: z.number().nonnegative().optional(),
  objectives: z.record(z.unknown()).optional(),
}).strict();

const ProgrammePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  department: z.string().trim().min(1).max(200).optional(),
  fiscal_year: z.string().trim().min(1).max(50).optional(),
  budget_allocated: z.number().nonnegative().optional(),
  budget_committed: z.number().nonnegative().optional(),
  budget_disbursed: z.number().nonnegative().optional(),
  objectives: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "active", "reporting", "closed"]).optional(),
  reason: z.string().trim().min(10).max(500).optional(),
}).strict();

const ParticipantCreate = z.object({
  entity_id: z.string().uuid(),
  role: z.enum(["contractor", "implementing_agent", "beneficiary", "oversight"]).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().min(3).max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();

const PARTICIPANT_STATUSES = ["pending", "approved", "rejected", "suspended", "withdrawn"] as const;
const REASON_REQUIRED_STATUSES = new Set(["rejected", "suspended", "withdrawn"]);
const SENSITIVE_PARTICIPANT_STATUSES = new Set(["approved", "rejected", "suspended"]);

const ParticipantPatch = z.object({
  status: z.enum(PARTICIPANT_STATUSES).optional(),
  role: z.enum(["contractor", "implementing_agent", "beneficiary", "oversight"]).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  reason: z.string().trim().min(10).max(500).optional(),
  manual_follow_up_reason: z.string().trim().min(10).max(500).optional(),
}).strict();

const ParticipantArchive = z.object({
  reason: z.string().trim().min(10).max(500),
  override_linked: z.boolean().optional(),
}).strict();

const MilestoneCreate = z.object({
  participant_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  due_at: z.string().datetime(),
  budget_tranche: z.number().nonnegative().optional(),
}).strict();

const MilestonePatch = z.object({
  status: z.enum(["pending", "in_progress", "completed", "overdue", "disputed"]).optional(),
  completed_at: z.string().datetime().optional(),
  evidence_document_id: z.string().uuid().optional(),
}).strict();

const FundFlowCreate = z.object({
  participant_id: z.string().uuid(),
  milestone_id: z.string().uuid().nullable().optional(),
  flow_type: z.enum(["allocation", "commitment", "disbursement", "return"]),
  amount: z.number().positive(),
  currency: z.string().trim().max(8).optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  idempotency_key: z.string().trim().min(8).max(120),
  reason: z.string().trim().min(10).max(500).optional(),
}).strict();

// ── Redaction for /report ────────────────────────────────────────
const REDACTED = "[redacted]";
const FUND_FLOW_REDACTED_KEYS = new Set([
  "payload_hash",
  "previous_hash",
  "idempotency_key",
  "recorded_by",
  "reference",
]);
const PARTICIPANT_HIDDEN_KEYS = new Set(["manual_follow_up_reason", "archive_reason"]);

function redactFundFlow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = FUND_FLOW_REDACTED_KEYS.has(k) ? REDACTED : v;
  }
  return out;
}
function redactParticipant(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (PARTICIPANT_HIDDEN_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function zodError(parsed: { error: z.ZodError }) {
  return jsonResponse({
    error: "validation_error",
    code: "VALIDATION_ERROR",
    details: parsed.error.flatten(),
  }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("org_id").eq("id", user.id).single();
    if (!profile?.org_id) return jsonResponse({ error: "No organisation found" }, 403);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const method = req.method;

    // Idempotency-Key required on every POST.
    if (method === "POST") {
      const idempotencyKey = req.headers.get("Idempotency-Key") || req.headers.get("idempotency-key");
      if (!idempotencyKey) {
        return jsonResponse({
          error: "Idempotency-Key header is required",
          code: "IDEMPOTENCY_KEY_REQUIRED",
        }, 400);
      }
    }

    // ── GET /programmes ────────────────────────────────────────
    if (method === "GET" && pathParts.length <= 1) {
      const { data, error } = await supabaseUser
        .from("programmes").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse(data);
    }

    // ── POST /programmes ───────────────────────────────────────
    if (method === "POST" && pathParts.length <= 1) {
      const raw = await req.json().catch(() => ({}));
      const parsed = ProgrammeCreate.safeParse(raw);
      if (!parsed.success) return zodError(parsed);
      const body = parsed.data;

      const { data, error } = await supabaseUser
        .from("programmes").insert({
          org_id: profile.org_id,
          name: body.name,
          department: body.department,
          fiscal_year: body.fiscal_year,
          budget_allocated: body.budget_allocated ?? 0,
          objectives: body.objectives ?? {},
          status: "draft",
        }).select().single();
      if (error) throw error;

      await supabaseAdmin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: "programme.created",
        entity_type: "programme",
        entity_id: data.id,
        metadata: { name: body.name, department: body.department, fiscal_year: body.fiscal_year },
      });
      return jsonResponse(data, 201);
    }

    const programmeId = pathParts[1];
    if (!programmeId) return jsonResponse({ error: "Programme ID required" }, 400);
    const subResource = pathParts[2];

    // ── GET /programmes/{id} ───────────────────────────────────
    if (method === "GET" && !subResource) {
      const { data, error } = await supabaseUser
        .from("programmes").select("*").eq("id", programmeId).single();
      if (error) throw error;
      return jsonResponse(data);
    }

    // ── PATCH /programmes/{id} ─────────────────────────────────
    if (method === "PATCH" && !subResource) {
      const raw = await req.json().catch(() => ({}));
      const parsed = ProgrammePatch.safeParse(raw);
      if (!parsed.success) return zodError(parsed);
      const body = parsed.data;

      // AAL2 on budget mutations.
      const mutatesBudget = "budget_allocated" in body || "budget_committed" in body || "budget_disbursed" in body;
      if (mutatesBudget) {
        await assertAal2(authHeader, {
          adminClient: supabaseAdmin,
          callerUserId: user.id,
          action: "programme.budget_update",
          context: { programme_id: programmeId },
        });
      }

      const { data: previous, error: prevErr } = await supabaseUser
        .from("programmes").select("*").eq("id", programmeId).single();
      if (prevErr) throw prevErr;

      const { reason, ...updates } = body;
      if (Object.keys(updates).length === 0) return jsonResponse(previous);

      const { data, error } = await supabaseUser
        .from("programmes").update(updates).eq("id", programmeId).select().single();
      if (error) throw error;

      const changed: Record<string, { before: unknown; after: unknown }> = {};
      for (const k of Object.keys(updates)) {
        if ((previous as Record<string, unknown>)?.[k] !== (data as Record<string, unknown>)?.[k]) {
          changed[k] = { before: (previous as Record<string, unknown>)?.[k] ?? null, after: (data as Record<string, unknown>)?.[k] ?? null };
        }
      }

      if (Object.keys(changed).length > 0) {
        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.updated",
          entity_type: "programme",
          entity_id: programmeId,
          metadata: { changed, reason: reason ?? null, mutates_budget: mutatesBudget },
        });
      }
      return jsonResponse(data);
    }

    // ── PARTICIPANTS ───────────────────────────────────────────
    if (subResource === "participants") {
      // GET list
      if (method === "GET" && !pathParts[3]) {
        const { data, error } = await supabaseUser
          .from("programme_participants")
          .select("*, entities(legal_name, entity_type, jurisdiction_code)")
          .eq("programme_id", programmeId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return jsonResponse(data);
      }

      // POST create
      if (method === "POST" && !pathParts[3]) {
        const raw = await req.json().catch(() => ({}));
        const parsed = ParticipantCreate.safeParse(raw);
        if (!parsed.success) return zodError(parsed);
        const body = parsed.data;

        const hasContact = !!(body.email || body.phone);
        const contactState = hasContact ? "complete" : "pending_contact";

        const { data, error } = await supabaseUser
          .from("programme_participants").insert({
            programme_id: programmeId,
            entity_id: body.entity_id,
            role: body.role ?? "contractor",
            status: "pending",
            email: body.email ?? null,
            phone: body.phone ?? null,
            notes: body.notes ?? null,
            contact_completeness_state: contactState,
          }).select().single();
        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.participant_added",
          entity_type: "programme_participant",
          entity_id: data.id,
          metadata: {
            programme_id: programmeId,
            entity_id: body.entity_id,
            role: body.role ?? "contractor",
            contact_completeness_state: contactState,
            has_contact: hasContact,
          },
        });
        return jsonResponse(data, 201);
      }

      const participantId = pathParts[3];
      if (!participantId) return jsonResponse({ error: "Participant ID required" }, 400);

      // POST /participants/:id/archive  (soft archive)
      if (method === "POST" && pathParts[4] === "archive") {
        const raw = await req.json().catch(() => ({}));
        const parsed = ParticipantArchive.safeParse(raw);
        if (!parsed.success) return zodError(parsed);
        await assertAal2(authHeader, {
          adminClient: supabaseAdmin,
          callerUserId: user.id,
          action: "programme.participant_archive",
          context: { participant_id: participantId, programme_id: programmeId },
        });

        const { data, error } = await supabaseAdmin.rpc("archive_programme_participant", {
          p_participant_id: participantId,
          p_actor_user_id: user.id,
          p_actor_org_id: profile.org_id,
          p_reason: parsed.data.reason,
          p_override_linked: parsed.data.override_linked ?? false,
        });
        if (error) {
          const msg = error.message || "";
          if (msg.includes("PARTICIPANT_LINKED")) return jsonResponse({ error: "participant_linked", code: "PARTICIPANT_LINKED", message: msg }, 409);
          if (msg.includes("ARCHIVE_REASON_REQUIRED")) return jsonResponse({ error: "reason_required", code: "ARCHIVE_REASON_REQUIRED" }, 400);
          if (msg.includes("ALREADY_ARCHIVED")) return jsonResponse({ error: "already_archived", code: "ALREADY_ARCHIVED" }, 409);
          if (msg.includes("PARTICIPANT_NOT_FOUND")) return jsonResponse({ error: "not_found", code: "PARTICIPANT_NOT_FOUND" }, 404);
          throw error;
        }
        return jsonResponse(data);
      }

      // PATCH participant
      if (method === "PATCH") {
        const raw = await req.json().catch(() => ({}));
        const parsed = ParticipantPatch.safeParse(raw);
        if (!parsed.success) return zodError(parsed);
        const body = parsed.data;
        const { reason, manual_follow_up_reason, ...updates } = body;

        if (Object.keys(updates).length === 0 && !manual_follow_up_reason) {
          const { data: cur } = await supabaseUser
            .from("programme_participants").select("*").eq("id", participantId).single();
          return jsonResponse(cur);
        }

        // AAL2 on sensitive status promotions / demotions.
        if (updates.status && SENSITIVE_PARTICIPANT_STATUSES.has(updates.status)) {
          await assertAal2(authHeader, {
            adminClient: supabaseAdmin,
            callerUserId: user.id,
            action: `programme.participant_status_${updates.status}`,
            context: { participant_id: participantId, programme_id: programmeId },
          });
        }

        // Reason >=10 chars required for adverse transitions.
        if (updates.status && REASON_REQUIRED_STATUSES.has(updates.status)) {
          if (!reason || reason.trim().length < 10) {
            return jsonResponse({
              error: "reason_required",
              code: "REASON_REQUIRED",
              message: `Reason >=10 chars required for status change to ${updates.status}`,
            }, 400);
          }
        }

        const { data: previous, error: prevErr } = await supabaseUser
          .from("programme_participants").select("*").eq("id", participantId).single();
        if (prevErr) throw prevErr;

        const dbUpdate: Record<string, unknown> = { ...updates };
        if (updates.status === "approved") {
          dbUpdate.approved_at = new Date().toISOString();
          dbUpdate.approved_by = user.id;
        }
        if (manual_follow_up_reason) {
          dbUpdate.manual_follow_up_reason = manual_follow_up_reason;
        }

        const { data, error } = await supabaseUser
          .from("programme_participants").update(dbUpdate).eq("id", participantId).select().single();
        if (error) {
          const msg = error.message || "";
          if (msg.includes("INVALID_PARTICIPANT_STATUS")) return jsonResponse({ error: "invalid_status", code: "INVALID_PARTICIPANT_STATUS", message: msg }, 400);
          if (msg.includes("INVALID_PARTICIPANT_TRANSITION")) return jsonResponse({ error: "invalid_transition", code: "INVALID_PARTICIPANT_TRANSITION", message: msg }, 409);
          if (msg.includes("CONTACT_REQUIRED_FOR_APPROVAL")) return jsonResponse({ error: "contact_required", code: "CONTACT_REQUIRED_FOR_APPROVAL", message: msg }, 409);
          throw error;
        }

        // Compute before/after diff for genuinely changed fields only.
        const TRACKED = ["status", "role", "notes", "email", "phone", "contact_completeness_state"] as const;
        const changed: Record<string, { before: unknown; after: unknown }> = {};
        for (const k of TRACKED) {
          if ((previous as Record<string, unknown>)?.[k] !== (data as Record<string, unknown>)?.[k]) {
            changed[k] = {
              before: (previous as Record<string, unknown>)?.[k] ?? null,
              after: (data as Record<string, unknown>)?.[k] ?? null,
            };
          }
        }

        if (Object.keys(changed).length > 0) {
          const statusChanged = "status" in changed;
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
              previous_status: (previous as { status?: string })?.status ?? null,
              new_status: (data as { status?: string })?.status ?? null,
              changed,
              changed_fields: Object.keys(changed),
              reason: reason ?? null,
              manual_follow_up_reason: manual_follow_up_reason ?? null,
              actor_user_id: user.id,
              actor_org_id: profile.org_id,
              timestamp: new Date().toISOString(),
            },
          });
        }
        return jsonResponse(data);
      }
    }

    // ── MILESTONES ────────────────────────────────────────────
    if (subResource === "milestones") {
      if (method === "GET") {
        const { data, error } = await supabaseUser
          .from("programme_milestones")
          .select("*, programme_participants(id, entities(legal_name))")
          .eq("programme_id", programmeId).order("due_at", { ascending: true });
        if (error) throw error;
        return jsonResponse(data);
      }

      if (method === "POST") {
        const raw = await req.json().catch(() => ({}));
        const parsed = MilestoneCreate.safeParse(raw);
        if (!parsed.success) return zodError(parsed);
        const body = parsed.data;

        const { data, error } = await supabaseUser
          .from("programme_milestones").insert({
            programme_id: programmeId,
            participant_id: body.participant_id,
            name: body.name,
            due_at: body.due_at,
            budget_tranche: body.budget_tranche ?? 0,
            status: "pending",
          }).select().single();
        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.milestone_created",
          entity_type: "programme_milestone",
          entity_id: data.id,
          metadata: { programme_id: programmeId, name: body.name, due_at: body.due_at, budget_tranche: body.budget_tranche ?? 0 },
        });
        return jsonResponse(data, 201);
      }

      if (method === "PATCH") {
        const milestoneId = pathParts[3];
        if (!milestoneId) return jsonResponse({ error: "Milestone ID required" }, 400);
        const raw = await req.json().catch(() => ({}));
        const parsed = MilestonePatch.safeParse(raw);
        if (!parsed.success) return zodError(parsed);

        const { data: previous } = await supabaseUser
          .from("programme_milestones").select("*").eq("id", milestoneId).single();

        const updates: Record<string, unknown> = { ...parsed.data };
        if (parsed.data.status === "completed") {
          updates.completed_at = parsed.data.completed_at || new Date().toISOString();
          updates.verified_by = user.id;
          updates.verified_at = new Date().toISOString();
        }

        const { data, error } = await supabaseUser
          .from("programme_milestones").update(updates).eq("id", milestoneId).select().single();
        if (error) throw error;

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: "programme.milestone_updated",
          entity_type: "programme_milestone",
          entity_id: milestoneId,
          metadata: { programme_id: programmeId, before: previous, after: data, changed: updates },
        });
        return jsonResponse(data);
      }
    }

    // ── FUND-FLOWS ────────────────────────────────────────────
    if (subResource === "fund-flows") {
      if (method === "GET") {
        const { data, error } = await supabaseUser
          .from("fund_flows").select("*").eq("programme_id", programmeId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return jsonResponse(data);
      }

      if (method === "POST") {
        await assertAal2(authHeader, {
          adminClient: supabaseAdmin,
          callerUserId: user.id,
          action: "programme.fund_flow_create",
          context: { programme_id: programmeId },
        });

        const raw = await req.json().catch(() => ({}));
        const parsed = FundFlowCreate.safeParse(raw);
        if (!parsed.success) return zodError(parsed);
        const body = parsed.data;

        const { data: lastFlow } = await supabaseAdmin
          .from("fund_flows").select("payload_hash")
          .eq("programme_id", programmeId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        const previousHash = lastFlow?.payload_hash || null;

        const payload = JSON.stringify({
          programme_id: programmeId,
          participant_id: body.participant_id,
          milestone_id: body.milestone_id,
          flow_type: body.flow_type,
          amount: body.amount,
          reference: body.reference,
          previous_hash: previousHash,
          timestamp: new Date().toISOString(),
        });
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
        const payloadHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0")).join("");

        const { data, error } = await supabaseUser
          .from("fund_flows").insert({
            programme_id: programmeId,
            participant_id: body.participant_id,
            milestone_id: body.milestone_id || null,
            flow_type: body.flow_type,
            amount: body.amount,
            currency: body.currency || "ZAR",
            reference: body.reference || null,
            payload_hash: payloadHash,
            previous_hash: previousHash,
            idempotency_key: body.idempotency_key,
            recorded_by: user.id,
          }).select().single();

        if (error) {
          if (error.code === "23505") {
            return jsonResponse({ error: "Duplicate idempotency key — this fund flow was already recorded" }, 409);
          }
          throw error;
        }

        await supabaseAdmin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
          action: `programme.fund_flow.${body.flow_type}`,
          entity_type: "fund_flow",
          entity_id: data.id,
          metadata: {
            programme_id: programmeId,
            flow_type: body.flow_type,
            amount: body.amount,
            payload_hash: payloadHash,
            reason: body.reason ?? null,
          },
        });
        return jsonResponse(data, 201);
      }
    }

    // ── REPORT (redacted by default; ?sensitive=1 requires AAL2) ──
    if (subResource === "report" && method === "GET") {
      const sensitive = url.searchParams.get("sensitive") === "1";
      if (sensitive) {
        await assertAal2(authHeader, {
          adminClient: supabaseAdmin,
          callerUserId: user.id,
          action: "programme.report_sensitive_view",
          context: { programme_id: programmeId },
        });
      }

      const [programmeRes, participantsRes, milestonesRes, fundFlowsRes] = await Promise.all([
        supabaseUser.from("programmes").select("*").eq("id", programmeId).single(),
        supabaseUser.from("programme_participants").select("*, entities(legal_name, entity_type, jurisdiction_code, status)").eq("programme_id", programmeId),
        supabaseUser.from("programme_milestones").select("*").eq("programme_id", programmeId).order("due_at"),
        supabaseUser.from("fund_flows").select("*").eq("programme_id", programmeId).order("created_at"),
      ]);
      if (programmeRes.error) throw programmeRes.error;

      const programme = programmeRes.data;
      const participantsRaw = participantsRes.data || [];
      const milestones = milestonesRes.data || [];
      const fundFlowsRaw = fundFlowsRes.data || [];

      const participants = sensitive
        ? participantsRaw
        : participantsRaw.map((r) => redactParticipant(r as Record<string, unknown>));
      const fundFlowsForView = sensitive
        ? fundFlowsRaw
        : fundFlowsRaw.map((r) => redactFundFlow(r as Record<string, unknown>));

      // Chain validity uses raw hashes server-side regardless of redaction.
      let chainValid = true;
      for (let i = 0; i < fundFlowsRaw.length; i++) {
        const expected = i === 0 ? null : fundFlowsRaw[i - 1].payload_hash;
        if (fundFlowsRaw[i].previous_hash !== expected) { chainValid = false; break; }
      }

      const waterfall = {
        allocated: Number(programme.budget_allocated) || 0,
        committed: fundFlowsRaw.filter((f) => f.flow_type === "commitment").reduce((s, f) => s + Number(f.amount), 0),
        disbursed: fundFlowsRaw.filter((f) => f.flow_type === "disbursement").reduce((s, f) => s + Number(f.amount), 0),
        returned: fundFlowsRaw.filter((f) => f.flow_type === "return").reduce((s, f) => s + Number(f.amount), 0),
      };

      // Write export audit row for every /report call (Batch O contract).
      await supabaseAdmin.from("audit_logs").insert({
        org_id: profile.org_id,
        actor_user_id: user.id,
        action: sensitive ? "programme.report_exported_sensitive" : "programme.report_exported",
        entity_type: sensitive ? "programme_fund_flows" : "programmes",
        entity_id: programmeId,
        metadata: {
          programme_id: programmeId,
          row_counts: {
            participants: participantsRaw.length,
            milestones: milestones.length,
            fund_flows: fundFlowsRaw.length,
          },
          sensitive,
          redacted_keys_for_default_view: ["payload_hash", "previous_hash", "idempotency_key", "recorded_by", "reference"],
          timestamp: new Date().toISOString(),
        },
      });

      const report = {
        programme,
        participants,
        milestones: {
          total: milestones.length,
          completed: milestones.filter((m) => m.status === "completed").length,
          overdue: milestones.filter((m) => m.status === "overdue").length,
          pending: milestones.filter((m) => m.status === "pending").length,
          in_progress: milestones.filter((m) => m.status === "in_progress").length,
          items: milestones,
        },
        fund_flow_waterfall: waterfall,
        fund_flow_chain: {
          total_entries: fundFlowsRaw.length,
          chain_integrity_valid: chainValid,
          entries: fundFlowsForView,
        },
        sensitive_view: sensitive,
        generated_at: new Date().toISOString(),
      };
      return jsonResponse(report);
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof ApiException) {
      return jsonResponse({
        error: err.message,
        code: err.code,
        details: err.details ?? null,
      }, err.statusCode);
    }
    console.error("Programme governance error:", err);
    return jsonResponse({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
