/**
 * facilitation-outreach-send
 *
 * Phase 2 Step 3 — manual single-recipient outreach send. platform_admin only.
 *
 * Server-side guarantees:
 *   - Template must be `status='approved'`
 *   - Re-runs the full outreach gate immediately before dispatch
 *   - Any `block` outcome → 409, no send
 *   - Any `warn` outcome requires the caller to pass the warn reason codes
 *     in `acknowledged_warnings` — otherwise 409 ACK_REQUIRED
 *   - One recipient per call (Zod schema accepts a single candidate_id)
 *   - Idempotent via the `Idempotency-Key` header AND the UNIQUE
 *     (candidate_id, idempotency_key) constraint on
 *     `facilitation_outreach_sends`
 *   - Suppression block enforced via `suppressed_emails`
 *   - Open compliance escalation blocks the send
 *
 * THIS is the ONLY Phase 2 function that contacts a mail provider.
 * No POI / WaD / match / token / credit / payment / poi_engagements /
 * compliance_cases mutation.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { handleHealthProbe } from "../_shared/health.ts";
import { SendRequestSchema } from "../_shared/facilitation-outreach-schemas.ts";
import { GATE_REASON_SEVERITY, type GateReasonCode } from "../_shared/facilitation-outreach-constants.ts";
import { runFullGate, writeOutreachAudit } from "../_shared/facilitation-outreach-context.ts";
import { clampSubject } from "../_shared/email-subject.ts";

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  const __hp = handleHealthProbe(req, "facilitation-outreach-send");
  if (__hp) return __hp;
  if (req.method !== "POST") return j(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authz = req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer ")) return j(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const { data: claims } = await userClient.auth.getClaims(authz.replace("Bearer ", ""));
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return j(req, { error: "Unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" });
  if (!isAdmin) return j(req, { error: "Forbidden", code: "PLATFORM_ADMIN_REQUIRED" }, 403);

  // Honour Idempotency-Key header as the canonical idempotency token; fall
  // back to the value the caller put in the JSON body.
  const headerIdem = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
  let body: any;
  try { body = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  if (headerIdem && !body.idempotency_key) body.idempotency_key = headerIdem;

  const parsed = SendRequestSchema.safeParse(body);
  if (!parsed.success) return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  const { candidate_id, template_id, idempotency_key, acknowledged_warnings } = parsed.data;

  // Idempotent replay short-circuit.
  const { data: prior } = await admin
    .from("facilitation_outreach_sends").select("*")
    .eq("candidate_id", candidate_id).eq("idempotency_key", idempotency_key).maybeSingle();
  if (prior) {
    return j(req, { ok: true, replay: true, send_id: prior.id, status: prior.status }, 200);
  }

  const { data: tpl } = await admin
    .from("facilitation_outreach_templates").select("*").eq("id", template_id).maybeSingle();
  if (!tpl) return j(req, { error: "Template not found" }, 404);
  if (tpl.status !== "approved") {
    return j(req, { error: "Template not approved", code: "TEMPLATE_NOT_APPROVED", template_status: tpl.status }, 409);
  }

  const { data: cand } = await admin
    .from("facilitation_outreach_candidates").select("*").eq("id", candidate_id).maybeSingle();
  if (!cand) return j(req, { error: "Candidate not found" }, 404);

  const { data: kase } = await admin
    .from("facilitation_cases").select("id,requesting_org_id").eq("id", cand.facilitation_case_id).maybeSingle();

  // Re-run full gate immediately before dispatch.
  const gate = await runFullGate(admin, {
    id: cand.id,
    facilitation_case_id: cand.facilitation_case_id,
    contact_email: cand.contact_email,
    org_name: cand.org_name,
  });

  await writeOutreachAudit(admin, {
    action: "facilitation_outreach.gate.evaluated",
    entity_type: "facilitation_outreach_candidate",
    entity_id: cand.id,
    actor_user_id: userId,
    org_id: kase?.requesting_org_id ?? null,
    metadata: {
      stage: "pre_send",
      result: gate.decision.result,
      reasons: gate.decision.reasons,
      template_id,
      idempotency_key,
    },
  });

  if (gate.decision.result === "block") {
    // Audit a `send.blocked` (or `.suppressed` when the only reason is suppression).
    const isOnlySuppression =
      gate.decision.reasons.length === 1 && gate.decision.reasons[0] === "suppression_active";
    const sendStatus = isOnlySuppression ? "suppressed" : "blocked";
    const { data: sendRow } = await admin
      .from("facilitation_outreach_sends").insert({
        candidate_id, template_id, template_version: tpl.version,
        idempotency_key,
        recipient_email: cand.contact_email,
        subject: tpl.subject,
        status: sendStatus,
        send_error: `gate_${gate.decision.result}:${gate.decision.reasons.join(",")}`,
        sent_by: userId,
      }).select("*").maybeSingle();

    await writeOutreachAudit(admin, {
      action: isOnlySuppression
        ? "facilitation_outreach.send.suppressed"
        : "facilitation_outreach.send.blocked",
      entity_type: "facilitation_outreach_send",
      entity_id: sendRow?.id ?? candidate_id,
      actor_user_id: userId,
      org_id: kase?.requesting_org_id ?? null,
      metadata: { candidate_id, template_id, reasons: gate.decision.reasons },
    });

    await admin.from("facilitation_outreach_candidates")
      .update({ outreach_state: isOnlySuppression ? "suppressed" : "blocked", last_gate_evaluated_at: new Date().toISOString() })
      .eq("id", candidate_id);

    return j(req, {
      ok: false,
      blocked: true,
      result: gate.decision.result,
      reasons: gate.decision.reasons,
      send_id: sendRow?.id ?? null,
    }, 409);
  }

  // Warn-level: require explicit acknowledgement of EVERY warn reason.
  if (gate.decision.result === "warn") {
    const warnReasons = gate.decision.reasons.filter(
      (r) => GATE_REASON_SEVERITY[r as GateReasonCode] === "warn",
    );
    const ackSet = new Set(acknowledged_warnings);
    const missing = warnReasons.filter((r) => !ackSet.has(r));
    if (missing.length > 0) {
      return j(req, {
        error: "Warning acknowledgement required",
        code: "ACK_REQUIRED",
        missing_acknowledgements: missing,
        reasons: gate.decision.reasons,
      }, 409);
    }
  }

  // Dispatch via Resend (only one recipient; Step 3 contract).
  if (!RESEND_API_KEY) {
    return j(req, { error: "Email provider not configured", code: "RESEND_NOT_CONFIGURED" }, 500);
  }

  let sendStatus: "sent" | "failed" = "sent";
  let sendError: string | null = null;
  let providerId: string | null = null;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
      },
      body: JSON.stringify({
        from: "izenzo <noreply@izenzo.co.za>",
        to: [cand.contact_email],
        subject: clampSubject(tpl.subject),
        text: tpl.body_text,
        html: tpl.body_html ?? undefined,
      }),
    });
    if (!resp.ok) {
      sendStatus = "failed";
      sendError = `resend_${resp.status}:${await resp.text()}`;
    } else {
      const r = await resp.json();
      providerId = r?.id ?? null;
    }
  } catch (e) {
    sendStatus = "failed";
    sendError = String(e);
  }

  const { data: sendRow } = await admin
    .from("facilitation_outreach_sends").insert({
      candidate_id, template_id, template_version: tpl.version,
      idempotency_key,
      recipient_email: cand.contact_email,
      subject: clampSubject(tpl.subject),
      status: sendStatus,
      send_error: sendError,
      sent_by: userId,
      sent_at: sendStatus === "sent" ? new Date().toISOString() : null,
    }).select("*").maybeSingle();

  await admin.from("facilitation_outreach_candidates")
    .update({ outreach_state: sendStatus === "sent" ? "sent" : "ready", last_gate_evaluated_at: new Date().toISOString() })
    .eq("id", candidate_id);

  await writeOutreachAudit(admin, {
    action: "facilitation_outreach.send.dispatched",
    entity_type: "facilitation_outreach_send",
    entity_id: sendRow?.id ?? candidate_id,
    actor_user_id: userId,
    org_id: kase?.requesting_org_id ?? null,
    metadata: {
      candidate_id, template_id, status: sendStatus,
      provider_message_id: providerId,
      acknowledged_warnings,
      gate_reasons: gate.decision.reasons,
      send_error: sendError,
    },
  });

  return j(req, {
    ok: sendStatus === "sent",
    send_id: sendRow?.id ?? null,
    status: sendStatus,
    provider_message_id: providerId,
    reasons: gate.decision.reasons,
  }, sendStatus === "sent" ? 200 : 502);
});
