/**
 * OPS-010 - Global demo-mode banner.
 *
 * Shown whenever the signed-in user belongs to an organisation flagged
 * is_demo=true. Sits beneath any TestModeBanner. Copy is fixed and lives
 * in `src/lib/ops/ops-010-audit.ts` to keep audit + UI in lock-step.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { OPS_010_DEMO_BANNER_COPY } from "@/lib/ops/ops-010-audit";

export function DemoModeBanner() {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid) return;
        const { data: prof } = await supabase
          .from("profiles").select("org_id").eq("id", uid).maybeSingle();
        if (!prof?.org_id) return;
        const { data: org } = await supabase
          .from("organizations").select("is_demo").eq("id", prof.org_id).maybeSingle();
        if (!cancelled) setIsDemo(!!org?.is_demo);
      } catch {
        // best-effort
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isDemo) return null;

  return (
    <div
      role="status"
      className="w-full bg-amber-100 border-b border-amber-300 text-amber-900 text-sm py-2 px-4 text-center font-medium"
    >
      <span className="font-mono uppercase tracking-wider mr-2">OPS-010</span>
      {OPS_010_DEMO_BANNER_COPY}
    </div>
  );
}
