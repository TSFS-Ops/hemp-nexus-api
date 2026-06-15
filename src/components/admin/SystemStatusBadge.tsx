/**
 * Live system-status badge for the admin top bar.
 *
 * Reads `admin_settings.general.maintenanceMode` and reflects it accurately:
 *   • false  →  emerald "OPERATIONAL"
 *   • true   →  amber  "MAINTENANCE MODE"
 *
 * Subscribes to realtime changes on the `admin_settings` row so the badge
 * flips the moment another admin toggles the switch - no refresh needed.
 *
 * Replaces the previous hard-coded "Operational" literal which contradicted
 * the DB during maintenance windows.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Status = "operational" | "maintenance" | "unknown";

export function SystemStatusBadge() {
  const [status, setStatus] = useState<Status>("unknown");

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "general")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setStatus("unknown");
        return;
      }
      const v = (data.value ?? {}) as { maintenanceMode?: boolean };
      setStatus(v.maintenanceMode === true ? "maintenance" : "operational");
    };

    read();

    const channel = supabase
      .channel("admin-settings-status-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_settings", filter: "key=eq.general" },
        () => read(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (status === "maintenance") {
    return (
      <div
        className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-sm border border-amber-900/60 bg-amber-950/40 shrink-0"
        role="status"
        aria-live="polite"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-amber-300">
          System Status: Maintenance Mode
        </span>
      </div>
    );
  }

  if (status === "unknown") {
    return (
      <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-sm border border-slate-800 bg-slate-900/40 shrink-0">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
          System Status: …
        </span>
      </div>
    );
  }

  return (
    <div
      className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-sm border border-emerald-900/60 bg-emerald-950/40 shrink-0"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-emerald-300">
        System Status: Operational
      </span>
    </div>
  );
}
