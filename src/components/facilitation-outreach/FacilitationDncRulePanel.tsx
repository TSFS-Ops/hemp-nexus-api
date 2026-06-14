/**
 * Phase 2 Step 5 — Facilitation Do-Not-Contact (DNC) rule panel.
 *
 * Wired to live Step 5 edge functions:
 *   - facilitation-outreach-dnc-add     (platform_admin OR compliance_analyst)
 *   - facilitation-outreach-dnc-revoke  (compliance_analyst only)
 *
 * Visible to platform_admin and compliance_analyst. The revoke
 * affordance is only rendered for compliance_analyst per the
 * separation-of-duties contract; the server enforces the same.
 */
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type RuleType = "email" | "email_domain" | "org_name";

export const FacilitationDncRulePanel: React.FC = () => {
  const { isPlatformAdmin, isComplianceAnalyst } = useOutreachRoles();
  const [rows, setRows] = useState<DncRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add form
  const [ruleType, setRuleType] = useState<RuleType>("email");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleReason, setRuleReason] = useState("");

  // Revoke
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});

  const canAdd = isPlatformAdmin || isComplianceAnalyst;

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

  const handleAdd = async () => {
    if (!canAdd) return;
    if (!ruleValue.trim() || !ruleReason.trim()) { toast.error("Value and reason required."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-dnc-add", {
        body: { rule_type: ruleType, value: ruleValue.trim(), reason: ruleReason.trim() },
      });
      if (error) throw error;
      toast.success("DNC rule added.");
      setRuleValue(""); setRuleReason("");
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    } finally { setBusy(false); }
  };

  const handleRevoke = async (id: string) => {
    if (!isComplianceAnalyst) return;
    const reason = (revokeReason[id] ?? "").trim();
    if (!reason) { toast.error("Revoke reason required."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("facilitation-outreach-dnc-revoke", {
        body: { rule_id: id, reason },
      });
      if (error) throw error;
      toast.success("DNC rule revoked.");
      setRevokeReason((r) => ({ ...r, [id]: "" }));
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="font-medium">Do-not-contact rules</h3>
        <p className="text-[11px] text-slate-500 font-mono">facilitation-outreach-dnc-add · facilitation-outreach-dnc-revoke</p>
      </header>

      {canAdd && (
        <div className="border rounded-sm p-3 space-y-2 text-sm">
          <h4 className="text-xs uppercase tracking-wider text-slate-500">Add DNC rule</h4>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={ruleType} onValueChange={(v) => setRuleType(v as RuleType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (block)</SelectItem>
                  <SelectItem value="email_domain">Email domain (block)</SelectItem>
                  <SelectItem value="org_name">Org name (warn)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Value</Label>
              <Input value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} placeholder={ruleType === "email" ? "name@example.com" : ruleType === "email_domain" ? "example.com" : "Org legal name"} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Textarea rows={2} value={ruleReason} onChange={(e) => setRuleReason(e.target.value)} placeholder="Why this rule is being added" />
          </div>
          <Button size="sm" disabled={busy || !ruleValue.trim() || !ruleReason.trim()} onClick={handleAdd}>Add rule</Button>
        </div>
      )}

      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="border rounded-sm px-3 py-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-xs truncate">{r.rule_type} · {r.value_norm}</div>
                <div className="text-[11px] text-slate-500 truncate">{r.reason}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={r.match_severity === "block" ? "destructive" : "secondary"}>{r.match_severity}</Badge>
                <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge>
              </div>
            </div>
            {isComplianceAnalyst && r.status === "active" && (
              <div className="flex items-center gap-2">
                <Input
                  className="text-xs h-8"
                  placeholder="Revoke reason"
                  value={revokeReason[r.id] ?? ""}
                  onChange={(e) => setRevokeReason((cur) => ({ ...cur, [r.id]: e.target.value }))}
                />
                <Button size="sm" variant="outline" disabled={busy || !(revokeReason[r.id] ?? "").trim()} onClick={() => handleRevoke(r.id)}>Revoke</Button>
              </div>
            )}
          </li>
        ))}
        {!loading && rows.length === 0 && <li className="text-xs text-slate-500">No DNC rules registered.</li>}
      </ul>
    </div>
  );
};

export default FacilitationDncRulePanel;
