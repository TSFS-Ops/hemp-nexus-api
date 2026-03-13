import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import { AlertTriangle, Shield, Loader2, Lock, Unlock, Clock } from "lucide-react";
import { toast } from "sonner";

interface BreakGlassAction {
  id: string;
  actor_user_id: string;
  action_type: string;
  reason: string;
  target_org_id: string | null;
  created_at: string;
}

export function BreakGlassPanel() {
  const [actions, setActions] = useState<BreakGlassAction[]>([]);
  const [globalFrozen, setGlobalFrozen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionType, setActionType] = useState("");
  const [reason, setReason] = useState("");
  const [targetOrgId, setTargetOrgId] = useState("");

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/break-glass`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to fetch");
      }

      const data = await response.json();
      setActions(data.actions || []);
      setGlobalFrozen(data.globalCollapseFrozen || false);
    } catch (error) {
      console.error("Break-glass fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchActions(); }, [fetchActions]);

  const executeAction = async () => {
    if (!actionType || !reason) {
      toast.error("Action type and reason are required");
      return;
    }

    const needsTarget = ["freeze_org", "unfreeze_org", "freeze_api_keys", "unfreeze_api_keys"].includes(actionType);
    if (needsTarget && !targetOrgId) {
      toast.error("Target organisation ID is required for this action");
      return;
    }

    try {
      setExecuting(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/break-glass`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action_type: actionType,
            reason,
            target_org_id: needsTarget ? targetOrgId : undefined,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to execute");
      }

      toast.success(`Break-glass action '${actionType}' executed`);
      setActionType("");
      setReason("");
      setTargetOrgId("");
      fetchActions();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to execute action";
      toast.error(msg);
    } finally {
      setExecuting(false);
    }
  };

  const actionLabels: Record<string, string> = {
    freeze_org: "Freeze Organisation",
    unfreeze_org: "Unfreeze Organisation",
    freeze_api_keys: "Freeze API Keys",
    unfreeze_api_keys: "Unfreeze API Keys",
    global_collapse_freeze: "Global Collapse Freeze",
    global_collapse_unfreeze: "Global Collapse Unfreeze",
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Break-Glass Protocol</h2>
        <p className="text-muted-foreground mt-2">
          Director-level emergency actions. All actions are append-only audit logged. No data deletion permitted.
        </p>
      </div>

      {/* Global status */}
      <Card className={globalFrozen ? "border-destructive" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {globalFrozen ? <Lock className="h-5 w-5 text-destructive" /> : <Unlock className="h-5 w-5" />}
            Global Collapse Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant={globalFrozen ? "destructive" : "default"} className="text-sm">
            {globalFrozen ? "FROZEN — All collapse operations halted" : "ACTIVE — Collapse operations normal"}
          </Badge>
        </CardContent>
      </Card>

      {/* Execute action */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Execute Break-Glass Action
          </CardTitle>
          <CardDescription>Director role required. All actions are irrevocably logged.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Action Type</Label>
            <Select value={actionType} onValueChange={setActionType}>
              <SelectTrigger aria-label="Select action type">
                <SelectValue placeholder="Select action…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(actionLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {["freeze_org", "unfreeze_org", "freeze_api_keys", "unfreeze_api_keys"].includes(actionType) && (
            <div className="space-y-2">
              <Label htmlFor="targetOrgId">Target Organisation ID</Label>
              <Input
                id="targetOrgId"
                placeholder="UUID of the target organisation"
                value={targetOrgId}
                onChange={(e) => setTargetOrgId(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">Reason (mandatory)</Label>
            <Textarea
              id="reason"
              placeholder="Provide detailed justification for this action…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <Button
            variant="destructive"
            onClick={executeAction}
            disabled={executing || !actionType || !reason}
            className="w-full"
          >
            {executing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Executing…</>
            ) : (
              <><Shield className="h-4 w-4 mr-2" />Execute Break-Glass Action</>
            )}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Action log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Break-Glass Action Log
          </CardTitle>
          <CardDescription>Append-only. Cannot be deleted or modified.</CardDescription>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No break-glass actions recorded.</p>
          ) : (
            <div className="space-y-3">
              {actions.map((action) => (
                <div key={action.id} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">{actionLabels[action.action_type] || action.action_type}</Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(action.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{action.reason}</p>
                  <div className="text-xs text-muted-foreground font-mono">
                    Actor: {action.actor_user_id.substring(0, 8)}…
                    {action.target_org_id && <> | Target: {action.target_org_id.substring(0, 8)}…</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
