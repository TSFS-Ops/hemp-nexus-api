import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { type AppRole, PLATFORM_ADMIN_ROLES, APP_ROLES } from "@/lib/constants";
import { toast } from "sonner";
import { setSentryUser, clearSentryUser } from "@/lib/sentry";
import { notifySessionExpired } from "@/lib/session-expiry-bus";
import { recordSessionFailure } from "@/lib/session-failure-metrics";
import { refreshSessionOnce } from "@/lib/edge-invoke";
import { queryClient } from "@/lib/query-client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  // Granular role checks
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  isOrgMember: boolean;
  /** @deprecated Use isPlatformAdmin instead */
  isAdmin: boolean;
  roles: AppRole[];
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Temporarily suppress session-expiry redirect (for password change flow) */
  suppressExpiry: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  // Track whether user explicitly clicked sign-out (not session expiry)
  const explicitSignOutRef = useRef(false);
  // Track which user IDs have already had their profile verified this session
  const profileVerifiedRef = useRef<Set<string>>(new Set());
  // Suppress session-expiry redirect during password change
  const suppressExpiryRef = useRef(false);
  // Ref to track whether we had a user before (for expiry detection)
  const hadUserRef = useRef(false);

  const ensureProfileIfNeeded = useCallback(async (userId: string, email: string) => {
    // Only call the RPC once per user per browser session
    if (profileVerifiedRef.current.has(userId)) return;
    profileVerifiedRef.current.add(userId);
    try {
      const { data, error } = await supabase.rpc("ensure_user_profile", {
        p_user_id: userId,
        p_email: email,
      });
      const result = data as Record<string, unknown> | null;
      if (error) {
        console.error("[AuthContext] ensure_user_profile failed:", error.message);
        // Allow retry next time
        profileVerifiedRef.current.delete(userId);
      } else if (result?.status === "created") {
        console.info("[AuthContext] Profile auto-repaired for", userId);
      }
    } catch (err) {
      console.error("[AuthContext] Unexpected error ensuring profile:", err);
      profileVerifiedRef.current.delete(userId);
    }
  }, []);

  const previousRolesRef = useRef<AppRole[] | null>(null);
  const previousOrgIdRef = useRef<string | null | undefined>(undefined);

  const invalidateRoleScopedCaches = useCallback(() => {
    // Force-refetch anything that depends on the caller's role/org context.
    // Backend remains the final authority — this only keeps the UI honest.
    queryClient.invalidateQueries();
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    try {
      const [{ data: rolesData, error: rolesErr }, { data: profileData }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("org_id").eq("id", userId).maybeSingle(),
      ]);

      if (rolesErr) {
        console.error("[AuthContext] Failed to fetch roles:", rolesErr.message);
        setRoles([]);
        return;
      }

      const userRoles = (rolesData || []).map(r => r.role as AppRole);
      const currentOrgId = (profileData?.org_id ?? null) as string | null;

      // Detect mid-session role changes.
      const prev = previousRolesRef.current;
      let rolesChanged = false;
      if (prev !== null) {
        const added = userRoles.filter(r => !prev.includes(r));
        const removed = prev.filter(r => !userRoles.includes(r));
        if (added.length > 0 || removed.length > 0) {
          rolesChanged = true;
          toast.info("Your access level was updated by an administrator. Please refresh the page to see the latest options.", {
            duration: 10000,
          });
        }
      }
      previousRolesRef.current = userRoles;

      // Detect mid-session org membership change.
      const prevOrg = previousOrgIdRef.current;
      let orgChanged = false;
      if (prevOrg !== undefined && prevOrg !== currentOrgId) {
        orgChanged = true;
        if (currentOrgId === null) {
          toast.warning("You were removed from your organisation. You will be signed out.", {
            duration: 8000,
          });
          // Defer to next tick so toast renders, then sign out.
          setTimeout(() => { void supabase.auth.signOut(); }, 50);
        } else {
          toast.info("Your organisation membership changed. Reloading…", { duration: 6000 });
          setTimeout(() => window.location.reload(), 1500);
        }
      }
      previousOrgIdRef.current = currentOrgId;

      setRoles(userRoles);

      if (rolesChanged || orgChanged) {
        invalidateRoleScopedCaches();
      }

      if (currentOrgId) {
        setSentryUser(userId, currentOrgId, userRoles);
      }
    } catch (err) {
      console.error("[AuthContext] Unexpected error fetching roles:", err);
      setRoles([]);
    }
  }, [invalidateRoleScopedCaches]);

  const refreshSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    setUser(session?.user ?? null);
    if (session?.user) {
      setTimeout(() => fetchRoles(session.user.id), 0);
    }
  }, [fetchRoles]);

  const signOut = useCallback(async () => {
    explicitSignOutRef.current = true;
    profileVerifiedRef.current.clear();
    clearSentryUser();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRoles([]);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (event === "SIGNED_OUT" || (event === "TOKEN_REFRESHED" && !session)) {
        const wasExplicit = explicitSignOutRef.current;
        explicitSignOutRef.current = false;

        // Suppress redirect during password change (which triggers auth events)
        if (suppressExpiryRef.current) {
          suppressExpiryRef.current = false;
          return;
        }

        if (!wasExplicit && hadUserRef.current) {
          // This is a genuine session expiry, not an explicit logout.
          // Dispatch custom event so draft-persistence hooks can emergency-save.
          window.dispatchEvent(new CustomEvent("izenzo:session-expiry"));
          // Also fire beforeunload so useUnsavedChanges can warn.
          const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(beforeUnloadEvent);

          // Surface the global blocking modal instead of a corner toast
          // (clients were missing the toast — see incident 2026-04-24).
          notifySessionExpired("REFRESH_FAILED");
          recordSessionFailure("REFRESH_FAILED", { context: "auth-state-change" });
        }
        hadUserRef.current = false;
        setRoles([]);
        return;
      }

      if (session?.user) {
        hadUserRef.current = true;
        // Only verify profile on sign-in/sign-up, not every token refresh
        const needsProfileCheck = event === "SIGNED_IN" || event === "INITIAL_SESSION";
        setTimeout(async () => {
          if (needsProfileCheck) {
            await ensureProfileIfNeeded(session.user.id, session.user.email ?? "");
          }
          fetchRoles(session.user.id);
        }, 0);
      } else {
        setRoles([]);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      hadUserRef.current = !!session?.user;
      setIsLoading(false);
      
      if (session?.user) {
        await ensureProfileIfNeeded(session.user.id, session.user.email ?? "");
        fetchRoles(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchRoles, ensureProfileIfNeeded]);

  // ── Role refresh on tab focus / visibility change ──
  // We previously used a Realtime subscription on user_roles, but publishing
  // that table broadcasts every role change to every subscriber - a privilege
  // information leak. Instead, we re-fetch the caller's own roles when:
  //   • the tab regains visibility (returning from background)
  //   • the window regains focus (clicking back in)
  //   • the periodic 60s session health check runs (handled below)
  // This catches mid-session demotion/promotion without broadcasting changes.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        fetchRoles(userId);
      }
    };

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id, fetchRoles]);

  // ── Periodic session health check ──
  // Catches the case where the refresh token itself expires after inactivity.
  // The Supabase SDK does NOT fire onAuthStateChange in this scenario - API
  // calls simply fail with 401 and pages "become unavailable."
  // Every 60 seconds, if we think we have a user, we verify the session is
  // still valid. If it's gone, we trigger the same expiry flow.
  useEffect(() => {
    const HEALTH_CHECK_INTERVAL = 60_000; // 60 seconds
    // Refresh access token if it has <2 minutes left, instead of waiting for
    // an action to discover the session is dead. This catches the case where
    // a user leaves the tab open for hours: the access token expires (~1h),
    // and although getSession() still returns the cached session object,
    // any subsequent edge-function call would 401. We pre-empt that.
    const REFRESH_SKEW_MS = 120_000;

    const triggerExpiry = (reason: "HEALTH_CHECK_FAILED" | "REFRESH_FAILED") => {
      hadUserRef.current = false;
      setUser(null);
      setSession(null);
      setRoles([]);
      // Legacy event for draft-persistence emergency-save hooks.
      window.dispatchEvent(new CustomEvent("izenzo:session-expiry"));
      // New unmissable modal (replaces the easy-to-miss corner toast).
      notifySessionExpired(reason);
      recordSessionFailure(reason, { context: "background-health-check" });
    };

    const intervalId = setInterval(async () => {
      if (!hadUserRef.current) return; // no user to check
      if (explicitSignOutRef.current) return; // signing out
      if (suppressExpiryRef.current) return; // password change in progress

      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        if (error || !currentSession) {
          triggerExpiry("HEALTH_CHECK_FAILED");
          return;
        }

        // Proactively refresh if the access token is close to expiry.
        // If the refresh token itself has died, this will fail and we
        // surface the modal immediately, rather than on the next click.
        const expiresAtMs = (currentSession.expires_at ?? 0) * 1000;
        const needsRefresh = expiresAtMs - Date.now() < REFRESH_SKEW_MS;
        if (needsRefresh) {
          const { data: refreshed, error: refreshErr } = await refreshSessionOnce();
          if (refreshErr || !refreshed.session) {
            triggerExpiry("REFRESH_FAILED");
            return;
          }
          // refreshSession() updates auth state; onAuthStateChange will
          // update our React state for us.
          fetchRoles(refreshed.session.user.id);
        } else {
          // Local session looks healthy, but the server may have invalidated
          // it (e.g. user signed out in another tab, admin revoked, password
          // changed elsewhere). getSession() only reads local storage, so we
          // do a lightweight server-side check via getUser() to catch dead
          // sessions before the next edge-function call 401s.
          const { error: userErr } = await supabase.auth.getUser();
          if (userErr) {
            const msg = (userErr.message || "").toLowerCase();
            const status = (userErr as { status?: number }).status;
            if (status === 401 || status === 403 || /session|jwt|token/.test(msg)) {
              triggerExpiry("HEALTH_CHECK_FAILED");
              return;
            }
            // Other errors (network, 5xx) — skip this cycle.
          } else {
            // Server confirms session — opportunistically refresh roles so a
            // demoted user in an idle background tab is reflected within ~60s.
            fetchRoles(currentSession.user.id);
          }
        }
      } catch {
        // Network error - don't treat as session expiry, just skip.
      }
    }, HEALTH_CHECK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [fetchRoles]);

  const isPlatformAdmin = roles.some(r => (PLATFORM_ADMIN_ROLES as readonly string[]).includes(r));
  const isOrgAdmin = roles.includes(APP_ROLES.ORG_ADMIN) || isPlatformAdmin;
  const isOrgMember = roles.includes(APP_ROLES.ORG_MEMBER) || isOrgAdmin;

  /** Temporarily suppress session-expiry redirect (e.g. during password change) */
  const suppressExpiry = useCallback(() => {
    suppressExpiryRef.current = true;
    // Auto-reset after 10s in case the flag isn't cleared
    setTimeout(() => { suppressExpiryRef.current = false; }, 10000);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated: !!session,
        isPlatformAdmin,
        isOrgAdmin,
        isOrgMember,
        isAdmin: isPlatformAdmin, // backward compat
        roles,
        signOut,
        refreshSession,
        suppressExpiry,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
