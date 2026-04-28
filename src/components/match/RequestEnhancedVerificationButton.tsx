/**
 * RequestEnhancedVerificationButton — minimal, user-facing entry point
 * ────────────────────────────────────────────────────────────────────
 * Implements Daniel's 2026-04-28 directive:
 *
 *   "users may have a simple 'Request Enhanced Verification' option where
 *    appropriate; all review, outcome recording, notes and audit trail
 *    should be handled by admin."
 *
 * The verification clip-on no longer lives inline in the trading workflow.
 * Trade users only see this small button; pressing it raises a pending
 * case in the admin-managed queue (HQ → Verification Queue) and writes an
 * audit log entry. Users can see only the status of requests they raised.
 *
 * Platform admins are intentionally NOT shown this button — they manage
 * everything from HQ → Verification Queue.
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Match } from "@/hooks/use-match-details";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

interface OwnRequestRow {
  id: string;
  status: Status;
  outcome: "verified" | "rejected" | "inconclusive" | null;
  created_at: string;
  completed_at: string | null;
}

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  in_progress: "secondary",
  completed: "default",
  cancelled: "destructive",
};

export function RequestEnhancedVerificationButton({ match }: { match: Match }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");

  // Hide the button from admins — they manage cases from HQ.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "platform_admin")
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!error && !!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Show the user the status of any case THEY raised on this match
  // (RLS hides notes/outcome owned by other users).
  const { data: ownRows = [] } = useQuery({
    queryKey: ["own-verification-requests", match.id, session?.user.id],
    enabled: !!session && isAdmin === false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operator_verification_requests")
        .select("id, status, outcome, created_at, completed_at")
        .eq("match_id", match.id)
        .eq("raised_by", session!.user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as OwnRequestRow[];
    },
  });

  if (isAdmin !== false) return null; // wait until role resolved; admins see HQ instead

  const userOrgQuery = async (): Promise<string | null> => {
    const { data } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", session!.user.id)
      .maybeSingle();
    return (data?.org_id as string | null) ?? null;
  };

  const handleSubmit = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      const orgId = await userOrgQuery();
      if (!orgId) {
        toast.error("Your profile is not linked to an organisation.");
        return;
      }
      // We deliberately default the subject_name to the OTHER side of the
      // match — that's the counterparty the user wants additional comfort on.
      // We send "both" (IDV + KYB) so admins have full latitude to scope the
      // case down when they action it.
      const myOrgId = orgId;
      const counterpartyName =
        ((match as any).buyer_id === myOrgId ? match.seller_name : match.buyer_name) ||
        match.seller_name ||
        match.buyer_name ||
        "Counterparty";

      const { error } = await supabase
        .from("operator_verification_requests")
        .insert({
          match_id: match.id,
          org_id: orgId,
          subject_org_id: null,
          subject_name: counterpartyName,
          kind: "both",
          status: "pending",
          reason: reason.trim() || null,
          raised_by: session.user.id,
        });
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("You already have an open verification request for this match. The admin team is reviewing it.");
        } else {
          throw error;
        }
        return;
      }

      // Audit log so the request is visible in the immutable trail.
      await supabase.from("audit_logs").insert([{
        org_id: orgId,
        actor_user_id: session.user.id,
        action: "verification.requested_by_user",
        entity_type: "match",
        entity_id: match.id,
        metadata: {
          counterparty: counterpartyName,
          reason_len: reason.trim().length,
        },
      }]);

      toast.success("Request sent to the Izenzo team for review.");
      setOpen(false);
      setReason("");
      qc.invalidateQueries({ queryKey: ["own-verification-requests", match.id] });
    } catch (e: any) {
      toast.error(`Could not send request: ${e?.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openRow = ownRows.find((r) => r.status === "pending" || r.status === "in_progress");

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {ownRows.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Your verification request:</span>
          <Badge variant={STATUS_VARIANT[ownRows[0].status]} className="text-[10px] capitalize">
            {ownRows[0].status.replace("_", " ")}
          </Badge>
          {ownRows[0].outcome && (
            <Badge variant="outline" className="text-[10px] capitalize">
              {ownRows[0].outcome}
            </Badge>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground hover:text-foreground" disabled={!!openRow}>
            <ShieldQuestion className="h-3.5 w-3.5" />
            {openRow ? "Verification request pending" : "Request enhanced verification"}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request enhanced verification</DialogTitle>
            <DialogDescription>
              Send a request to the Izenzo team to perform additional checks on the
              other side of this match. A reviewer will action the case and the
              outcome will be recorded against this match. This does not block any
              part of your trading workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Why are you asking? (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Anything specific you'd like the reviewer to look at?"
                rows={4}
                className="mt-1 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
