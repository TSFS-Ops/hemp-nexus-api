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
};

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
      console.warn(
        `[${ctx?.requestId ?? "-"}] resolve_notifications_for(${entityType},${entityId}) failed (non-fatal):`,
        (error as { message?: string }).message ?? error,
      );
      return { ok: false, resolved: 0, error: (error as { message?: string }).message ?? "rpc_error" };
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
    console.warn(
      `[${ctx?.requestId ?? "-"}] resolve_notifications_for(${entityType},${entityId}) threw (non-fatal):`,
      e instanceof Error ? e.message : e,
    );
    return { ok: false, resolved: 0, error: e instanceof Error ? e.message : "threw" };
  }
}
