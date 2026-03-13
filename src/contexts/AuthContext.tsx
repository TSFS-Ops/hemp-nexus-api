import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);

  const ensureProfile = useCallback(async (userId: string, email: string) => {
    try {
      const { data, error } = await supabase.rpc("ensure_user_profile", {
        p_user_id: userId,
        p_email: email,
      });
      const result = data as Record<string, unknown> | null;
      if (error) {
        console.error("[AuthContext] ensure_user_profile failed:", error.message);
      } else if (result?.status === "created") {
        console.info("[AuthContext] Profile auto-repaired for", userId);
      }
    } catch (err) {
      console.error("[AuthContext] Unexpected error ensuring profile:", err);
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
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRoles([]);
  }, []);

  useEffect(() => {
    let sessionExpiryToastShown = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" && !session) {
        // Session expired or was invalidated
        if (!sessionExpiryToastShown && event === "SIGNED_OUT" && user) {
          // Only show session expiry message if user was previously signed in
          // and didn't explicitly sign out (we detect this by checking if we had a user)
          sessionExpiryToastShown = true;
          toast.error("Your session has expired. Please sign in again.", {
            duration: 8000,
            action: {
              label: "Sign in",
              onClick: () => {
                const currentPath = window.location.pathname + window.location.search;
                const returnTo = encodeURIComponent(currentPath);
                window.location.href = `/auth?returnTo=${returnTo}`;
              },
            },
          });
        }
        setRoles([]);
        return;
      }

      if (session?.user) {
        sessionExpiryToastShown = false;
        // Ensure profile exists before fetching roles (self-repair if trigger failed)
        setTimeout(async () => {
          await ensureProfile(session.user.id, session.user.email ?? "");
          fetchRoles(session.user.id);
        }, 0);
      } else {
        setRoles([]);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
      
      if (session?.user) {
        await ensureProfile(session.user.id, session.user.email ?? "");
        fetchRoles(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchRoles, ensureProfile]);

  const isPlatformAdmin = roles.some(r => (PLATFORM_ADMIN_ROLES as readonly string[]).includes(r));
  const isOrgAdmin = roles.includes(APP_ROLES.ORG_ADMIN) || isPlatformAdmin;
  const isOrgMember = roles.includes(APP_ROLES.ORG_MEMBER) || isOrgAdmin;

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
