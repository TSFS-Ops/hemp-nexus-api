/**
 * admin-recipients
 * ----------------
 * Batch M Fix 5: resolve which admin users should receive an alert from
 * notification-dispatch, based on the event_type.
 *
 * Policy (safe defaults; client may refine the matrix later):
 *  - platform/security/system events → platform_admin
 *  - compliance/KYB/screening/dispute events → compliance_analyst (+ platform_admin fallback)
 *  - billing/payment/revenue events → billing_admin (+ platform_admin fallback)
 *  - legal/document review events → legal_reviewer (+ platform_admin fallback)
 *  - everything else → platform_admin
 *
 * If the primary role has no members the helper falls back to platform_admin.
 * If platform_admin itself is empty the helper returns an empty list AND the
 * caller MUST write notification_skipped(reason='admin_routing_failed').
 * Ordinary org_member is NEVER returned by this helper.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type AdminRole =
  | "platform_admin"
  | "compliance_analyst"
  | "billing_admin"
  | "legal_reviewer";

export interface AdminRecipient {
  userId: string;
  email: string | null;
  role: AdminRole;
  policyKey: string;
  fallback: boolean;
}

export interface RoutingPolicy {
  policyKey: string;
  primary: AdminRole;
  fallback: AdminRole;
}

const FALLBACK: AdminRole = "platform_admin";

function policyFor(eventType: string): RoutingPolicy {
  const e = (eventType || "").toLowerCase();
  if (
    e.startsWith("compliance") || e.startsWith("kyb") || e.startsWith("kyc") ||
    e.startsWith("sanctions") || e.startsWith("dispute") || e.startsWith("screening") ||
    e.startsWith("wad") || e.startsWith("retention")
  ) {
    return { policyKey: "compliance", primary: "compliance_analyst", fallback: FALLBACK };
  }
  if (
    e.startsWith("billing") || e.startsWith("payment") || e.startsWith("revenue") ||
    e.startsWith("credits") || e.startsWith("paystack")
  ) {
    return { policyKey: "billing", primary: "billing_admin", fallback: FALLBACK };
  }
  if (
    e.startsWith("legal") || e.startsWith("document_review") || e.startsWith("contract")
  ) {
    return { policyKey: "legal", primary: "legal_reviewer", fallback: FALLBACK };
  }
  // platform/security/system/breach/lifecycle/anything else
  return { policyKey: "platform", primary: "platform_admin", fallback: FALLBACK };
}

async function fetchRoleMembers(
  supabase: SupabaseClient,
  role: AdminRole,
): Promise<Array<{ userId: string; email: string | null }>> {
  const { data: roleRows, error: roleErr } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", role);
  if (roleErr || !roleRows || roleRows.length === 0) return [];

  const ids = roleRows.map((r) => r.user_id as string);
  const { data: profileRows, error: profErr } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", ids);
  if (profErr || !profileRows) {
    return ids.map((id) => ({ userId: id, email: null }));
  }
  const byId = new Map(profileRows.map((p) => [p.id as string, p.email as string | null]));
  return ids.map((id) => ({ userId: id, email: byId.get(id) ?? null }));
}

export async function resolveAdminRecipients(
  supabase: SupabaseClient,
  eventType: string,
): Promise<{
  policy: RoutingPolicy;
  recipients: AdminRecipient[];
  routedToFallback: boolean;
  routingFailed: boolean;
}> {
  const policy = policyFor(eventType);

  const primaryMembers = await fetchRoleMembers(supabase, policy.primary);
  if (primaryMembers.length > 0) {
    return {
      policy,
      routedToFallback: false,
      routingFailed: false,
      recipients: primaryMembers.map((m) => ({
        ...m,
        role: policy.primary,
        policyKey: policy.policyKey,
        fallback: false,
      })),
    };
  }

  // Fall back to platform_admin (unless that WAS the primary).
  if (policy.primary !== policy.fallback) {
    const fbMembers = await fetchRoleMembers(supabase, policy.fallback);
    if (fbMembers.length > 0) {
      return {
        policy,
        routedToFallback: true,
        routingFailed: false,
        recipients: fbMembers.map((m) => ({
          ...m,
          role: policy.fallback,
          policyKey: policy.policyKey,
          fallback: true,
        })),
      };
    }
  }

  return { policy, recipients: [], routedToFallback: false, routingFailed: true };
}
