/**
 * OperatorVerificationClipOn — admin-only verification request raiser
 * ────────────────────────────────────────────────────────────────────
 * Implements the "optional clip-on" from Daniel's 2026-04-27 directive:
 *
 *   "I want an optional clip-on that allows US to carry out ID
 *    verification and organisation verification where needed (e.g. the
 *    current conversation with Orca). In other words, verification
 *    should be available as an additional tool or step that we can
 *    apply if the circumstances call for it, but it should NOT be a
 *    mandatory gateway before POI."
 *
 * Only renders for users with the `platform_admin` role (RLS on
 * `operator_verification_requests` enforces the same boundary on the
 * server). Lists existing requests for this match and lets an operator
 * raise a new one.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldPlus, UserCheck, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Match } from "@/hooks/use-match-details";

interface VerificationRow {
  id: string;
  match_id: string | null;
  subject_name: string;
  kind: "idv" | "org" | "both";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  outcome: "verified" | "rejected" | "inconclusive" | null;
  reason: string | null;
  reviewer_notes: string | null;
  created_at: string;
  completed_at: string | null;
}

const KIND_LABELS: Record<VerificationRow["kind"], string> = {
  idv: "Identity (IDV)",
  org: "Organisation (KYB)",
  both: "Identity + Organisation",
};

const STATUS_VARIANT: Record<VerificationRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  in_progress: "secondary",
  completed: "default",
  cancelled: "destructive",
};

export function OperatorVerificationClipOn({ match }: { match: Match }) {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [subjectName, setSubjectName] = useState(match.buyer_name || match.seller_name || "");
  const [side, setSide] = useState<"buyer" | "seller" | "other">(
    match.buyer_name ? "buyer" : match.seller_name ? "seller" : "other"
  );
  const [kind, setKind] = useState<VerificationRow["kind"]>("both");
  const [reason, setReason] = useState("");

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

  const { data: rows = [], refetch } = useQuery({
    queryKey: ["operator-verification-requests", match.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operator_verification_requests")
        .select("*")
        .eq("match_id", match.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as VerificationRow[];
    },
    enabled: isAdmin === true,
  });

  if (!isAdmin) return null;

  const handleSubmit = async () => {
    if (!session) return;
    if (!subjectName.trim()) {
      toast.error("Subject name is required");
      return;
    }
    setSubmitting(true);
    try {
      const subjectOrgId =
        side === "buyer" ? (match as any).buyer_id ?? null
          : side === "seller" ? (match as any).seller_id ?? null
            : null;

      const { error } = await supabase.from("operator_verification_requests").insert({
        match_id: match.id,
        org_id: (match as any).org_id ?? null,
        subject_org_id: subjectOrgId,
        subject_name: subjectName.trim(),
        kind,
        reason: reason.trim() || null,
        raised_by: session.user.id,
      });
      if (error) throw error;
      toast.success("Verification request raised");
      setOpen(false);
      setReason("");
      refetch();
    } catch (e: any) {
      toast.error(`Could not raise request: ${e.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-amber-200/70 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldPlus className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          Operator verification clip-on
          <Badge variant="outline" className="text-[10px]">Admin only</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1.5">
          Optional. Use this when circumstances call for ID or organisation
          verification (e.g. the Orca conversation). Not a gate on POI.
          Hard verification still runs at WaD via the 9-gate engine.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verification requests on this match.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border bg-background p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{r.subject_name}</span>
                    <Badge variant="secondary" className="text-[10px]">{KIND_LABELS[r.kind]}</Badge>
                    <Badge variant={STATUS_VARIANT[r.status]} className="text-[10px] capitalize">
                      {r.status.replace("_", " ")}
                    </Badge>
                    {r.outcome && (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {r.outcome}
                      </Badge>
                    )}
                  </div>
                  {r.reason && <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Raised {new Date(r.created_at).toLocaleString()}
                    {r.completed_at && ` • Closed ${new Date(r.completed_at).toLocaleString()}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Raise verification request
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Raise verification request</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Side</Label>
                <Select value={side} onValueChange={(v) => setSide(v as any)}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {match.buyer_name && (
                      <SelectItem value="buyer">Buyer — {match.buyer_name}</SelectItem>
                    )}
                    {match.seller_name && (
                      <SelectItem value="seller">Seller — {match.seller_name}</SelectItem>
                    )}
                    <SelectItem value="other">Other / custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Subject name</Label>
                <Textarea
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  rows={1}
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Verification kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as VerificationRow["kind"])}>
                  <SelectTrigger className="h-9 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="idv">
                      <span className="flex items-center gap-2"><UserCheck className="h-3.5 w-3.5" /> Identity only</span>
                    </SelectItem>
                    <SelectItem value="org">
                      <span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" /> Organisation only</span>
                    </SelectItem>
                    <SelectItem value="both">Identity + Organisation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is verification needed for this match?"
                  rows={3}
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
                Raise request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
