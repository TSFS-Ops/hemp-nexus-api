/**
 * engagement-outreach-draft-decision
 * ──────────────────────────────────────────────────────────────────────
 * Phase 1 admin decision endpoint for the AI Outreach Drafter queue.
 *
 *   *** CRITICAL: this function NEVER sends anything. ***
 *
 * Supported actions on a `pending_review` draft:
 *   • edit    — admin replaces the subject/body before approval
 *   • approve — marks the draft as approved (manual send still required)
 *   • reject  — marks the draft as rejected with a review note
 *
 * Illegal transitions (e.g. editing/approving an already-approved or
 * rejected draft) return 409. Non-admins return 403. Every code path
 * writes an audit row.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { clampSubject } from "../_shared/email-subject.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Action = "edit" | "approve" | "reject";

interface ReqBody {
  draft_id: string;
  action: Action;
  subject?: string;
  body?: string;
  review_note?: string;
}

function json(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  );
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  orgId: string | null,
  actorUserId: string | null,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await admin.from("audit_logs").insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action,
      entity_type: "engagement_outreach_draft",
      entity_id: entityId,
      metadata,
    });
  } catch (e) {
    console.warn("[engagement-outreach-draft-decision] audit insert failed", e);
  }
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");
  if (!authHeader) return json(req, { error: "Unauthorised" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return json(req, { error: "Invalid token" }, 401);

  const { data: isAdmin, error: roleErr } = await admin.rpc("is_admin", { user_id: user.id });
  if (roleErr) return json(req, { error: "Authorisation check failed" }, 500);
  if (!isAdmin) {
    await writeAudit(admin, null, user.id, "engagement.outreach_draft.access_denied", null, {
      reason: "not_admin",
      path: "decision",
    });
    return json(req, { error: "Admin access required" }, 403);
  }

  let body: ReqBody;
  try { body = await req.json(); } catch { return json(req, { error: "Invalid JSON" }, 400); }
  if (!body?.draft_id || !body?.action) return json(req, { error: "draft_id and action required" }, 400);
  if (!["edit", "approve", "reject"].includes(body.action)) {
    return json(req, { error: "Unknown action" }, 400);
  }

  const { data: draft, error: dErr } = await admin
    .from("engagement_outreach_drafts")
    .select("*")
    .eq("id", body.draft_id)
    .maybeSingle();
  if (dErr) return json(req, { error: "Could not load draft" }, 500);
  if (!draft) return json(req, { error: "Draft not found" }, 404);

  if (draft.status !== "pending_review") {
    return json(req, {
      error: `Illegal transition: draft is already ${draft.status}`,
      code: "ILLEGAL_TRANSITION",
    }, 409);
  }

  const now = new Date().toISOString();

  if (body.action === "edit") {
    const subject = (body.subject ?? draft.draft_subject).slice(0, 200).trim();
    const draftBody = (body.body ?? draft.draft_body).trim();
    if (!subject || !draftBody) return json(req, { error: "subject and body required" }, 400);

    const { data: updated, error: uErr } = await admin
      .from("engagement_outreach_drafts")
      .update({ draft_subject: subject, draft_body: draftBody })
      .eq("id", draft.id)
      .select("*")
      .single();
    if (uErr) return json(req, { error: "Could not edit draft" }, 500);

    await writeAudit(admin, draft.org_id, user.id, "engagement.outreach_draft.edited", draft.id, {
      engagement_id: draft.engagement_id,
    });
    return json(req, { status: "ok", draft: updated });
  }

  if (body.action === "approve") {
    const { data: updated, error: uErr } = await admin
      .from("engagement_outreach_drafts")
      .update({
        status: "approved",
        approved_by: user.id,
        approved_at: now,
        reviewed_by: user.id,
        reviewed_at: now,
      })
      .eq("id", draft.id)
      .eq("status", "pending_review")
      .select("*")
      .single();
    if (uErr || !updated) return json(req, { error: "Could not approve draft" }, 500);

    await writeAudit(admin, draft.org_id, user.id, "engagement.outreach_draft.approved", draft.id, {
      engagement_id: draft.engagement_id,
      note: "Approved — manual send required. No automated dispatch is wired.",
    });
    return json(req, { status: "ok", draft: updated });
  }

  // reject
  const note = (body.review_note ?? "").trim();
  if (note.length < 3) return json(req, { error: "review_note required (min 3 chars)" }, 400);

  const { data: updated, error: uErr } = await admin
    .from("engagement_outreach_drafts")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: now,
      review_note: note,
    })
    .eq("id", draft.id)
    .eq("status", "pending_review")
    .select("*")
    .single();
  if (uErr || !updated) return json(req, { error: "Could not reject draft" }, 500);

  await writeAudit(admin, draft.org_id, user.id, "engagement.outreach_draft.rejected", draft.id, {
    engagement_id: draft.engagement_id,
    review_note: note,
  });
  return json(req, { status: "ok", draft: updated });
});
