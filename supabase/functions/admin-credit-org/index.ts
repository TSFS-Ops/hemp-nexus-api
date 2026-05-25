/**
 * Admin Credit Org Edge Function
 *
 * Allows a platform_admin to manually credit credits to any organisation
 * via the service-role-locked atomic_token_credit RPC (Stage C lockdown
 * removed authenticated execute on that function on 2026-05-01).
 *
 * Security model:
 *   1. Caller must present a valid Authorization Bearer token.
 *   2. Caller must be platform_admin (verified via has_role RPC under
 *      service-role, the canonical RBAC helper per project memory).
 *   3. Input is Zod-validated. credits hard-capped at 10,000 per call.
 *   4. atomic_token_credit is invoked under service-role only.
 *   5. EVERY attempt (success OR failure, including auth/validation failures
 *      that have a known caller) is recorded in admin_audit_logs.
 *
 * NEVER:
 *   - Trust the caller's claim about their role.
 *   - Bypass has_role for any reason.
 *   - Raise the per-call cap without product approval.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { z } from 'npm:zod@3.23.8';
import { handleCorsPreflight, withCors } from '../_shared/cors.ts';
import { assertAal2 } from '../_shared/aal.ts';
import { ApiException } from '../_shared/errors.ts';
import { tryDemoShortCircuit } from "../_shared/demo-mode-entry.ts";
// Batch F1: recordAdminHqDecision removed from the happy path — the
// canonical Governance Record event is now written inside the atomic
// admin_credit_org_with_governance RPC in the same DB transaction as
// the credit grant. Importing it here would re-introduce the gap.


const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Hard cap: 10,000 credits ($10k USD) per single admin top-up call.
// Larger top-ups must be split into multiple audited calls.
const MAX_CREDITS_PER_CALL = 10_000;

const BodySchema = z.object({
  org_id: z.string().uuid('org_id must be a valid UUID'),
  credits: z
    .number()
    .int('credits must be an integer')
    .positive('credits must be positive')
    .max(MAX_CREDITS_PER_CALL, `credits cannot exceed ${MAX_CREDITS_PER_CALL} per call`),
  // Batch S Fix 2: raise floor from 1 to 10 chars for parity with corrections/overrides.
  reason: z.string().trim().min(10, 'reason must be at least 10 characters').max(500, 'reason too long'),
  reference_id: z.string().trim().max(200).optional(),
});

function jsonResponse(req: Request, body: unknown, status = 200) {
  return withCors(
    req,
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }),
  );
}

/**
 * Best-effort audit log write. Never throws — auditing must not block the
 * primary response, and a missing audit row is logged but does not change
 * status codes.
 */
async function writeAudit(
  admin: ReturnType<typeof createClient>,
  callerUserId: string | null,
  targetOrgId: string | null,
  outcome: 'success' | 'failure',
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from('admin_audit_logs').insert({
      admin_user_id: callerUserId,
      action: 'admin.credit_org',
      target_type: 'organisation',
      target_id: targetOrgId,
      details: { outcome, ...details },
    });
  } catch (auditErr) {
    console.error('[admin-credit-org] audit write failed:', auditErr);
  }
}

Deno.serve(async (req) => {
  // OPS-010: short-circuit live side effects for demo data.
  try {
    const _demoAdmin = (await import("https://esm.sh/@supabase/supabase-js@2.39.3")).createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const _demoBlocked = await tryDemoShortCircuit(_demoAdmin, req, { op: "admin-credit-org", artefact: false });
    if (_demoBlocked) return _demoBlocked;
  } catch (_e) { /* OPS-010 best-effort; live flow continues */ }
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let callerId: string | null = null;
  let targetOrgId: string | null = null;
  let creditsRequested: number | null = null;
  let parsedReason: string | null = null;

  try {
    // ── 1. Auth ────────────────────────────────────────────────────────
    const authHeader =
      req.headers.get('Authorization') ?? req.headers.get('authorisation');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(req, { error: 'Unauthorised' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: userRes, error: authError } = await admin.auth.getUser(token);
    if (authError || !userRes?.user) {
      return jsonResponse(req, { error: 'Invalid token' }, 401);
    }
    callerId = userRes.user.id;

    // ── 2. RBAC: platform_admin via has_role ──────────────────────────
    const { data: hasAdmin, error: roleError } = await admin.rpc('has_role', {
      _user_id: callerId,
      _role: 'platform_admin',
    });
    if (roleError) {
      console.error('[admin-credit-org] has_role failed:', roleError);
      await writeAudit(admin, callerId, null, 'failure', {
        stage: 'rbac_check',
        error: roleError.message,
      });
      return jsonResponse(req, { error: 'Authorisation check failed' }, 500);
    }
    if (!hasAdmin) {
      await writeAudit(admin, callerId, null, 'failure', {
        stage: 'rbac_check',
        error: 'caller_not_platform_admin',
      });
      return jsonResponse(req, { error: 'Platform admin access required' }, 403);
    }

    // ── 2b. SEC-001: AAL2 / MFA enforcement ───────────────────────────
    // Money-moving admin endpoints require an MFA-challenged session.
    // Returns 403 MFA_REQUIRED when the JWT is aal1 / unknown.
    try {
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: callerId,
        action: 'admin.credit_org',
      });
    } catch (mfaErr) {
      if (mfaErr instanceof ApiException && mfaErr.code === 'MFA_REQUIRED') {
        await writeAudit(admin, callerId, null, 'failure', {
          stage: 'mfa_check',
          error: 'mfa_required',
          observed_aal: (mfaErr.details as { observed_aal?: string } | undefined)?.observed_aal,
        });
        return jsonResponse(
          req,
          { error: mfaErr.message, code: 'MFA_REQUIRED' },
          403,
        );
      }
      throw mfaErr;
    }

    // ── 3. Input validation ────────────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      await writeAudit(admin, callerId, null, 'failure', {
        stage: 'parse_body',
        error: 'invalid_json',
      });
      return jsonResponse(req, { error: 'Invalid JSON body' }, 400);
    }

    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      await writeAudit(admin, callerId, null, 'failure', {
        stage: 'validate_body',
        error: parsed.error.flatten().fieldErrors,
      });
      return jsonResponse(
        req,
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        400,
      );
    }

    const { org_id, credits, reason, reference_id } = parsed.data;
    targetOrgId = org_id;
    creditsRequested = credits;
    parsedReason = reason;

    // ── 3b. Demo-org detection (Batch G Fix 4) ────────────────────────
    // Manual top-ups against demo orgs are allowed but must be stamped
    // so investor / revenue reporting can exclude them without joining
    // organizations on every query.
    let isDemo = false;
    {
      const { data: orgRow, error: orgErr } = await admin
        .from('organizations')
        .select('is_demo')
        .eq('id', org_id)
        .maybeSingle();
      if (orgErr) {
        console.error('[admin-credit-org] org lookup failed:', orgErr);
        // Fail closed on the demo flag: treat as not-demo only if we
        // actually got a row back. A missing row is rejected.
      }
      if (!orgRow) {
        await writeAudit(admin, callerId, targetOrgId, 'failure', {
          stage: 'org_lookup',
          error: 'org_not_found',
        });
        return jsonResponse(req, { error: 'Target organisation not found' }, 404);
      }
      isDemo = (orgRow as { is_demo?: boolean }).is_demo === true;
    }

    // ── 4. Atomic credit + Governance Record (Batch F1) ───────────────
    // Single SECURITY DEFINER RPC performs atomic_token_credit AND inserts
    // the canonical admin.hq_decision_recorded event into event_store in
    // ONE transaction. If either step fails, BOTH roll back — no orphan
    // credit and no orphan governance row. This replaces the previous
    // sequence of `rpc(atomic_token_credit)` followed by a separate
    // `recordAdminHqDecision` call, which could leave credit granted with
    // no governance proof if the governance write failed afterwards.
    const referenceId =
      reference_id ?? `admin-credit-${callerId}-${Date.now()}`;

    const creditKind = isDemo ? 'admin_manual_demo' : 'admin_manual';

    const { data: atomicResult, error: atomicError } = await admin.rpc(
      'admin_credit_org_with_governance',
      {
        p_org_id: org_id,
        p_amount: credits,
        p_reason: reason,
        p_reference_id: referenceId,
        p_actor_user_id: callerId,
        p_request_id: req.headers.get('x-request-id'),
        p_credit_kind: creditKind,
        p_demo: isDemo,
      },
    );

    if (atomicError) {
      console.error('[admin-credit-org] atomic RPC error:', atomicError);
      await writeAudit(admin, callerId, targetOrgId, 'failure', {
        stage: 'admin_credit_org_with_governance',
        credits,
        reason,
        reference_id: referenceId,
        error: atomicError.message,
      });
      // The RPC raises on credit_failed AND on event_store insert failure;
      // either way the transaction has rolled back so no partial state.
      return jsonResponse(
        req,
        { error: 'Credit operation failed', details: atomicError.message },
        500,
      );
    }

    const result = atomicResult as Record<string, unknown> | null;
    if (!result || result.success !== true) {
      const errMsg = (result?.error as string) ?? 'unknown';
      await writeAudit(admin, callerId, targetOrgId, 'failure', {
        stage: 'admin_credit_org_with_governance_result',
        credits,
        reason,
        reference_id: referenceId,
        error: errMsg,
      });
      return jsonResponse(req, { error: errMsg }, 500);
    }

    // ── 5. Legacy admin_audit_logs success row (best-effort) ──────────
    // The canonical event_store row is the source of truth; this legacy
    // row is preserved for existing AdminTokenManagement panels.
    await writeAudit(admin, callerId, targetOrgId, 'success', {
      stage: 'completed',
      credits,
      reason,
      reference_id: referenceId,
      payment_reference: referenceId,
      credit_kind: creditKind,
      demo: isDemo,
      new_balance: result.new_balance,
      governance_event_id: result.event_id,
      deduplicated: result.deduplicated === true,
    });

    return jsonResponse(req, {
      success: true,
      new_balance: result.new_balance,
      reference_id: referenceId,
      credit_kind: creditKind,
      demo: isDemo,
      governance_event_id: result.event_id,
      deduplicated: result.deduplicated === true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[admin-credit-org] unhandled error:', err);
    // Best-effort failure audit if we know who the caller was.
    if (callerId) {
      await writeAudit(admin, callerId, targetOrgId, 'failure', {
        stage: 'unhandled',
        credits: creditsRequested,
        reason: parsedReason,
        error: message,
      });
    }
    return jsonResponse(req, { error: 'Internal error' }, 500);
  }
});
