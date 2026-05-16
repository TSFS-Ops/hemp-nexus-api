/**
 * Batch M follow-up (NOT-008): server-side helper that marks every unread
 * in-app notification attached to a resolved entity as read+resolved.
 *
 * Wraps the SECURITY DEFINER SQL function `public.resolve_notifications_for`,
 * which is service_role-only and idempotent.
 *
 * Usage: call this immediately after the underlying entity transitions to a
 * terminal/handled state (engagement accepted/declined/cancelled/expired,
 * match challenge withdrawn/closed/recorded, breach remediated, dd approval
 * rejected/completed, …). Failures MUST never break the host request.
 */
export type SupabaseLike = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from?: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

const SYSTEM_ORG_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Best-effort observability row written when the RPC fails or throws. Used
 * by `infra-alerts` to compute an in-app auto-resolve failure rate over a
 * rolling window. Never throws.
 */
async function recordAutoResolveFailure(
  admin: SupabaseLike,
  entityType: string,
  entityId: string,
  reason: string,
  errorMessage: string | null,
  ctx?: { requestId?: string; source?: string },
): Promise<void> {
  if (typeof admin.from !== "function") return;
  try {
    await admin.from("audit_logs").insert({
      org_id: SYSTEM_ORG_SENTINEL,
      entity_type: "notification",
      action: "notification.auto_resolve_failed",
      metadata: {
        target_entity_type: entityType,
        target_entity_id: entityId,
        reason,
        error_message: errorMessage,
        source: ctx?.source ?? null,
        request_id: ctx?.requestId ?? null,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (auditErr) {
    console.warn(
      `[${ctx?.requestId ?? "-"}] recordAutoResolveFailure audit insert failed (non-fatal):`,
      auditErr instanceof Error ? auditErr.message : auditErr,
    );
  }
}

export async function resolveNotificationsFor(
  admin: SupabaseLike,
  entityType: string,
  entityId: string | null | undefined,
  ctx?: { requestId?: string; source?: string },
): Promise<{ ok: boolean; resolved: number; error?: string }> {
  if (!entityId || !entityType) {
    return { ok: true, resolved: 0 };
  }
  try {
    const { data, error } = await admin.rpc("resolve_notifications_for", {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (error) {
      const msg = (error as { message?: string }).message ?? "rpc_error";
      console.warn(
        `[${ctx?.requestId ?? "-"}] resolve_notifications_for(${entityType},${entityId}) failed (non-fatal):`,
        msg,
      );
      await recordAutoResolveFailure(admin, entityType, entityId, "rpc_error", msg, ctx);
      return { ok: false, resolved: 0, error: msg };
    }
    const resolved = typeof data === "number" ? data : Number(data ?? 0) || 0;
    if (resolved > 0) {
      console.log(
        `[${ctx?.requestId ?? "-"}] resolved ${resolved} in-app notification(s) for ${entityType} ${entityId}` +
          (ctx?.source ? ` (src=${ctx.source})` : ""),
      );
    }
    return { ok: true, resolved };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "threw";
    console.warn(
      `[${ctx?.requestId ?? "-"}] resolve_notifications_for(${entityType},${entityId}) threw (non-fatal):`,
      msg,
    );
    await recordAutoResolveFailure(admin, entityType, entityId, "threw", msg, ctx);
    return { ok: false, resolved: 0, error: msg };
  }
}
