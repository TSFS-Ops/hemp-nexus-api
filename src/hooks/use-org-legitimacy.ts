/**
 * useOrgLegitimacy — client-side mirror of supabase/functions/_shared/legitimacy.ts.
 *
 * Read-only check of the caller's org `trade_approvals` row. Used to render
 * the legitimacy gate pre-flight (disabled buttons + recovery CTA) so users
 * never click a button only to be denied by a 403.
 *
 * IMPORTANT: this hook is for UX only. The server is the source of truth —
 * never rely on this to authorise an action.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserOrg } from "@/hooks/use-user-org";

export type LegitimacyState =
  | { allowed: true; status: "approved"; validUntil: string | null }
  | {
      allowed: false;
      reason: "no_record" | "not_approved" | "revoked" | "expired" | "no_org";
      status: string | null;
      validUntil: string | null;
      message: string;
    };

const RECOVERY_CTA = "Open Settings → Company Identity to start your KYB review.";

function buildBlockedMessage(
  reason: Exclude<LegitimacyState["reason"], undefined>,
  status: string | null,
): string {
  switch (reason) {
    case "no_org":
      return "Your organisation profile is not linked. Complete onboarding before issuing a Proof of Intent or contacting a counterparty.";
    case "no_record":
      return `Your organisation must complete verification before issuing a Proof of Intent or contacting a counterparty under Izenzo's name. ${RECOVERY_CTA}`;
    case "revoked":
      return `Your organisation's trading approval has been revoked. Counterparty-facing actions are paused until a compliance reviewer reinstates approval. ${RECOVERY_CTA}`;
    case "expired":
      return `Your organisation's trading approval has expired. Counterparty-facing actions are paused until the profile is renewed. ${RECOVERY_CTA}`;
    case "not_approved":
    default:
      return `Your organisation's trading approval is currently '${status || "incomplete"}'. Counterparty-facing actions are blocked until a compliance reviewer marks the profile 'approved'. ${RECOVERY_CTA}`;
  }
}

export function useOrgLegitimacy() {
  const orgId = useUserOrg();

  return useQuery<LegitimacyState>({
    queryKey: ["org-legitimacy", orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: async (): Promise<LegitimacyState> => {
      if (!orgId) {
        return {
          allowed: false,
          reason: "no_org",
          status: null,
          validUntil: null,
          message: buildBlockedMessage("no_org", null),
        };
      }

      const { data, error } = await supabase
        .from("trade_approvals")
        .select("status, valid_until")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // RLS may legitimately hide approval rows from non-admin members of the
      // same org. We therefore treat a lookup failure as ALLOWED-by-default
      // for UX purposes — the server still enforces the gate. This avoids
      // false-positive blocks on legitimate users whose admin has been
      // approved but who themselves lack visibility on the row.
      if (error || !data) {
        return error
          ? { allowed: true, status: "approved", validUntil: null } // optimistic on lookup error
          : {
              allowed: false,
              reason: "no_record",
              status: null,
              validUntil: null,
              message: buildBlockedMessage("no_record", null),
            };
      }

      const status = String(data.status || "").toLowerCase();
      const validUntil = data.valid_until ?? null;

      if (status === "revoked") {
        return {
          allowed: false,
          reason: "revoked",
          status,
          validUntil,
          message: buildBlockedMessage("revoked", status),
        };
      }

      if (status !== "approved") {
        return {
          allowed: false,
          reason: "not_approved",
          status,
          validUntil,
          message: buildBlockedMessage("not_approved", status),
        };
      }

      if (validUntil) {
        const expiresAt = Date.parse(validUntil);
        if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
          return {
            allowed: false,
            reason: "expired",
            status,
            validUntil,
            message: buildBlockedMessage("expired", status),
          };
        }
      }

      return { allowed: true, status: "approved", validUntil };
    },
  });
}
