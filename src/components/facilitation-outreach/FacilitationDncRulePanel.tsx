/**
 * Phase 2 Step 4 — Facilitation Do-Not-Contact (DNC) rule panel.
 *
 * READ-ONLY in Step 4: the Phase 2 Step 3 batch did not ship a DNC
 * add/revoke edge function, and the Step 4 contract requires UI to
 * call Step 3 endpoints only. Add/revoke are surfaced as disabled
 * affordances with a clear "endpoint deferred" notice so the contract
 * intent is visible to compliance_analyst reviewers, but no mutation
 * path is wired.
 *
 * Visible to platform_admin and compliance_analyst per Step 4 scope.
 * The revoke affordance (still disabled) is only rendered for
 * compliance_analyst per the role-visibility contract.
 */
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOutreachRoles } from "./useOutreachRoles";

type DncRow = {
  id: string;
  rule_type: string;
  value_raw: string;
  value_norm: string;
  match_severity: string;
  reason: string;
  status: "active" | "revoked" | string;
  source: string;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
};

export const FacilitationDncRulePanel: React.FC = () => {
  const { isComplianceAnalyst } = useOutreachRoles();
  const [rows, setRows] = useState<DncRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("facilitation_do_not_contact_rules")
        .select("id,rule_type,value_raw,value_norm,match_severity,reason,status,source,created_at,revoked_at,expires_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as DncRow[]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load DNC rules");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-medium">Do-not-contact rules</h3>
        <p className="text-[11px] text-slate-500 font-mono">facilitation_do_not_contact_rules · read-only</p>
      </header>
      <div className="border rounded-sm p-3 bg-amber-50 text-xs">
        DNC add/revoke endpoints are deferred (no Phase 2 Step 3 endpoint). This panel is read-only;
        rules are seeded server-side. Revoke affordance below is rendered (compliance_analyst only)
        but intentionally disabled until the dedicated edge function lands.
      </div>
      <Button size="sm" variant="outline" disabled title="Endpoint deferred">Add DNC rule</Button>
      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="border rounded-sm px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-xs truncate">{r.rule_type} · {r.value_norm}</div>
              <div className="text-[11px] text-slate-500 truncate">{r.reason}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={r.match_severity === "block" ? "destructive" : "secondary"}>{r.match_severity}</Badge>
              <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge>
              {isComplianceAnalyst && r.status === "active" && (
                <Button size="sm" variant="outline" disabled title="Endpoint deferred">Revoke</Button>
              )}
            </div>
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="text-xs text-slate-500">No DNC rules registered.</li>}
      </ul>
    </div>
  );
};

export default FacilitationDncRulePanel;
