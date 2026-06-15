/**
 * DATA-004 Phase 1 - Per-Org Retention Policy admin panel (SHELL).
 *
 * Platform-admin only. Records per-org retention windows for each record
 * class. Phase 1 = shell: values are recorded + audited, but no sweeper
 * reads this yet - existing global defaults remain in force. The panel
 * surfaces that fact prominently so an operator cannot mistake the
 * recorded value for an enforced value.
 *
 * Companion surface to AdminLegalHoldsPanel:
 *   - Legal Holds tab     → DATA-003 (deletion/anonymisation block)
 *   - Per-Org Retention   → DATA-004 (per-org window above platform floor)
 *
 * Also renders a read-only view of currently active legal holds scoped to
 * the selected org (scope_type='org', scope_id=<org_id>), with a deep-link
 * to the Legal Holds sub-tab to apply / release.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert, Info, AlertCircle, ExternalLink } from "lucide-react";
import { parseEdgeError } from "@/lib/edge-error";

const RECORD_CLASSES = [
  "matches", "trade_requests", "pois", "wads", "evidence",
  "audit_logs", "email_send_log", "governance_records",
] as const;
type RecordClass = typeof RECORD_CLASSES[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PolicyRow {
  id: string;
  org_id: string;
  record_class: RecordClass;
  retention_days: number;
  floor_days: number;
  reason: string;
  set_by: string | null;
  set_at: string;
  updated_at: string;
  organizations?: { id: string; name: string } | null;
}

interface OrgLite { id: string; name: string }

interface LegalHoldLite {
  id: string;
  scope_type: string;
  scope_id: string;
  reason: string;
  applied_at: string;
  status: string;
}

export function OrgRetentionPanel() {
  const { toast } = useToast();

  const [orgs, setOrgs] = useState<OrgLite[]>([]);
  const [orgId, setOrgId] = useState<string>("");
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [floors, setFloors] = useState<Record<RecordClass, number>>({} as Record<RecordClass, number>);
  const [holds, setHolds] = useState<LegalHoldLite[]>([]);

  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Per-class edit state, keyed by record_class.
  const [edits, setEdits] = useState<Record<RecordClass, { days: string; reason: string }>>(() =>
    Object.fromEntries(RECORD_CLASSES.map((c) => [c, { days: "", reason: "" }])) as Record<RecordClass, { days: string; reason: string }>,
  );

  // MFA preflight (server requires AAL2 for set/clear).
  const [aalState, setAalState] = useState<"loading" | "aal1" | "aal2" | "unknown">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        if (error) { setAalState("unknown"); return; }
        const cur = data?.currentLevel;
        setAalState(cur === "aal2" ? "aal2" : cur === "aal1" ? "aal1" : "unknown");
      } catch {
        if (!cancelled) setAalState("unknown");
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const needsMfa = aalState === "aal1" || aalState === "unknown";

  // Load orgs once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name")
          .order("name", { ascending: true })
          .limit(1000);
        if (cancelled) return;
        if (error) {
          toast({ title: "Could not load organisations", description: error.message, variant: "destructive" });
          return;
        }
        setOrgs((data ?? []) as OrgLite[]);
      } catch (e) {
        if (!cancelled) {
          toast({ title: "Could not load organisations", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  const refresh = useCallback(async (selectedOrg: string) => {
    if (!selectedOrg) {
      setPolicies([]); setHolds([]); return;
    }
    setLoading(true);
    try {
      // Policies via edge fn (returns floors too).
      const { data: polRes, error: polErr } = await supabase.functions.invoke("admin-org-retention", {
        body: { action: "list", org_id: selectedOrg, limit: 100 },
      });
      if (polErr) {
        const parsed = await parseEdgeError(polErr);
        toast({ title: "Could not load policies", description: parsed.message, variant: "destructive" });
      } else {
        setPolicies((polRes?.policies ?? []) as PolicyRow[]);
        if (polRes?.floors) setFloors(polRes.floors as Record<RecordClass, number>);
      }

      // Org-scoped legal holds via the existing admin-legal-hold list action.
      const { data: holdRes, error: holdErr } = await supabase.functions.invoke("admin-legal-hold", {
        body: { action: "list", status: "active", scope_type: "org", scope_id: selectedOrg, limit: 100 },
      });
      if (holdErr) {
        const parsed = await parseEdgeError(holdErr);
        toast({ title: "Could not load org-scoped legal holds", description: parsed.message, variant: "destructive" });
      } else {
        setHolds((holdRes?.holds ?? []) as LegalHoldLite[]);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(orgId); }, [orgId, refresh]);

  const policyByClass = useMemo(() => {
    const m: Partial<Record<RecordClass, PolicyRow>> = {};
    for (const p of policies) m[p.record_class] = p;
    return m;
  }, [policies]);

  const handleSet = async (cls: RecordClass) => {
    const e = edits[cls];
    const days = parseInt(e.days, 10);
    if (!UUID_RE.test(orgId)) {
      toast({ title: "Select an organisation first", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Enter a positive number of days", variant: "destructive" });
      return;
    }
    const floor = floors[cls];
    if (floor && days < floor) {
      toast({
        title: "Below platform floor",
        description: `${cls} cannot be set below ${floor} days.`,
        variant: "destructive",
      });
      return;
    }
    if (e.reason.trim().length < 10) {
      toast({ title: "Reason required (≥10 chars)", variant: "destructive" });
      return;
    }
    setBusyKey(`set:${cls}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-org-retention", {
        body: { action: "set", org_id: orgId, record_class: cls, retention_days: days, reason: e.reason.trim() },
      });
      if (error) {
        const parsed = await parseEdgeError(error);
        toast({
          title: parsed.code === "MFA_REQUIRED" ? "MFA required" : "Could not set",
          description: parsed.message, variant: "destructive",
        });
        return;
      }
      if (data?.ok === false) {
        toast({ title: "Could not set", description: data?.message ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({
        title: `Policy ${data?.action ?? "saved"}`,
        description: `${cls}: ${days} days recorded. (Phase 1 shell - sweepers do not yet enforce.)`,
      });
      setEdits((s) => ({ ...s, [cls]: { days: "", reason: "" } }));
      refresh(orgId);
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({ title: "Could not set", description: parsed.message, variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  const handleClear = async (cls: RecordClass) => {
    const reason = window.prompt(`Reason for clearing per-org retention on ${cls} (≥10 chars):`);
    if (!reason || reason.trim().length < 10) {
      toast({ title: "Reason required (≥10 chars)", variant: "destructive" });
      return;
    }
    setBusyKey(`clear:${cls}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-org-retention", {
        body: { action: "clear", org_id: orgId, record_class: cls, reason: reason.trim() },
      });
      if (error) {
        const parsed = await parseEdgeError(error);
        toast({
          title: parsed.code === "MFA_REQUIRED" ? "MFA required" : "Could not clear",
          description: parsed.message, variant: "destructive",
        });
        return;
      }
      if (data?.ok === false) {
        toast({ title: "Could not clear", description: data?.message ?? "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Per-org policy cleared", description: data?.message ?? "Falling back to platform floor." });
      refresh(orgId);
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({ title: "Could not clear", description: parsed.message, variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Phase 1 shell - values recorded, not yet enforced</AlertTitle>
        <AlertDescription>
          Per-org retention windows are persisted and audited (
          <code>data.org_retention_policy.set</code> /{" "}
          <code>data.org_retention_policy.cleared</code>) but no sweeper reads
          this table yet. Existing global defaults remain in force:{" "}
          email send log = 90 days, all other classes = 7 years.
        </AlertDescription>
      </Alert>

      {needsMfa && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>
            {aalState === "unknown" ? "Could not confirm MFA status" : "Multi-factor authentication required"}
          </AlertTitle>
          <AlertDescription>
            Set and Clear require an MFA-verified session. Open{" "}
            <a href="/desk/settings/security" className="underline font-medium">
              Settings → Security
            </a>{" "}
            to verify your factor, then return.
          </AlertDescription>
        </Alert>
      )}

      {/* Org picker */}
      <div className="border border-border rounded-sm p-4 bg-muted/30 space-y-3">
        <div>
          <Label htmlFor="org-picker">Organisation</Label>
          <Select value={orgId} onValueChange={setOrgId}>
            <SelectTrigger id="org-picker">
              <SelectValue placeholder="Select an organisation…" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} <span className="ml-2 font-mono text-[10px] text-muted-foreground">{o.id.slice(0, 8)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {orgId && (
        <>
          {/* Org-scoped legal holds */}
          <div className="border border-border rounded-sm p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Active org-scoped legal holds</h3>
              <a
                href="/hq?tab=legal-holds"
                className="text-xs underline text-muted-foreground inline-flex items-center gap-1"
              >
                Apply / release in Legal Holds <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {loading ? (
              <div className="text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 inline animate-spin mr-2" /> Loading…
              </div>
            ) : holds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active legal holds with <code>scope_type='org'</code> for this organisation.
              </p>
            ) : (
              <ul className="space-y-2">
                {holds.map((h) => (
                  <li key={h.id} className="border border-border/60 rounded-sm p-2">
                    <Badge variant="destructive" className="gap-1">
                      <ShieldAlert className="h-3 w-3" /> Active hold
                    </Badge>
                    <p className="text-sm mt-1">{h.reason}</p>
                    <p className="text-[11px] font-mono text-muted-foreground mt-1">
                      applied {new Date(h.applied_at).toISOString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Per-class retention editor */}
          <div className="border border-border rounded-sm bg-card">
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold">Per-class retention windows</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Effective value = per-org override if set, otherwise platform floor.
                A value below the floor is rejected by the database.
              </p>
            </div>
            <div className="divide-y divide-border">
              {RECORD_CLASSES.map((cls) => {
                const current = policyByClass[cls];
                const floor = floors[cls];
                const edit = edits[cls];
                const isBusy = busyKey === `set:${cls}` || busyKey === `clear:${cls}`;
                return (
                  <div key={cls} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    <div className="md:col-span-3">
                      <div className="font-mono text-xs">{cls}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Floor: {floor ?? "-"} d
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Effective:{" "}
                        <span className="font-medium text-foreground">
                          {current?.retention_days ?? floor ?? "-"} d
                        </span>
                        {current && (
                          <Badge variant="outline" className="ml-2 text-[10px]">override</Badge>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <Label className="text-[11px]" htmlFor={`d-${cls}`}>Days</Label>
                      <Input
                        id={`d-${cls}`}
                        type="number"
                        min={1}
                        value={edit.days}
                        onChange={(e) => setEdits((s) => ({ ...s, [cls]: { ...s[cls], days: e.target.value } }))}
                        placeholder={String(floor ?? "")}
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="md:col-span-5">
                      <Label className="text-[11px]" htmlFor={`r-${cls}`}>Reason (≥10 chars)</Label>
                      <Textarea
                        id={`r-${cls}`}
                        rows={2}
                        value={edit.reason}
                        onChange={(e) => setEdits((s) => ({ ...s, [cls]: { ...s[cls], reason: e.target.value } }))}
                        placeholder="e.g. Regulatory request 2026-RX-118"
                      />
                    </div>

                    <div className="md:col-span-2 flex flex-col gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSet(cls)}
                        disabled={isBusy || needsMfa}
                      >
                        {isBusy && busyKey === `set:${cls}` && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                        Set
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleClear(cls)}
                        disabled={isBusy || needsMfa || !current}
                      >
                        {isBusy && busyKey === `clear:${cls}` && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                        Clear
                      </Button>
                    </div>

                    {current && (
                      <div className="md:col-span-12 border-t border-border/40 pt-2 -mt-1">
                        <p className="text-[11px] font-mono text-muted-foreground">
                          set {new Date(current.set_at).toISOString()} · by {current.set_by ?? "system"} · reason: {current.reason}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {!orgId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Select an organisation above to view or edit its retention policy.</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
