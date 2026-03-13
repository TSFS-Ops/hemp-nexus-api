import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Wrench, Loader2, AlertTriangle, RotateCcw, ShieldCheck, XCircle, RefreshCw, Eye } from "lucide-react";
import { toast } from "sonner";

type OverrideAction = "force_status" | "rerun_screening" | "regenerate_evidence" | "void_match";

export function AdminManualOverrides() {
  const [action, setAction] = useState<OverrideAction | "">("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const executeOverride = async () => {
    if (!action || !targetId.trim() || !reason.trim()) {
      toast.error("All fields are required");
      return;
    }

    setExecuting(true);
    try {
      const adminUserId = (await supabase.auth.getUser()).data.user?.id ?? "";

      switch (action) {
        case "force_status": {
          // Use safe_transition_match_state to enforce state guards
          // First read current state to populate expected_state
          const { data: currentMatch, error: fetchError } = await supabase
            .from("matches")
            .select("state, org_id")
            .eq("id", targetId.trim())
            .maybeSingle();
          if (fetchError) throw fetchError;
          if (!currentMatch) throw new Error("Match not found");

          const { data: result, error: rpcError } = await supabase.rpc(
            "safe_transition_match_state",
            {
              p_match_id: targetId.trim(),
              p_org_id: currentMatch.org_id,
              p_expected_state: currentMatch.state ?? "discovery",
              p_new_state: newStatus,
              p_update_fields: { status: newStatus },
            }
          );
          if (rpcError) throw rpcError;
          const rpcResult = result as any;
          if (rpcResult && !rpcResult.success) {
            throw new Error(rpcResult.message || "State transition rejected");
          }

          // Log admin action
          await supabase.from("admin_audit_logs").insert({
            admin_user_id: adminUserId,
            action: "force_status_change",
            target_type: "match",
            target_id: targetId.trim(),
            details: { new_status: newStatus, previous_state: currentMatch.state, reason } as any,
          });
          toast.success(`Match status forced to "${newStatus}"`);
          break;
        }
        case "rerun_screening": {
          const { error } = await supabase.functions.invoke("dilisense-screen", {
            method: "POST",
            body: { entity_id: targetId.trim(), force: true },
          });
          if (error) throw error;
          await supabase.from("admin_audit_logs").insert({
            admin_user_id: (await supabase.auth.getUser()).data.user?.id ?? "",
            action: "rerun_screening",
            target_type: "entity",
            target_id: targetId.trim(),
            details: { reason } as any,
          });
          toast.success("Screening re-run initiated");
          break;
        }
        case "regenerate_evidence": {
          const { error } = await supabase.functions.invoke("evidence-pack", {
            method: "POST",
            body: { match_id: targetId.trim(), force_regenerate: true },
          });
          if (error) throw error;
          await supabase.from("admin_audit_logs").insert({
            admin_user_id: (await supabase.auth.getUser()).data.user?.id ?? "",
            action: "regenerate_evidence_pack",
            target_type: "match",
            target_id: targetId.trim(),
            details: { reason } as any,
          });
          toast.success("Evidence pack regeneration initiated");
          break;
        }
        case "void_match": {
          const { error } = await supabase
            .from("matches")
            .update({ status: "voided" })
            .eq("id", targetId.trim());
          if (error) throw error;
          await supabase.from("admin_audit_logs").insert({
            admin_user_id: (await supabase.auth.getUser()).data.user?.id ?? "",
            action: "void_match",
            target_type: "match",
            target_id: targetId.trim(),
            details: { reason } as any,
          });
          toast.success("Match voided");
          break;
        }
      }

      setTargetId("");
      setReason("");
      setNewStatus("");
      setAction("");
    } catch (err: any) {
      console.error("Override error:", err);
      toast.error("Override failed", { description: err.message });
    } finally {
      setExecuting(false);
      setConfirmOpen(false);
    }
  };

  const actionConfig = {
    force_status: { label: "Force Match Status", icon: ShieldCheck, description: "Override a match's status to a specific value." },
    rerun_screening: { label: "Re-run Screening", icon: RefreshCw, description: "Force re-run sanctions/PEP screening on an entity." },
    regenerate_evidence: { label: "Regenerate Evidence Pack", icon: RotateCcw, description: "Force regeneration of the evidence pack for a match." },
    void_match: { label: "Void Match", icon: XCircle, description: "Void a match entirely — removes it from active workflows." },
  };

  return (
    <div className="space-y-6">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Manual overrides are logged in the admin audit trail. Use these tools only when automated workflows fail or require intervention.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Manual Override</CardTitle>
          <CardDescription>Select an action, provide the target ID, and a mandatory reason for the override.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as OverrideAction)}>
              <SelectTrigger aria-label="Select override action">
                <SelectValue placeholder="Select an override action" />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(actionConfig) as [OverrideAction, typeof actionConfig.force_status][]).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {action && (
              <p className="text-xs text-muted-foreground">{actionConfig[action as OverrideAction].description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Target ID (Match ID or Entity ID)</Label>
            <Input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="UUID of the target resource"
              className="font-mono"
              aria-label="Target ID"
            />
          </div>

          {action === "force_status" && (
            <div className="space-y-2">
              <Label>New Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger aria-label="Select new status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matched">Matched</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason (mandatory)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this override is necessary..."
              className="min-h-[60px]"
              aria-label="Override reason"
            />
          </div>

          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={!action || !targetId.trim() || !reason.trim() || (action === "force_status" && !newStatus)}
          >
            <Wrench className="h-4 w-4 mr-2" />Execute Override
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Impersonation (View As)</CardTitle>
          <CardDescription>View the platform as a specific user for support purposes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              User impersonation is coming soon. This feature will allow support staff to view the dashboard as a specific user without gaining write access.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Override</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to execute: <strong>{action && actionConfig[action as OverrideAction]?.label}</strong> on target <code className="bg-muted px-1 rounded">{targetId.slice(0, 12)}…</code>.
              This action will be permanently logged in the admin audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeOverride} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={executing}>
              {executing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Confirm & Execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
