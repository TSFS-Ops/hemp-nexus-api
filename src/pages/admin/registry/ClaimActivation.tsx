/**
 * Batch 10 — Admin claim activation & record lifecycle page.
 * Read-only listing + reasoned action invocations. Admin/compliance only.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import BackButton from "@/components/BackButton";
import {
  REGISTRY_RECORD_LIFECYCLE_STATES,
  publicLifecycleLabel,
  type RegistryRecordLifecycleState,
} from "@/lib/registry-record-lifecycle";

interface RecordRow {
  id: string;
  company_name: string;
  country_code: string;
  lifecycle_state: RegistryRecordLifecycleState;
  claim_activation_state: string;
  is_stale: boolean;
  public_display_allowed: boolean;
}

export default function AdminRegistryClaimActivation() {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [nextState, setNextState] = useState<RegistryRecordLifecycleState>("claim_enabled");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function load() {
    const { data, error } = await supabase
      .from("registry_company_records")
      .select("id, company_name, country_code, lifecycle_state, claim_activation_state, is_stale, public_display_allowed")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) toast({ title: "Load failed", description: error.message, variant: "destructive" });
    else setRows((data ?? []) as RecordRow[]);
  }

  useEffect(() => { load(); }, []);

  async function runAvailability(r: RecordRow) {
    setSelected(r);
    setCheck(null);
    const { data, error } = await supabase.functions.invoke("registry-claim-availability-check", {
      body: { record_id: r.id },
    });
    if (error) toast({ title: "Check failed", description: error.message, variant: "destructive" });
    else setCheck(data);
  }

  async function applyTransition() {
    if (!selected) return;
    if (reason.trim().length < 10) {
      toast({ title: "Reason required", description: "Provide a reason of at least 10 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("registry-record-lifecycle-manage", {
        body: { record_id: selected.id, next_state: nextState, reason, transition_kind: "admin_manual" },
      });
      if (error) throw error;
      toast({ title: "Lifecycle updated" });
      setReason("");
      await load();
      await runAvailability(selected);
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <BackButton />
      <header>
        <h1 className="text-2xl font-semibold">Claim activation & record lifecycle</h1>
        <p className="text-sm text-muted-foreground">
          Move imported records through lifecycle states. Approving claim activation only enables
          the claim workflow — it does not verify the company, authority or bank details.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle>Records</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <div className="font-medium">{r.company_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.country_code} · lifecycle: <code>{r.lifecycle_state}</code> · public: {publicLifecycleLabel(r.lifecycle_state, r.is_stale)}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {r.is_stale && <Badge variant="outline">stale</Badge>}
                  {r.public_display_allowed ? <Badge variant="secondary">public</Badge> : <Badge variant="outline">non-public</Badge>}
                  <Button size="sm" variant="outline" onClick={() => runAvailability(r)}>
                    Check availability
                  </Button>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No records.</p>}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>Action — {selected.company_name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {check && (
              <div className="rounded border p-3 text-sm">
                <div><strong>Engine result:</strong> {check.result}</div>
                <div><strong>Public reason:</strong> {check.public_reason}</div>
                {check.internal_reason && <div><strong>Internal reason:</strong> {check.internal_reason}</div>}
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Next lifecycle state</label>
              <Select value={nextState} onValueChange={(v) => setNextState(v as RegistryRecordLifecycleState)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGISTRY_RECORD_LIFECYCLE_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Reason (required, ≥10 chars)</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            <Button onClick={applyTransition} disabled={loading}>
              Apply transition
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
