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
  reason: z.string().trim().min(1, 'reason is required').max(500, 'reason too long'),
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

    // ── 4. Service-role credit ─────────────────────────────────────────
    const referenceId =
      reference_id ?? `admin-credit-${callerId}-${Date.now()}`;

    const { data: creditResult, error: creditError } = await admin.rpc(
      'atomic_token_credit',
      {
        p_org_id: org_id,
        p_amount: credits,
        p_reason: `admin_top_up:${reason}`.slice(0, 500),
        p_reference_id: referenceId,
      },
    );

    if (creditError) {
      console.error('[admin-credit-org] atomic_token_credit error:', creditError);
      await writeAudit(admin, callerId, targetOrgId, 'failure', {
        stage: 'atomic_token_credit',
        credits,
        reason,
        reference_id: referenceId,
        error: creditError.message,
      });
      return jsonResponse(
        req,
        { error: 'Credit operation failed', details: creditError.message },
        500,
      );
    }

    const result = creditResult as Record<string, unknown> | null;
    if (!result || result.success !== true) {
      const errMsg = (result?.error as string) ?? 'unknown';
      await writeAudit(admin, callerId, targetOrgId, 'failure', {
        stage: 'atomic_token_credit_result',
        credits,
        reason,
        reference_id: referenceId,
        error: errMsg,
      });
      return jsonResponse(req, { error: errMsg }, 500);
    }

    // ── 5. Success audit ───────────────────────────────────────────────
    await writeAudit(admin, callerId, targetOrgId, 'success', {
      stage: 'completed',
      credits,
      reason,
      reference_id: referenceId,
      new_balance: result.new_balance,
    });

    return jsonResponse(req, {
      success: true,
      new_balance: result.new_balance,
      reference_id: referenceId,
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
