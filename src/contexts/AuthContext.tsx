import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { type AppRole, PLATFORM_ADMIN_ROLES, APP_ROLES } from "@/lib/constants";
import { toast } from "sonner";

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

  const fetchRoles = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      
      if (error) {
        console.error("[AuthContext] Failed to fetch roles:", error.message);
        setRoles([]);
        return;
      }

      const userRoles = (data || []).map(r => r.role as AppRole);
      setRoles(userRoles);
    } catch (err) {
      console.error("[AuthContext] Unexpected error fetching roles:", err);
      setRoles([]);
    }
  }, []);

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
          // This is a genuine session expiry, not an explicit logout
          // Dispatch custom event so draft-persistence hooks can emergency-save
          window.dispatchEvent(new CustomEvent("izenzo:session-expiry"));
          // Also fire beforeunload so useUnsavedChanges can warn
          const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(beforeUnloadEvent);
          
          const currentPath = window.location.pathname + window.location.search;
          const returnTo = encodeURIComponent(currentPath);
          toast.error("Your session has expired. Redirecting to sign in…", {
            description: "Your work-in-progress may not have been saved. You will return to this page after signing in.",
            duration: 7000,
          });
          // Force redirect after a brief delay so the toast is visible
          setTimeout(() => {
            window.location.href = `/auth?returnTo=${returnTo}`;
          }, 2500);
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
