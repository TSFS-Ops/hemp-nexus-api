/**
 * FunderOnlyDeskGuard — client-side containment for /desk/*.
 *
 * Wraps Trade Desk routes so a funder-only user is redirected to
 * /funder/workspace before any Trade Desk chrome or content renders.
 * See src/lib/funder-workspace/desk-access.ts for the decision rule.
 *
 * Not a security control — RLS on trade tables remains the authority.
 * This purely stops the wrong shell from being shown.
 */
import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveDeskAccess,
  TRADE_PERSONA_ROLES,
  type DeskAccessDecision,
} from "@/lib/funder-workspace/desk-access";

interface Signals {
  isFunderUser: boolean;
  hasTradeMembership: boolean;
  selectedPersona: string | null;
}

export function FunderOnlyDeskGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isPlatformAdmin, roles, rolesLoaded } = useAuth();
  const [signals, setSignals] = useState<Signals | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !user) {
      setSignals(null);
      return;
    }
    // Platform admins skip the network round-trip entirely.
    if (isPlatformAdmin) {
      setSignals({ isFunderUser: false, hasTradeMembership: true, selectedPersona: null });
      return;
    }

    (async () => {
      // Trade role signal from already-loaded user_roles.
      const rolesTrade = (roles || []).some((r) =>
        (TRADE_PERSONA_ROLES as readonly string[]).includes(r),
      );

      const [profileRes, funderRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("org_id, selected_persona")
          .eq("id", user.id)
          .maybeSingle(),
        (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (a: string, b: string) => {
                in: (a: string, b: string[]) => {
                  maybeSingle: () => Promise<{ data: { id: string } | null }>;
                };
              };
            };
          };
        })
          .from("p5_batch3_funder_users")
          .select("id")
          .eq("auth_user_id", user.id)
          .in("status", ["active", "pending", "invited"])
          .maybeSingle(),
      ]);

      if (cancelled) return;
      const profile = (profileRes.data ?? null) as
        | { org_id: string | null; selected_persona: string | null }
        | null;
      setSignals({
        isFunderUser: !!funderRes.data,
        hasTradeMembership: rolesTrade || !!profile?.org_id,
        selectedPersona: profile?.selected_persona ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isAuthenticated, isPlatformAdmin, roles]);

  // Unauthenticated: defer to downstream RequireAuth / public handling.
  if (!isAuthenticated) return <>{children}</>;
  // Wait for roles + signals — do NOT flash Trade Desk chrome first.
  if (!rolesLoaded || signals === null) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading"
        className="min-h-[40vh]"
        data-testid="funder-only-desk-guard-loading"
      />
    );
  }

  const decision: DeskAccessDecision = resolveDeskAccess({
    isPlatformAdmin,
    isFunderUser: signals.isFunderUser,
    hasTradeMembership: signals.hasTradeMembership,
    selectedPersona: signals.selectedPersona,
  });

  if (decision === "redirect_funder") {
    return <Navigate to="/funder/workspace?from=desk" replace />;
  }
  return <>{children}</>;
}

export default FunderOnlyDeskGuard;
