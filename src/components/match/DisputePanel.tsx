import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Dispute {
  id: string;
  reason: string;
  evidence_notes: string | null;
  status: string;
  resolution_outcome: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface DisputePanelProps {
  matchId: string;
  orgId: string;
}

export function DisputePanel({ matchId, orgId }: DisputePanelProps) {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  useEffect(() => {
    fetchDisputes();
  }, [matchId]);

  const fetchDisputes = async () => {
    try {
      const { data, error } = await supabase
        .from("disputes")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDisputes((data as Dispute[]) || []);
    } catch (err) {
      console.error("Error fetching disputes:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!reason.trim() || !user || submitting) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("disputes").insert({
        match_id: matchId,
        raised_by_org_id: orgId,
        raised_by_user_id: user.id,
        reason: reason.trim(),
        evidence_notes: evidence.trim() || null,
      });

      if (error) throw error;
      toast.success("Dispute raised successfully");
      setReason("");
      setEvidence("");
      setShowForm(false);
      fetchDisputes();
    } catch (err: any) {
      toast.error("Failed to raise dispute", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "open": return <Badge variant="destructive">Open</Badge>;
      case "under_review": return <Badge variant="secondary">Under Review</Badge>;
      case "resolved": return <Badge className="bg-green-500 hover:bg-green-600">Resolved</Badge>;
      case "escalated": return <Badge variant="destructive">Escalated</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />Disputes
        </h3>
        <Button variant="outline" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" />{showForm ? "Cancel" : "Raise Dispute"}
        </Button>
      </div>

      {showForm && (
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Raise a Dispute</CardTitle>
            <CardDescription>
              Disputes will freeze settlement until resolved. Provide clear reasons and evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Reason for Dispute</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe the issue in detail..."
                className="min-h-[80px]"
                aria-label="Dispute reason"
              />
            </div>
            <div className="space-y-2">
              <Label>Supporting Evidence (optional)</Label>
              <Textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Reference document IDs, communications, or specific discrepancies..."
                aria-label="Evidence notes"
              />
            </div>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Raising a dispute will notify the counterparty and may freeze settlement. This action is logged in the audit trail.
              </AlertDescription>
            </Alert>
            <Button variant="destructive" onClick={handleSubmit} disabled={submitting || !reason.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
              Submit Dispute
            </Button>
          </CardContent>
        </Card>
      )}

      {disputes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No disputes raised for this match.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {disputes.map((d) => (
            <Card key={d.id}>
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  {statusBadge(d.status)}
                  <span className="text-xs text-muted-foreground">{format(new Date(d.created_at), "dd MMM yyyy HH:mm")}</span>
                </div>
                <p className="text-sm font-medium">{d.reason}</p>
                {d.evidence_notes && <p className="text-sm text-muted-foreground">{d.evidence_notes}</p>}
                {d.resolution_outcome && (
                  <div className="bg-muted rounded p-2 text-sm">
                    <span className="font-medium">Resolution:</span> {d.resolution_outcome}
                    {d.resolved_at && <span className="text-xs text-muted-foreground ml-2">({format(new Date(d.resolved_at), "dd MMM yyyy")})</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
