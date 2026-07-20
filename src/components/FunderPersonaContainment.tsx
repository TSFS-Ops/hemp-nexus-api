/**
 * FunderPersonaContainment — global route guard.
 *
 * Wraps the entire routed tree so that a funder-only user cannot land
 * on, browse to, or briefly render any Trade Desk / admin / HQ /
 * registry / governance / compliance / marketplace / discovery /
 * matches / support / docs / general-authenticated dashboard shell.
 *
 * Runs on every navigation (fresh sign-in, restored session, hard
 * refresh, deep link, browser back). While signals are loading it
 * renders a neutral placeholder — never the destination shell — to
 * eliminate any protected-page flash.
 *
 * See src/lib/funder-workspace/persona-containment.ts for the pure
 * decision rule (unit-tested). This component is the runtime shell.
 */
import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveFunderContainment,
  type ContainmentSignals,
} from "@/lib/funder-workspace/persona-containment";
import { TRADE_PERSONA_ROLES } from "@/lib/funder-workspace/desk-access";

interface ProbeState {
  loaded: boolean;
  isFunderUser: boolean;
  hasTradeMembership: boolean;
  selectedPersona: string | null;
}

export function FunderPersonaContainment({ children }: { children: ReactNode }) {
  const { isAuthenticated, user, isPlatformAdmin, roles, rolesLoaded, isLoading } = useAuth();
  const { pathname } = useLocation();
  const [probe, setProbe] = useState<ProbeState>({
    loaded: false,
    isFunderUser: false,
    hasTradeMembership: false,
    selectedPersona: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!isAuthenticated || !user) {
      setProbe({ loaded: true, isFunderUser: false, hasTradeMembership: false, selectedPersona: null });
      return;
    }
    if (isPlatformAdmin) {
      // Admins are never contained; skip round-trip.
      setProbe({ loaded: true, isFunderUser: false, hasTradeMembership: true, selectedPersona: null });
      return;
    }

    setProbe((p) => ({ ...p, loaded: false }));

    (async () => {
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
      setProbe({
        loaded: true,
        isFunderUser: !!funderRes.data,
        hasTradeMembership: rolesTrade,
        selectedPersona: profile?.selected_persona ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, isPlatformAdmin, roles]);

  const signals: ContainmentSignals = {
    loading: isLoading || !rolesLoaded || !probe.loaded,
    isAuthenticated,
    isPlatformAdmin,
    isFunderUser: probe.isFunderUser,
    hasTradeMembership: probe.hasTradeMembership,
    selectedPersona: probe.selectedPersona,
  };

  const decision = resolveFunderContainment(pathname, signals);

  if (decision.kind === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading"
        className="min-h-[40vh]"
        data-testid="funder-persona-containment-loading"
      />
    );
  }
  if (decision.kind === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  return <>{children}</>;
}

export default FunderPersonaContainment;
