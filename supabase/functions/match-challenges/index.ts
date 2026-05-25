// Batch C Phase 2 — Match Challenges RPC harness.
//
// Service-role-owned write path for the public.match_challenges family.
// RLS denies UPDATE / DELETE on these tables for `authenticated`; this
// function is the single legitimate write surface, with caller-validation
// enforced server-side and storage paths constructed (never accepted from
// the client) so evidence cannot be written to a wrong match/challenge.
//
// Routes (all POST):
//   /match-challenges/raise               — create a new challenge
//   /match-challenges/comment             — add a comment to an open/under_review challenge
//   /match-challenges/transition          — state-machine transition (party admins / platform_admin)
//   /match-challenges/upload-evidence     — base64 upload, server constructs storage path
//   /match-challenges/break-glass         — platform_admin override (>=60 char reason)
//
// All responses return JSON with consistent CORS. Errors use stable codes:
//   FORBIDDEN, VALIDATION_ERROR, NOT_FOUND, INVALID_TRANSITION,
//   CHALLENGE_TERMINAL, EVIDENCE_PATH_MISMATCH, BREAK_GLASS_REASON_TOO_SHORT
//
// Rating-emission: NONE. The admin-settings flag governing this remains disabled by default.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { readAal } from "../_shared/aal.ts";
import { resolveNotificationsFor } from "../_shared/resolve-notifications.ts";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "../_shared/governance-audit-integration.ts";
import { DISPUTE_POLICY_VERSION } from "../_shared/governance-policy-versions.ts";

/**
 * Batch J Required Fix 2 — AAL2 gate.
 * Returns null on pass; an `err()` Response on fail. Best-effort audit
 * is written when failing so denials are visible to compliance.
 */
async function requireAal2(
  // deno-lint-ignore no-explicit-any
  admin: any,
  authHeader: string | null,
  callerUserId: string,
  action: string,
  context: Record<string, unknown>,
): Promise<Response | null> {
  const aal = readAal(authHeader);
  if (aal === "aal2") return null;
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: callerUserId,
      action: "match_challenge.mfa_required_denied",
      target_type: "match_challenge",
      target_id: (context.challenge_id as string | null) ?? null,
      details: {
        attempted_action: action,
        observed_aal: aal,
        ...context,
      },
    });
  } catch (e) {
    console.error("[match-challenges] aal2 denial audit failed:", e);
  }
  return err(
    "MFA_REQUIRED",
    "This action requires multi-factor authentication. Enrol an authenticator app and complete an MFA challenge before retrying.",
    403,
    { observed_aal: aal },
  );
}

/**
 * Batch J Required Fix 1 — edge-level admin_audit_logs writer.
 *
 * Every challenge mutation produces one application-level audit row from
 * this function — independent of any RPC-level audit and independent of
 * the storage/document audit trail used by Required Fix 6 (orphan cleanup).
 * The row is best-effort: insert errors are logged and swallowed so the
 * user-visible response is never blocked by an audit write failure.
 */
async function writeChallengeAudit(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: {
    action:
      | "match_challenge.raised"
      | "match_challenge.commented"
      | "match_challenge.transitioned"
      | "match_challenge.evidence_uploaded"
      | "match_challenge.break_glass";
    challengeId: string | null;
    matchId: string | null;
    actorUserId: string;
    actorOrgId: string | null;
    beforeStatus?: string | null;
    afterStatus?: string | null;
    requestId?: string | null;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("admin_audit_logs").insert({
      admin_user_id: args.actorUserId,
      action: args.action,
      target_type: "match_challenge",
      target_id: args.challengeId,
      details: {
        challenge_id: args.challengeId,
        match_id: args.matchId,
        actor_user_id: args.actorUserId,
        actor_org_id: args.actorOrgId,
        before_status: args.beforeStatus ?? null,
        after_status: args.afterStatus ?? null,
        request_id: args.requestId ?? null,
        source: "match-challenges",
        ...(args.extra ?? {}),
      },
    });
  } catch (e) {
    console.error("[match-challenges] audit insert failed (non-fatal):", e);
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const TERMINAL_STATUSES = new Set([
  "withdrawn",
  "outcome_recorded",
  "closed_no_action",
]);

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  open: new Set(["under_review", "withdrawn", "closed_no_action"]),
  under_review: new Set(["outcome_recorded", "closed_no_action"]),
};

const SUBJECT_CODES = [
  "terms_disagreement",
  "evidence_quality_concern",
  "identity_concern",
  "compliance_concern",
  "delivery_or_settlement_concern",
  "other",
] as const;

const ROLES = ["buyer_org_admin", "seller_org_admin", "platform_admin"] as const;

const OUTCOME_CODES = [
  "no_action_required",
  "corrected_and_proceed",
  "withdrawn_by_raiser",
  "superseded_by_updated_terms",
  "evidence_required",
  "cannot_proceed",
  "admin_override_recorded",
] as const;

const RaiseSchema = z.object({
  match_id: z.string().uuid(),
  raised_by_role: z.enum(ROLES),
  raised_by_org_id: z.string().uuid().nullable().optional(),
  subject_code: z.enum(SUBJECT_CODES),
  summary: z.string().min(20).max(2000),
});

const CommentSchema = z.object({
  challenge_id: z.string().uuid(),
  author_role: z.enum(ROLES),
  author_org_id: z.string().uuid().nullable().optional(),
  body: z.string().min(5).max(4000),
});

const TransitionSchema = z.object({
  challenge_id: z.string().uuid(),
  to_status: z.enum(["under_review", "withdrawn", "outcome_recorded", "closed_no_action"]),
  outcome_code: z.enum(OUTCOME_CODES).nullable().optional(),
  outcome_summary: z.string().min(40).max(8000).nullable().optional(),
});

const UploadSchema = z.object({
  challenge_id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(255),
  content_base64: z.string().min(8),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
});

const OVERRIDE_REASON_CATEGORIES = [
  "documentation_corrected_commercial_confirmation_received",
  "compliance_review_completed",
  "regulator_or_authority_instruction",
  "platform_risk_review_completed",
  "duplicate_or_erroneous_challenge",
  "other_governance_reason",
] as const;

const BreakGlassSchema = z.object({
  match_id: z.string().uuid(),
  reason: z.string().min(60).max(8000),
  reason_category: z.enum(OVERRIDE_REASON_CATEGORIES).optional(),
  internal_approval_reference: z.string().trim().min(1).max(200).optional(),
  regulator_reference: z.string().trim().max(200).optional(),
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(code: string, message: string, status: number, extra?: Record<string, unknown>): Response {
  return json({ error: code, message, ...(extra ?? {}) }, status);
}

async function authenticate(req: Request): Promise<
  | { ok: true; userId: string; orgId: string | null; isPlatformAdmin: boolean }
  | { ok: false; resp: Response }
> {
  const authz = req.headers.get("authorization");
  if (!authz?.startsWith("Bearer ")) {
    return { ok: false, resp: err("UNAUTHORIZED", "Missing bearer token", 401) };
  }
  const token = authz.slice(7);
  // Validate the JWT explicitly via GoTrue (supabase-js v2 does NOT pick up the
  // Authorization header for getUser() — must pass the token positionally).
  const userClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, resp: err("UNAUTHORIZED", "Invalid session", 401) };
  }
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const [profileRes, adminRes] = await Promise.all([
    admin.from("profiles").select("org_id").eq("id", userId).maybeSingle(),
    // public.is_admin signature is (user_id uuid) — must match exactly or PostgREST 404s.
    admin.rpc("is_admin", { user_id: userId }),
  ]);
  return {
    ok: true,
    userId,
    orgId: (profileRes.data?.org_id as string | null) ?? null,
    isPlatformAdmin: !!adminRes.data,
  };
}

async function fetchMatch(admin: ReturnType<typeof createClient>, matchId: string) {
  const { data, error } = await admin
    .from("matches")
    .select("id, buyer_org_id, seller_org_id, org_id")
    .eq("id", matchId)
    .maybeSingle();
  return { match: data, error };
}

async function fetchChallenge(admin: ReturnType<typeof createClient>, challengeId: string) {
  const { data, error } = await admin
    .from("match_challenges")
    .select("id, match_id, org_id, status, raised_by_user_id, raised_by_org_id, raised_by_role")
    .eq("id", challengeId)
    .maybeSingle();
  return { challenge: data, error };
}

async function isOrgAdminOf(
  admin: ReturnType<typeof createClient>,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await admin.rpc("is_org_admin", {
    _user_id: userId,
    _org_id: orgId,
  });
  return !!data;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/match-challenges\/?/, "");

  if (req.method !== "POST") {
    return err("METHOD_NOT_ALLOWED", "POST required", 405);
  }

  const auth = await authenticate(req);
  if (!auth.ok) return auth.resp;
  const { userId, orgId, isPlatformAdmin } = auth;
  const authHeader = req.headers.get("authorization");
  const requestId =
    req.headers.get("x-request-id") ?? crypto.randomUUID();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  try {
    switch (route) {
      // ─────────────────────────────────────────────────────────────
      case "raise": {
        const parsed = RaiseSchema.safeParse(body);
        if (!parsed.success) {
          return err("VALIDATION_ERROR", "Invalid input", 400, { issues: parsed.error.flatten() });
        }
        const p = parsed.data;
        const { match, error: mErr } = await fetchMatch(admin, p.match_id);
        if (mErr || !match) return err("NOT_FOUND", "Match not found", 404);

        // Role-shape enforcement (mirrors the RLS strict-shape policy).
        if (p.raised_by_role === "platform_admin") {
          if (!isPlatformAdmin) return err("FORBIDDEN", "Only platform admins may raise as platform_admin", 403);
          if (p.raised_by_org_id) {
            return err("VALIDATION_ERROR", "platform_admin rows must have raised_by_org_id = null", 400);
          }
        } else {
          if (!p.raised_by_org_id) {
            return err("VALIDATION_ERROR", "Party-raised rows require raised_by_org_id", 400);
          }
          const expected =
            p.raised_by_role === "buyer_org_admin" ? match.buyer_org_id : match.seller_org_id;
          if (p.raised_by_org_id !== expected) {
            return err("VALIDATION_ERROR", "raised_by_org_id must match the corresponding side of the match", 400);
          }
          if (!(await isOrgAdminOf(admin, userId, p.raised_by_org_id))) {
            return err("FORBIDDEN", "Caller is not an admin of the raising org", 403);
          }
        }

        const insertOrgId =
          p.raised_by_role === "platform_admin" ? (match.org_id ?? match.buyer_org_id) : p.raised_by_org_id!;

        // Atomic dispute open: insert match_challenges + emit dispute.opened
        // in a single SECURITY DEFINER transaction (atomic_dispute_open).
        const disputeOpenGovPayload = {
          actor_user_id: userId,
          actor_role: p.raised_by_role,
          source_function: "match-challenges",
          request_id: requestId,
          new_state: "open",
          allowed_or_blocked: "allowed",
          reason_code: p.subject_code,
          posture_snapshot: buildPostureSnapshot("Standard", {
            policy_version: DISPUTE_POLICY_VERSION,
            check_status: { raised_by_role: p.raised_by_role },
          }),
          metadata: {
            subject_code: p.subject_code,
            summary_length: p.summary.length,
            policy_version: DISPUTE_POLICY_VERSION,
          },
          idempotency_key: `${p.match_id}|dispute.opened|${requestId}|raised`,
        };

        const { data: openResult, error: openErr } = await admin.rpc(
          "atomic_dispute_open",
          {
            p_input: {
              match_id: p.match_id,
              org_id: insertOrgId,
              raised_by_org_id: p.raised_by_org_id ?? null,
              raised_by_user_id: userId,
              raised_by_role: p.raised_by_role,
              subject_code: p.subject_code,
              summary: p.summary,
            },
            p_governance: disputeOpenGovPayload,
          },
        );
        if (openErr) {
          return err("DB_ERROR", openErr.message, 400);
        }
        const openR = openResult as {
          success: boolean;
          error?: string;
          message?: string;
          challenge_id?: string;
          created_at?: string;
          status?: string;
          governance_event_id?: string | null;
        } | null;
        if (!openR?.success) {
          if (openR?.error === "CHALLENGE_ALREADY_OPEN") {
            return err("CHALLENGE_ALREADY_OPEN", openR.message ?? "An open challenge already exists for this match", 409);
          }
          console.error("[match-challenges] CRITICAL: atomic_dispute_open failed:", openR);
          return err("GOV_AUDIT_WRITE_FAILED", "Challenge raise rolled back: governance proof write failed", 500);
        }
        if (!openR.governance_event_id) {
          return err("GOV_AUDIT_WRITE_FAILED", "Dispute open atomic RPC did not return governance_event_id", 500);
        }
        const row = {
          id: openR.challenge_id!,
          match_id: p.match_id,
          org_id: insertOrgId,
          raised_by_org_id: p.raised_by_org_id ?? null,
          raised_by_user_id: userId,
          raised_by_role: p.raised_by_role,
          subject_code: p.subject_code,
          summary: p.summary,
          status: openR.status ?? "open",
          created_at: openR.created_at ?? null,
        };
        await writeChallengeAudit(admin, {
          action: "match_challenge.raised",
          challengeId: row.id,
          matchId: p.match_id,
          actorUserId: userId,
          actorOrgId: orgId,
          afterStatus: "open",
          requestId,
          extra: { subject_code: p.subject_code, raised_by_role: p.raised_by_role },
        });
        return json({ challenge: row }, 201);

      }

      // ─────────────────────────────────────────────────────────────
      case "comment": {
        const parsed = CommentSchema.safeParse(body);
        if (!parsed.success) return err("VALIDATION_ERROR", "Invalid input", 400, { issues: parsed.error.flatten() });
        const p = parsed.data;
        const { challenge } = await fetchChallenge(admin, p.challenge_id);
        if (!challenge) return err("NOT_FOUND", "Challenge not found", 404);
        if (TERMINAL_STATUSES.has(challenge.status)) {
          return err("CHALLENGE_TERMINAL", `Challenge is ${challenge.status}; comments are closed`, 409);
        }
        // Caller must be platform_admin or party org_admin on the match.
        if (!isPlatformAdmin) {
          const { match } = await fetchMatch(admin, challenge.match_id);
          if (!match) return err("NOT_FOUND", "Match not found", 404);
          const buyerAdmin = match.buyer_org_id ? await isOrgAdminOf(admin, userId, match.buyer_org_id) : false;
          const sellerAdmin = match.seller_org_id ? await isOrgAdminOf(admin, userId, match.seller_org_id) : false;
          if (!buyerAdmin && !sellerAdmin) {
            return err("FORBIDDEN", "Only party org admins or platform admins may comment", 403);
          }
        }

        const { data: row, error: insErr } = await admin
          .from("match_challenge_comments")
          .insert({
            challenge_id: p.challenge_id,
            author_user_id: userId,
            author_org_id: p.author_org_id ?? null,
            author_role: p.author_role,
            body: p.body,
          })
          .select("*")
          .single();
        if (insErr) return err("DB_ERROR", insErr.message, 400);
        await writeChallengeAudit(admin, {
          action: "match_challenge.commented",
          challengeId: p.challenge_id,
          matchId: challenge.match_id,
          actorUserId: userId,
          actorOrgId: p.author_org_id ?? orgId,
          requestId,
          extra: { author_role: p.author_role, comment_id: row.id, body_length: p.body.length },
        });
        return json({ comment: row }, 201);
      }

      // ─────────────────────────────────────────────────────────────
      case "transition": {
        const parsed = TransitionSchema.safeParse(body);
        if (!parsed.success) return err("VALIDATION_ERROR", "Invalid input", 400, { issues: parsed.error.flatten() });
        const p = parsed.data;
        const { challenge } = await fetchChallenge(admin, p.challenge_id);
        if (!challenge) return err("NOT_FOUND", "Challenge not found", 404);

        if (TERMINAL_STATUSES.has(challenge.status)) {
          return err("CHALLENGE_TERMINAL", `Challenge is already terminal (${challenge.status})`, 409);
        }
        const allowed = VALID_TRANSITIONS[challenge.status];
        if (!allowed || !allowed.has(p.to_status)) {
          return err("INVALID_TRANSITION", `Cannot transition ${challenge.status} -> ${p.to_status}`, 409);
        }

        // Caller validation per transition:
        //  • withdrawn  → only the original raising user (or platform_admin)
        //  • under_review / outcome_recorded / closed_no_action → platform_admin only
        if (p.to_status === "withdrawn") {
          const isRaiser = challenge.raised_by_user_id === userId;
          if (!isRaiser && !isPlatformAdmin) {
            return err("FORBIDDEN", "Only the original raiser or platform_admin may withdraw a challenge", 403);
          }
        } else {
          if (!isPlatformAdmin) {
            return err("FORBIDDEN", "Only platform_admin may move a challenge through review/outcome states", 403);
          }
        }

        // AAL2 enforcement: any platform_admin-driven transition + any
        // closure (outcome_recorded / closed_no_action) requires MFA.
        const sensitive =
          p.to_status === "outcome_recorded" ||
          p.to_status === "closed_no_action" ||
          (isPlatformAdmin && p.to_status !== "withdrawn");
        if (sensitive) {
          const denial = await requireAal2(admin, authHeader, userId, "match_challenge.transition", {
            challenge_id: p.challenge_id,
            match_id: challenge.match_id,
            to_status: p.to_status,
          });
          if (denial) return denial;
        }

        // Outcome shape rules (mirrors DB triggers, surfaced as friendly 400s).
        const update: Record<string, unknown> = { status: p.to_status };
        if (p.to_status === "outcome_recorded") {
          if (!p.outcome_code || p.outcome_code === "withdrawn_by_raiser") {
            return err("VALIDATION_ERROR", "outcome_recorded requires a non-withdrawn outcome_code", 400);
          }
          if (!p.outcome_summary || p.outcome_summary.length < 40) {
            return err("VALIDATION_ERROR", "outcome_recorded requires outcome_summary >= 40 chars", 400);
          }
          update.outcome_code = p.outcome_code;
          update.outcome_summary = p.outcome_summary;
          update.closed_by_user_id = userId;
        } else if (p.to_status === "closed_no_action") {
          if (!p.outcome_summary || p.outcome_summary.length < 40) {
            return err("VALIDATION_ERROR", "closed_no_action requires outcome_summary >= 40 chars", 400);
          }
          update.outcome_code = p.outcome_code ?? "no_action_required";
          update.outcome_summary = p.outcome_summary;
          update.closed_by_user_id = userId;
        } else if (p.to_status === "withdrawn") {
          update.outcome_code = "withdrawn_by_raiser";
          update.outcome_summary =
            p.outcome_summary ?? "Withdrawn by the raising party prior to platform review.";
          update.closed_by_user_id = userId;
        }

        const isTerminal = TERMINAL_STATUSES.has(p.to_status);

        // Build governance payload for terminal transitions (the RPC only
        // emits when terminal; passing it for non-terminal is harmless).
        const disputeTransitionGovPayload = isTerminal
          ? {
              actor_user_id: userId,
              actor_role: isPlatformAdmin ? "platform_admin" : "org_admin",
              source_function: "match-challenges",
              request_id: requestId,
              match_id: challenge.match_id,
              previous_state: challenge.status,
              new_state: p.to_status,
              event_type: p.to_status === "withdrawn" ? "dispute.released" : "dispute.closed",
              allowed_or_blocked: p.to_status === "withdrawn" ? "neutral" : "allowed",
              reason_code: (update.outcome_code as string | undefined) ?? p.to_status,
              posture_snapshot: buildPostureSnapshot("Standard", {
                policy_version: DISPUTE_POLICY_VERSION,
                check_status: { via_platform_admin: isPlatformAdmin, to_status: p.to_status },
              }),
              metadata: {
                outcome_code: (update.outcome_code as string | undefined) ?? null,
                outcome_summary_length:
                  typeof update.outcome_summary === "string" ? update.outcome_summary.length : 0,
                policy_version: DISPUTE_POLICY_VERSION,
              },
              idempotency_key: `${p.challenge_id}|${p.to_status === "withdrawn" ? "dispute.released" : "dispute.closed"}|${requestId}|${p.to_status}`,
            }
          : null;

        const { data: transitionResult, error: transErr } = await admin.rpc(
          "atomic_dispute_transition",
          {
            p_input: {
              challenge_id: p.challenge_id,
              expected_from_status: challenge.status,
              to_status: p.to_status,
              outcome_code: (update.outcome_code as string | undefined) ?? null,
              outcome_summary: (update.outcome_summary as string | undefined) ?? null,
              closed_by_user_id: (update.closed_by_user_id as string | undefined) ?? null,
            },
            p_governance: disputeTransitionGovPayload,
          },
        );
        if (transErr) {
          return err("INVALID_TRANSITION", transErr.message, 409);
        }
        const tR = transitionResult as {
          success: boolean;
          error?: string;
          message?: string;
          current_status?: string;
          challenge_id?: string;
          previous_state?: string;
          new_state?: string;
          terminal?: boolean;
          governance_event_id?: string | null;
        } | null;
        if (!tR?.success) {
          if (tR?.error === "NOT_FOUND") {
            return err("NOT_FOUND", "Challenge not found", 404);
          }
          if (tR?.error === "CONFLICT") {
            return err("CONFLICT", tR.message ?? "Challenge state changed concurrently; please reload", 409);
          }
          if (tR?.error === "INVALID_INPUT") {
            return err("VALIDATION_ERROR", tR.message ?? "Invalid input", 400);
          }
          console.error("[match-challenges] CRITICAL: atomic_dispute_transition failed:", tR);
          return err("GOV_AUDIT_WRITE_FAILED", "Challenge transition rolled back: governance proof write failed", 500);
        }
        if (isTerminal && !tR.governance_event_id) {
          return err("GOV_AUDIT_WRITE_FAILED", "Dispute transition atomic RPC did not return governance_event_id", 500);
        }

        // Re-fetch the updated row for the response (RPC returns minimal shape).
        const { data: row } = await admin
          .from("match_challenges")
          .select("*")
          .eq("id", p.challenge_id)
          .maybeSingle();

        await writeChallengeAudit(admin, {
          action: "match_challenge.transitioned",
          challengeId: p.challenge_id,
          matchId: challenge.match_id,
          actorUserId: userId,
          actorOrgId: orgId,
          beforeStatus: challenge.status,
          afterStatus: p.to_status,
          requestId,
          extra: {
            outcome_code: (update.outcome_code as string | undefined) ?? null,
            via_platform_admin: isPlatformAdmin,
          },
        });
        // NOT-008: terminal closures should clear any unread challenge notifications.
        if (isTerminal) {
          await resolveNotificationsFor(admin, "match_challenge", p.challenge_id, {
            requestId,
            source: `match-challenges:transitioned_${p.to_status}`,
          });
        }
        return json({ challenge: row }, 200);

      }

      // ─────────────────────────────────────────────────────────────
      case "upload-evidence": {
        const parsed = UploadSchema.safeParse(body);
        if (!parsed.success) return err("VALIDATION_ERROR", "Invalid input", 400, { issues: parsed.error.flatten() });
        const p = parsed.data;
        const { challenge } = await fetchChallenge(admin, p.challenge_id);
        if (!challenge) return err("NOT_FOUND", "Challenge not found", 404);
        if (TERMINAL_STATUSES.has(challenge.status)) {
          return err("CHALLENGE_TERMINAL", `Cannot upload evidence to ${challenge.status} challenge`, 409);
        }

        // Caller must be platform_admin or party org_admin on the match.
        let callerOrgId: string | null = null;
        if (!isPlatformAdmin) {
          const { match } = await fetchMatch(admin, challenge.match_id);
          if (!match) return err("NOT_FOUND", "Match not found", 404);
          const buyerAdmin = match.buyer_org_id ? await isOrgAdminOf(admin, userId, match.buyer_org_id) : false;
          const sellerAdmin = match.seller_org_id ? await isOrgAdminOf(admin, userId, match.seller_org_id) : false;
          if (!buyerAdmin && !sellerAdmin) {
            return err("FORBIDDEN", "Only party org admins or platform admins may upload evidence", 403);
          }
          callerOrgId = buyerAdmin ? match.buyer_org_id : match.seller_org_id;
        }

        // Decode + verify integrity
        let bytes: Uint8Array;
        try {
          bytes = decodeBase64(p.content_base64);
        } catch {
          return err("VALIDATION_ERROR", "content_base64 is not valid base64", 400);
        }
        if (bytes.length === 0) return err("VALIDATION_ERROR", "Empty file", 400);
        if (bytes.length > 25 * 1024 * 1024) return err("VALIDATION_ERROR", "File exceeds 25MB", 400);

        const computedSha = await sha256Hex(bytes);
        if (computedSha.toLowerCase() !== p.sha256.toLowerCase()) {
          return err("VALIDATION_ERROR", "sha256 does not match content", 400);
        }

        // Server constructs the storage path. Client never picks it.
        // Path convention: <match_id>/<challenge_id>/<uuid>-<safe-filename>
        const safeName = p.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
        const objectId = crypto.randomUUID();
        const storagePath = `${challenge.match_id}/${p.challenge_id}/${objectId}-${safeName}`;

        // Defensive: re-validate the constructed path components.
        const segs = storagePath.split("/");
        if (segs[0] !== challenge.match_id || segs[1] !== p.challenge_id) {
          return err("EVIDENCE_PATH_MISMATCH", "Constructed path does not match challenge", 500);
        }

        const { error: upErr } = await admin.storage
          .from("match-challenge-evidence")
          .upload(storagePath, bytes, { contentType: p.mime_type, upsert: false });
        if (upErr) return err("STORAGE_ERROR", upErr.message, 400);

        const { data: row, error: insErr } = await admin
          .from("match_challenge_evidence")
          .insert({
            challenge_id: p.challenge_id,
            uploaded_by_user_id: userId,
            uploaded_by_org_id: callerOrgId,
            storage_path: storagePath,
            filename: safeName,
            mime_type: p.mime_type,
            size_bytes: bytes.length,
            sha256: computedSha,
          })
          .select("*")
          .single();
        if (insErr) {
          // Best-effort cleanup of the orphaned object + audit row so a
          // failed cleanup is never silent (Batch E Required Fix 6).
          const { error: rmErr } = await admin.storage
            .from("match-challenge-evidence")
            .remove([storagePath]);
          await admin.from("audit_logs").insert({
            org_id: callerOrgId,
            actor_user_id: userId,
            action: "document.upload.attempt",
            entity_type: "match_challenge_evidence",
            entity_id: challenge.match_id,
            metadata: {
              phase: rmErr ? "orphan_cleanup" : "cleanup",
              outcome: rmErr ? "failure" : "success",
              storage_path: storagePath,
              bucket: "match-challenge-evidence",
              challenge_id: p.challenge_id,
              db_insert_result: "failure",
              error_code: "DB_ERROR",
              error_message: insErr.message?.slice(0, 2000) ?? null,
              cleanup_attempted: true,
              cleanup_succeeded: !rmErr,
              cleanup_error: rmErr?.message ?? null,
              storage_object_exists: !!rmErr,
            },
          }).then(() => {}, () => {});
          return err("DB_ERROR", insErr.message, 400);
        }
        await writeChallengeAudit(admin, {
          action: "match_challenge.evidence_uploaded",
          challengeId: p.challenge_id,
          matchId: challenge.match_id,
          actorUserId: userId,
          actorOrgId: callerOrgId,
          requestId,
          extra: {
            evidence_id: row.id,
            filename: safeName,
            sha256: computedSha,
            size_bytes: bytes.length,
            mime_type: p.mime_type,
            storage_path: storagePath,
          },
        });
        return json({ evidence: row, storage_path: storagePath }, 201);
      }

      // ─────────────────────────────────────────────────────────────
      case "break-glass": {
        const parsed = BreakGlassSchema.safeParse(body);
        if (!parsed.success) {
          return err("VALIDATION_ERROR", "Invalid input", 400, { issues: parsed.error.flatten() });
        }
        if (!isPlatformAdmin) {
          return err("FORBIDDEN", "Break-glass is restricted to platform admins", 403);
        }
        // AAL2 is mandatory on break-glass in addition to the in-RPC
        // governance checks. Break-glass is the most sensitive override
        // surface in the system.
        const denial = await requireAal2(admin, authHeader, userId, "match_challenge.break_glass", {
          match_id: parsed.data.match_id,
          reason_category: parsed.data.reason_category ?? null,
          internal_approval_reference: parsed.data.internal_approval_reference ?? null,
        });
        if (denial) return denial;

        const regulatorRef = (parsed.data.regulator_reference ?? "").trim();
        const { data, error: rpcErr } = await admin.rpc("platform_admin_break_glass_progress", {
          p_match_id: parsed.data.match_id,
          p_actor_user_id: userId,
          p_reason: parsed.data.reason,
          p_reason_category: parsed.data.reason_category ?? null,
          p_internal_approval_reference: parsed.data.internal_approval_reference ?? null,
          p_regulator_reference: regulatorRef.length === 0 ? null : regulatorRef,
        });
        if (rpcErr) {
          const msg = rpcErr.message || "";
          if (msg.includes("at least 60")) {
            return err("BREAK_GLASS_REASON_TOO_SHORT", msg, 400);
          }
          if (msg.includes("no open challenge")) {
            return err("NOT_FOUND", msg, 404);
          }
          if (msg.includes("only platform_admin")) {
            return err("FORBIDDEN", msg, 403);
          }
          return err("DB_ERROR", msg, 400);
        }
        await writeChallengeAudit(admin, {
          action: "match_challenge.break_glass",
          challengeId: (data as { id?: string } | null)?.id ?? null,
          matchId: parsed.data.match_id,
          actorUserId: userId,
          actorOrgId: orgId,
          afterStatus: (data as { status?: string } | null)?.status ?? null,
          requestId,
          extra: {
            reason_category: parsed.data.reason_category ?? null,
            internal_approval_reference: parsed.data.internal_approval_reference ?? null,
            regulator_reference: regulatorRef.length === 0 ? null : regulatorRef,
            reason_length: parsed.data.reason.length,
          },
        });
        return json({ challenge: data }, 200);
      }

      default:
        return err("NOT_FOUND", `Unknown route: ${route}`, 404);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[match-challenges] uncaught", msg);
    return err("INTERNAL_ERROR", msg, 500);
  }
});
