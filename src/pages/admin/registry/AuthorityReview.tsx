import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/BackButton";
import { toast } from "sonner";
import { REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT } from "@/lib/registry-authority-workflow";

/**
 * Batch 12 — Authority review (admin detail).
 * Route: /admin/registry/authority/:authorityRequestId
 */
export default function AuthorityReview() {
  const { authorityRequestId } = useParams();
  const [ar, setAr] = useState<any>(null);
  const [scopes, setScopes] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: req }, { data: sc }, { data: dc }] = await Promise.all([
      supabase.from("registry_authority_requests").select("*").eq("id", authorityRequestId).maybeSingle(),
      supabase.from("registry_authority_request_scopes").select("*").eq("authority_request_id", authorityRequestId),
      supabase.from("registry_authority_scope_decisions").select("*").eq("authority_request_id", authorityRequestId),
    ]);
    setAr(req);
    setScopes(sc ?? []);
    setDecisions(dc ?? []);
  };
  useEffect(() => { void load(); }, [authorityRequestId]);

  const approveFull = async () => {
    if (!acknowledged) { toast.error("Acknowledgement required"); return; }
    if (!reason.trim()) { toast.error("Reason required"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-authority-review", {
        body: {
          authority_request_id: authorityRequestId,
          action: "approve_full_request",
          reason,
          acknowledgement: REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT,
        },
      });
      if (error) throw error;
      toast.success("Authority approved");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string) => {
    if (!reason.trim()) { toast.error("Reason required"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("registry-authority-review", {
        body: { authority_request_id: authorityRequestId, action, reason },
      });
      if (error) throw error;
      toast.success(action);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!ar) return <div className="container py-8">Loading…</div>;

  return (
    <div className="container max-w-3xl py-8 space-y-4">
      <BackButton />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{ar.company_name}</span>
            <Badge>{ar.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>Country: {ar.country_code}</div>
          <div>Sensitive: {ar.is_sensitive ? "yes" : "no"}</div>
          <div>Two-person required: {ar.two_person_required ? "yes" : "no"}</div>
          <div>Requested scopes: {(ar.requested_scopes ?? []).join(", ")}</div>
          <div>Scope rows: {scopes.length} | Decisions recorded: {decisions.length}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Review decision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Reason (required for every action except simple assignment)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(!!v)} />
            <span>{REGISTRY_AUTHORITY_B12_APPROVAL_ACKNOWLEDGEMENT}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act("start_review")} disabled={busy} variant="outline">Start review</Button>
            <Button onClick={() => act("request_more_evidence")} disabled={busy} variant="outline">Request more evidence</Button>
            <Button onClick={() => act("reject_request")} disabled={busy} variant="destructive">Reject</Button>
            <Button onClick={() => act("suspend_authority")} disabled={busy} variant="outline">Suspend</Button>
            <Button onClick={() => act("revoke_authority")} disabled={busy} variant="destructive">Revoke</Button>
            <Button onClick={approveFull} disabled={busy || !acknowledged}>Approve full request</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
