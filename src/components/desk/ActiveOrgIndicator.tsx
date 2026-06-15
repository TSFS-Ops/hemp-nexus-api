/**
 * ActiveOrgIndicator
 *
 * Surfaces the organisation the current session is acting as, so multi-account
 * users (e.g. operators with several Google-linked logins) cannot accidentally
 * file a trade under the wrong identity.
 *
 * Renders a quiet chip in normal cases, and an amber warning when the active
 * org is a "Pending verification (legacy)" placeholder - these orgs exist for
 * historical continuity and trades filed under them are difficult to recover
 * onto the operator's primary org.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserOrg } from "@/hooks/use-user-org";

const LEGACY_ORG_NAME_PREFIX = "Pending verification";

interface OrgRow {
  name: string | null;
}

export function ActiveOrgIndicator({ className }: { className?: string }) {
  const orgId = useUserOrg();
  const [org, setOrg] = useState<OrgRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!orgId) {
      setOrg(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setOrg(data ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (loading || !orgId || !org?.name) return null;

  const isLegacy = org.name.toLowerCase().startsWith(LEGACY_ORG_NAME_PREFIX.toLowerCase());

  if (isLegacy) {
    return (
      <div
        role="alert"
        className={
          "flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-foreground " +
          (className ?? "")
        }
      >
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            You are acting as <span className="font-semibold">{org.name}</span>
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This is a legacy placeholder organisation. Trades filed here will not
            appear under your verified organisation and are difficult to move
            later. Switch accounts or contact support before continuing if this
            is not intentional.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        "flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs " +
        (className ?? "")
      }
    >
      <Building2 className="h-3 w-3 text-muted-foreground/70 shrink-0" />
      <span className="truncate text-muted-foreground">
        <span className="text-foreground/80 font-medium">{org.name}</span>
      </span>
    </div>
  );
}
