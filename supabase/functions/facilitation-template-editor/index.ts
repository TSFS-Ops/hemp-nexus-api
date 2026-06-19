/**
 * facilitation-template-editor — Facilitation Batch 12.
 *
 * Admin-only editor for facilitation outreach templates. Allowed actions:
 *   - create_draft
 *   - update_draft
 *   - submit_for_approval
 *
 * Hard guarantees (enforced by tests + check-facilitation-template-editor-contract.mjs):
 *   - NEVER sends email / Slack / SMS / WhatsApp / webhook / notification.
 *   - NEVER approves a template (approval stays on
 *     facilitation-outreach-template-status; that function also blocks
 *     drafter-self-approval).
 *   - NEVER edits an approved or archived template directly. A correction
 *     to an approved template is expressed as a new draft row linked via
 *     `previous_template_id`.
 *   - NEVER mutates POI / WaD / match / token / credit / payment / refund
 *     / fund-flow / case status / SLA / dispute / verification /
 *     compliance clearance / requester-safe notification triggers.
 *   - Restricted to platform_admin OR compliance_analyst.
 */
import { createClient } from "npm:@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { clampSubject } from "../_shared/email-subject.ts";
import {
  FACILITATION_TEMPLATE_EDITOR_ACTIONS,
  FACILITATION_TEMPLATE_AUDIT_NAMES,
  findForbiddenBodyMatches,
  isEditableStatus,
  submittedMarker,
} from "../_shared/facilitation-template-editor.ts";

// deno-lint-ignore no-explicit-any
type SupaClient = any;

const headers = { "Content-Type": "application/json" };
const j = (req: Request, body: unknown, status = 200) =>
  withCors(req, new Response(JSON.stringify(body), { status, headers }));

const SLUG_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const CreateDraftSchema = z.object({
  action: z.literal("create_draft"),
  slug: z.string().min(2).max(120).regex(SLUG_RE, "slug must be kebab/snake-case lowercase"),
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(2000),
  body_text: z.string().min(1).max(20000),
  body_html: z.string().max(40000).optional().nullable(),
  previous_template_id: z.string().uuid().optional().nullable(),
});

const UpdateDraftSchema = z.object({
  action: z.literal("update_draft"),
  template_id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(2000).optional(),
  body_text: z.string().min(1).max(20000).optional(),
  body_html: z.string().max(40000).optional().nullable(),
});

const SubmitForApprovalSchema = z.object({
  action: z.literal("submit_for_approval"),
  template_id: z.string().uuid(),
});

const EditorBodySchema = z.discriminatedUnion("action", [
  CreateDraftSchema,
  UpdateDraftSchema,
  SubmitForApprovalSchema,
]);

async function writeTemplateAudit(
  admin: SupaClient,
  args: {
    action: (typeof FACILITATION_TEMPLATE_AUDIT_NAMES)[number];
    template_id: string;
    actor_user_id: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: "00000000-0000-0000-0000-000000000000",
      action: args.action,
      entity_type: "facilitation_outreach_template",
      entity_id: args.template_id,
      actor_user_id: args.actor_user_id,
      metadata: args.metadata ?? {},
    });
  } catch (e) {
    console.warn("[facilitation-template-editor] audit insert failed", args.action, e);
  }
}

function validateBodySafety(body_text: string, body_html: string | null | undefined) {
  const hits = [
    ...findForbiddenBodyMatches(body_text).map((l) => `body_text: ${l}`),
    ...findForbiddenBodyMatches(body_html ?? "").map((l) => `body_html: ${l}`),
  ];
  return hits;
}

Deno.serve(async (req) => {
  const pf = handleCorsPreflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return j(req, { error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authz = req.headers.get("Authorization");
  if (!authz?.startsWith("Bearer ")) return j(req, { error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authz } } });
  const token = authz.replace("Bearer ", "");
  const { data: claims } = await userClient.auth.getClaims(token);
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return j(req, { error: "Unauthorized" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const [pa, ca] = await Promise.all([
    admin.rpc("has_role", { _user_id: userId, _role: "platform_admin" }),
    admin.rpc("has_role", { _user_id: userId, _role: "compliance_analyst" }),
  ]);
  if (!pa.data && !ca.data) {
    return j(req, { error: "Forbidden", code: "TEMPLATE_EDITOR_ROLE_REQUIRED" }, 403);
  }

  let raw: unknown;
  try { raw = await req.json(); } catch { return j(req, { error: "Invalid JSON" }, 400); }
  const parsed = EditorBodySchema.safeParse(raw);
  if (!parsed.success) {
    return j(req, { error: "Validation failed", details: parsed.error.flatten() }, 400);
  }
  const body = parsed.data;

  // Defence in depth: the editor must NEVER widen its allow-list.
  if (!FACILITATION_TEMPLATE_EDITOR_ACTIONS.includes(body.action as typeof FACILITATION_TEMPLATE_EDITOR_ACTIONS[number])) {
    return j(req, { error: "Action not allowed", code: "EDITOR_ACTION_FORBIDDEN" }, 400);
  }

  const now = new Date();

  // ───────────────────────── create_draft ───────────────────────────────
  if (body.action === "create_draft") {
    const subjectClamped = clampSubject(body.subject);
    const forbidden = validateBodySafety(body.body_text, body.body_html);
    if (forbidden.length > 0) {
      return j(req, { error: "Forbidden content in template body", details: forbidden }, 400);
    }

    let nextVersion = 1;
    if (body.previous_template_id) {
      const { data: prev, error: perr } = await admin
        .from("facilitation_outreach_templates")
        .select("id,status,version,slug")
        .eq("id", body.previous_template_id)
        .maybeSingle();
      if (perr) return j(req, { error: perr.message }, 500);
      if (!prev) return j(req, { error: "Previous template not found" }, 404);
      if (prev.status !== "approved") {
        return j(req, { error: "previous_template_id must reference an approved template" }, 400);
      }
      nextVersion = (prev.version ?? 1) + 1;
    }

    const insertRow = {
      slug: body.slug,
      name: body.name,
      subject: subjectClamped,
      body_text: body.body_text,
      body_html: body.body_html ?? null,
      status: "draft",
      version: nextVersion,
      created_by: userId,
      previous_template_id: body.previous_template_id ?? null,
    };

    const { data: ins, error: ierr } = await admin
      .from("facilitation_outreach_templates")
      .insert(insertRow)
      .select("id,slug,name,subject,body_text,body_html,status,version,previous_template_id,created_by")
      .single();
    if (ierr) {
      const isUnique = /duplicate key|unique/i.test(ierr.message ?? "");
      return j(req, { error: isUnique ? "slug already exists" : ierr.message }, isUnique ? 409 : 500);
    }

    await writeTemplateAudit(admin, {
      action: "facilitation_template.draft_created",
      template_id: ins.id as string,
      actor_user_id: userId,
      metadata: {
        slug: ins.slug,
        version: ins.version,
        previous_template_id: ins.previous_template_id,
      },
    });

    return j(req, { ok: true, template: ins });
  }

  // ───────────────────────── update_draft ───────────────────────────────
  if (body.action === "update_draft") {
    const { data: tpl, error: terr } = await admin
      .from("facilitation_outreach_templates")
      .select("*")
      .eq("id", body.template_id)
      .maybeSingle();
    if (terr) return j(req, { error: terr.message }, 500);
    if (!tpl) return j(req, { error: "Template not found" }, 404);
    if (!isEditableStatus(tpl.status)) {
      return j(req, {
        error: "Only draft templates can be edited",
        code: "TEMPLATE_NOT_EDITABLE",
        status: tpl.status,
      }, 409);
    }

    const patch: Record<string, unknown> = { updated_at: now.toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.subject !== undefined) patch.subject = clampSubject(body.subject);
    if (body.body_text !== undefined) patch.body_text = body.body_text;
    if (body.body_html !== undefined) patch.body_html = body.body_html;

    const forbidden = validateBodySafety(
      (patch.body_text as string | undefined) ?? tpl.body_text,
      (patch.body_html as string | null | undefined) ?? tpl.body_html ?? null,
    );
    if (forbidden.length > 0) {
      return j(req, { error: "Forbidden content in template body", details: forbidden }, 400);
    }

    const { data: upd, error: uerr } = await admin
      .from("facilitation_outreach_templates")
      .update(patch)
      .eq("id", body.template_id)
      .eq("status", "draft") // race guard
      .select("id,slug,name,subject,body_text,body_html,status,version,previous_template_id")
      .single();
    if (uerr) return j(req, { error: uerr.message }, 500);

    await writeTemplateAudit(admin, {
      action: "facilitation_template.draft_updated",
      template_id: body.template_id,
      actor_user_id: userId,
      metadata: { fields_changed: Object.keys(patch).filter((k) => k !== "updated_at") },
    });

    return j(req, { ok: true, template: upd });
  }

  // ───────────────────────── submit_for_approval ────────────────────────
  if (body.action === "submit_for_approval") {
    const { data: tpl, error: terr } = await admin
      .from("facilitation_outreach_templates")
      .select("id,status,submitted_for_approval_at")
      .eq("id", body.template_id)
      .maybeSingle();
    if (terr) return j(req, { error: terr.message }, 500);
    if (!tpl) return j(req, { error: "Template not found" }, 404);
    if (tpl.status !== "draft") {
      return j(req, {
        error: "Only draft templates can be submitted for approval",
        code: "TEMPLATE_NOT_DRAFT",
        status: tpl.status,
      }, 409);
    }

    const marker = submittedMarker(now, userId);
    const { data: upd, error: uerr } = await admin
      .from("facilitation_outreach_templates")
      .update({ ...marker, updated_at: now.toISOString() })
      .eq("id", body.template_id)
      .eq("status", "draft")
      .select("id,status,submitted_for_approval_at,submitted_for_approval_by")
      .single();
    if (uerr) return j(req, { error: uerr.message }, 500);

    // Audit submission as a draft_updated event (no new audit name introduced
    // beyond the Batch 12 family of two).
    await writeTemplateAudit(admin, {
      action: "facilitation_template.draft_updated",
      template_id: body.template_id,
      actor_user_id: userId,
      metadata: { submitted_for_approval: true },
    });

    return j(req, { ok: true, template: upd });
  }

  return j(req, { error: "Unhandled action" }, 400);
});
