/**
 * AdminComplianceHoldPanel - HQ Compliance sub-tab.
 *
 * Lists active compliance_holds joined to operator_verification_requests
 * (Verification Queue). Allows platform admins to Release or Close a hold
 * with a mandatory reason (≥20 chars). AAL2 enforcement happens server-
 * side in the edge functions.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { ShieldAlert, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MIN_REASON_LENGTH = 20;

type HoldRow = {
  id: string;
  org_id: string;
  entity_id: string | null;
  hold_type: string;
  reason: string;
  source_check_id: string | null;
  source_check_type: string | null;
  status: "active" | "released" | "closed";
  opened_at: string;
  released_at: string | null;
  release_reason: string | null;
  metadata: Record<string, unknown> | null;
};

function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function holdLabel(t: string): string {
  if (t.includes("sanctions_potential_match")) return "Sanctions - potential match";
  if (t.includes("sanctions")) return "Sanctions screening";
  if (t.includes("verification_failed")) return "Verification failed";
  return "Verification refresh";
}

export function AdminComplianceHoldPanel() {
  const [holds, setHolds] = useState<HoldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<HoldRow | null>(null);
  const [mode, setMode] = useState<"release" | "close" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("compliance_holds")
        .select(
          "id, org_id, entity_id, hold_type, reason, source_check_id, source_check_type, status, opened_at, released_at, release_reason, metadata",
        )
        .order("opened_at", { ascending: false })
        .limit(200);
      if (err) throw err;
      setHolds((data ?? []) as HoldRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load compliance holds.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDialog = (h: HoldRow, m: "release" | "close") => {
    setActive(h);
    setMode(m);
    setReason("");
  };

  const closeDialog = () => {
    setActive(null);
    setMode(null);
    setReason("");
  };

  const submit = async () => {
    if (!active || !mode) return;
    if (reason.trim().length < MIN_REASON_LENGTH) {
      toast({
        title: "Reason too short",
        description: `Provide at least ${MIN_REASON_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const fn =
        mode === "release"
          ? "admin-compliance-hold-release"
          : "admin-compliance-hold-close";
      const { data, error: err } = await supabase.functions.invoke(fn, {
        body: { hold_id: active.id, reason: reason.trim() },
      });
      if (err) throw err;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error?: string }).error);
      }
      toast({
        title: mode === "release" ? "Hold released" : "Hold closed",
        description: "Audit recorded. Re-run compliance checks before progression.",
      });
      closeDialog();
      await load();
    } catch (e) {
      toast({
        title: mode === "release" ? "Release failed" : "Close failed",
        description: e instanceof Error ? e.message : "Unexpected error.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Compliance Holds (COMP-002 / COMP-012)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && holds.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No compliance holds recorded.
          </p>
        )}
        <div className="space-y-2">
          {holds.map((h) => (
            <div
              key={h.id}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{holdLabel(h.hold_type)}</span>
                    <Badge
                      variant={h.status === "active" ? "destructive" : "outline"}
                      className="text-xs"
                    >
                      {h.status}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {h.hold_type}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{h.reason}</p>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Org: <span className="font-mono">{h.org_id.slice(0, 8)}</span></span>
                    {h.entity_id && (
                      <span>Entity: <span className="font-mono">{h.entity_id.slice(0, 8)}</span></span>
                    )}
                    <span>Opened {ageInDays(h.opened_at)}d ago</span>
                    {h.source_check_type && (
                      <span>Source: {h.source_check_type}</span>
                    )}
                  </div>
                  {h.release_reason && (
                    <p className="text-xs text-muted-foreground italic">
                      Release: {h.release_reason}
                    </p>
                  )}
                </div>
                {h.status === "active" && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDialog(h, "release")}
                    >
                      Release
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDialog(h, "close")}
                    >
                      Close
                    </Button>
                  </div>
                )}
                {h.status === "released" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openDialog(h, "close")}
                  >
                    Close
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!active && !!mode} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {mode === "release" ? "Release compliance hold" : "Close compliance hold"}
            </DialogTitle>
            <DialogClose asChild>
              <button
                aria-label="Close"
                className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {mode === "release"
                ? "Releasing allows progression to resume only if freshness evidence is now valid. AAL2 is required."
                : "Closing marks the hold terminal. Use for resolved or obsolete holds. AAL2 is required."}
            </p>
            <Textarea
              placeholder={`Mandatory reason (≥${MIN_REASON_LENGTH} characters)`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {reason.trim().length}/{MIN_REASON_LENGTH}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={submitting || reason.trim().length < MIN_REASON_LENGTH}
            >
              {submitting
                ? "Submitting…"
                : mode === "release"
                ? "Release hold"
                : "Close hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default AdminComplianceHoldPanel;
