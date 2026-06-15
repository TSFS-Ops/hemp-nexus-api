import { useState } from "react";
// Batch S: client no longer issues direct DB writes - all overrides go via
// the admin-manual-overrides edge function which is the only audited path.
import { apiFetch } from "@/lib/api-client";
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
    // Batch S SUP-001: client-side floor must mirror server (>=10 chars).
    // Server is authoritative - this is just UX feedback.
    if (reason.trim().length < 10) {
      toast.error("Reason must be at least 10 characters");
      return;
    }

    setExecuting(true);
    try {
      // Batch S SUP-001 / AUD-016: ALL manual overrides go through the
      // server route. Server enforces is_admin + AAL2 + reason floor +
      // before/after snapshot and writes the audit row server-side.
      // Direct client RPC + client-side audit inserts are no longer used here.
      const body: Record<string, unknown> = { operation: action, reason: reason.trim() };
      if (action === "force_status") {
        body.match_id = targetId.trim();
        body.new_status = newStatus;
      } else if (action === "void_match") {
        body.match_id = targetId.trim();
      } else if (action === "rerun_screening") {
        body.entity_id = targetId.trim();
      } else if (action === "regenerate_evidence") {
        body.match_id = targetId.trim();
      }

      const res = await apiFetch("admin-manual-overrides", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });

      const successCopy: Record<OverrideAction, string> = {
        force_status: `Match status forced to "${newStatus}"`,
        rerun_screening: "Screening re-run initiated",
        regenerate_evidence: "Evidence pack regeneration initiated",
        void_match: "Match voided",
      };
      toast.success(successCopy[action as OverrideAction]);
      void res;

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
    void_match: { label: "Void Match", icon: XCircle, description: "Void a match entirely - removes it from active workflows." },
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
          <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Support Investigation</CardTitle>
          <CardDescription>Tools for investigating user-reported issues.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            To investigate a user's account or view their data, use the tools available on this page:
          </p>
          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
            <li><strong>Users & Orgs</strong> - view user profiles, roles, and organisation membership</li>
            <li><strong>Audit Trail</strong> - search for specific user actions by actor ID</li>
            <li><strong>Matches</strong> - look up matches by ID to see full state history</li>
            <li><strong>Manual Override</strong> - correct data issues with a mandatory reason</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            User impersonation (view-as) is not available. All investigations use admin-level access with full audit logging.
          </p>
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
