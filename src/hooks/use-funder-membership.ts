/**
 * useFunderMembership — authoritative check for "does this authenticated user
 * belong to a Funder Organisation?"
 *
 * Source of truth: `p5_batch3_funder_users.auth_user_id`. Membership is
 * effective the moment a row exists with status !== 'deactivated'. No
 * dependency on localStorage/sessionStorage/persona picks — a funder is a
 * funder regardless of stored preferences.
 *
 * Contract for callers (routing guards, chooser pages, shells):
 *   - `isLoading = true` → do NOT render workspace choosers, do NOT redirect;
 *     wait. This prevents the chooser from flashing before the check resolves.
 *   - `isFunder = true`  → user belongs to a funder org. They must land on
 *     `/funder/workspace` and be blocked from every non-funder surface.
 *   - `isFunder = false` → normal routing applies.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface FunderMembership {
  isLoading: boolean;
  isFunder: boolean;
  funderOrgId: string | null;
  role: string | null;
}

// Module-level cache keyed by user id so repeated route changes don't re-query.
const cache = new Map<
  string,
  { isFunder: boolean; funderOrgId: string | null; role: string | null }
>();

export function useFunderMembership(): FunderMembership {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const cached = userId ? cache.get(userId) ?? null : null;
  const [state, setState] = useState<FunderMembership>(() => ({
    isLoading: !!userId && !cached,
    isFunder: cached?.isFunder ?? false,
    funderOrgId: cached?.funderOrgId ?? null,
    role: cached?.role ?? null,
  }));

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      setState({ isLoading: false, isFunder: false, funderOrgId: null, role: null });
      return;
    }
    const hit = cache.get(userId);
    if (hit) {
      setState({ isLoading: false, ...hit });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true }));
    (async () => {
      try {
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (s: string) => {
              eq: (c: string, v: string) => {
                neq: (c: string, v: string) => {
                  maybeSingle: () => Promise<{
                    data: { funder_organisation_id: string; role: string } | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            };
          };
        })
          .from("p5_batch3_funder_users")
          .select("funder_organisation_id, role")
          .eq("auth_user_id", userId)
          .neq("status", "deactivated")
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          // Fail closed for safety: do NOT mark them as funder, but log so
          // route guards fall through to normal behaviour instead of trapping
          // the user in an empty funder workspace.
          console.warn("[useFunderMembership] lookup failed:", error.message);
          const value = { isFunder: false, funderOrgId: null, role: null };
          cache.set(userId, value);
          setState({ isLoading: false, ...value });
          return;
        }
        const value = data
          ? { isFunder: true, funderOrgId: data.funder_organisation_id, role: data.role }
          : { isFunder: false, funderOrgId: null, role: null };
        cache.set(userId, value);
        setState({ isLoading: false, ...value });
      } catch (err) {
        if (cancelled) return;
        console.warn("[useFunderMembership] threw:", err);
        const value = { isFunder: false, funderOrgId: null, role: null };
        cache.set(userId, value);
        setState({ isLoading: false, ...value });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, authLoading]);

  return state;
}

/** Test-only: clear the module cache between test cases. */
export function __resetFunderMembershipCacheForTests() {
  cache.clear();
}
