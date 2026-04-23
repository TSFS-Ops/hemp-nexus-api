import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide TEST MODE banner.
 *
 * Renders a high-visibility strip at the top of the app whenever the master
 * test_mode_bypass switch is on AND at least one compliance gate is bypassed.
 * Polls every 60s so flips by an admin propagate without a hard reload.
 */
export function TestModeBanner() {
  const [state, setState] = useState<{
    enabled: boolean;
    gates: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchState = async () => {
      const { data, error } = await supabase.rpc("get_test_mode_bypass_state");
      if (cancelled || error || !data) return;
      const v = data as Record<string, unknown>;
      const gateKeys = ["idv", "sanctions", "kyb", "ubo", "authority"] as const;
      const activeGates = gateKeys.filter((k) => v[k] === true);
      setState({
        enabled: v.enabled === true && activeGates.length > 0,
        gates: activeGates,
      });
    };

    fetchState();
    const id = setInterval(fetchState, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!state?.enabled) return null;

  const labels: Record<string, string> = {
    idv: "Identity",
    sanctions: "Sanctions",
    kyb: "KYB",
    ubo: "UBO",
    authority: "Authority",
  };

  return (
    <div
      role="alert"
      className={cn(
        "w-full border-b border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
        "px-4 py-2 text-xs sm:text-sm flex items-center gap-2 justify-center"
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="font-semibold tracking-wide uppercase">Test mode</span>
      <span className="opacity-80 hidden sm:inline">
        Compliance bypass active for {state.gates.map((g) => labels[g] ?? g).join(" · ")}.
        Evidence packs generated now are <strong>not</strong> production-grade.
      </span>
      <span className="opacity-80 sm:hidden">
        {state.gates.map((g) => labels[g] ?? g).join(" · ")} bypassed
      </span>
    </div>
  );
}
