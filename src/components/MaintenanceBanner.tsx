import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide MAINTENANCE MODE banner.
 *
 * Renders a high-visibility strip at the top of every page when
 * `admin_settings.general.maintenanceMode` is true.
 *
 * Subscribes to realtime changes on the `admin_settings` table so a flip
 * by an admin propagates within seconds, no hard reload required.
 *
 * Platform admins are NOT shown the banner - they need an unobstructed
 * console to diagnose / resolve whatever caused the maintenance window.
 * Their corresponding back-end requests are also exempt from the gate.
 */
export function MaintenanceBanner() {
  const { user } = useAuth();
  const [state, setState] = useState<{
    enabled: boolean;
    reason: string | null;
    startedAt: string | null;
  }>({ enabled: false, reason: null, startedAt: null });
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  // ── Resolve role once per user ──
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsPlatformAdmin(false);
      return;
    }
    (async () => {
      const { data } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "platform_admin",
      });
      if (!cancelled) setIsPlatformAdmin(data === true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ── Subscribe to admin_settings changes + initial fetch ──
  useEffect(() => {
    let cancelled = false;

    const apply = (value: Record<string, unknown> | null | undefined) => {
      if (cancelled) return;
      const v = value ?? {};
      setState({
        enabled: v.maintenanceMode === true,
        reason: typeof v.maintenanceReason === "string" ? v.maintenanceReason : null,
        startedAt: typeof v.maintenanceStartedAt === "string" ? v.maintenanceStartedAt : null,
      });
    };

    const fetchOnce = async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "general")
        .maybeSingle();
      if (!error) apply((data?.value ?? null) as Record<string, unknown> | null);
    };

    fetchOnce();

    const channel = supabase
      .channel("admin-settings-maintenance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_settings", filter: "key=eq.general" },
        (payload) => {
          const newRow = (payload.new ?? {}) as { value?: Record<string, unknown> };
          apply(newRow.value ?? null);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (!state.enabled || isPlatformAdmin) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "w-full border-b border-destructive/40 bg-destructive/10 text-destructive-foreground",
        "px-4 py-2 text-xs sm:text-sm flex items-center gap-2 justify-center text-foreground",
      )}
    >
      <AlertOctagon className="h-4 w-4 shrink-0 text-destructive" />
      <span className="font-semibold tracking-wide uppercase text-destructive">
        Platform maintenance
      </span>
      <span className="opacity-80 hidden sm:inline">
        {state.reason
          ? state.reason
          : "Izenzo is in scheduled maintenance. New trades, engagements, document uploads and team invites are temporarily paused. Existing data remains viewable."}
      </span>
      <span className="opacity-80 sm:hidden">
        Mutations paused - existing data still viewable.
      </span>
    </div>
  );
}
