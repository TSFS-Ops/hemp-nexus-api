import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";

interface ComplianceCase {
  id: string;
  org_id: string;
  entity_id: string;
  status: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_notes: string | null;
  created_at: string;
}

const STATUS_COLOURS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  cleared: "default",
  escalated: "outline",
  blocked: "destructive",
};

export function AdminComplianceCasesPanel() {
  const [cases, setCases] = useState<ComplianceCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionCase, setActionCase] = useState<ComplianceCase | null>(null);
  const [actionType, setActionType] = useState<string>("");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("compliance_cases")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setCases((data as ComplianceCase[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const handleCaseAction = async () => {
    if (!actionCase || !actionType || !decisionNotes.trim()) return;
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("compliance_cases")
        .update({
          status: actionType,
          decision_notes: decisionNotes.trim(),
          decided_at: new Date().toISOString(),
          decided_by: user?.id ?? null,
        })
        .eq("id", actionCase.id);
      if (error) throw error;

      await supabase.from("admin_audit_logs").insert({
        admin_user_id: user?.id ?? "",
        action: `compliance_case_${actionType}`,
        target_type: "compliance_case",
        target_id: actionCase.id,
        details: { previous_status: actionCase.status, new_status: actionType, notes: decisionNotes.trim() } as any,
      });

      toast.success(`Case ${actionType}`);
      setActionCase(null);
      setActionType("");
      setDecisionNotes("");
      fetchData();
    } catch (err: any) {
      toast.error("Failed to update case", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const statusCounts = cases.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Compliance Cases</h2>
          <p className="text-muted-foreground mt-1">
            Entity compliance case management — blocks WaD issuance when open
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["open", "cleared", "escalated", "blocked"].map((s) => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground capitalize">{s}</CardTitle>
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{statusCounts[s] || 0}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            All Cases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decision Notes</TableHead>
                <TableHead>Decided</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
               </TableRow>
             </TableHeader>
            <TableBody>
              {cases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No compliance cases yet
                  </TableCell>
                </TableRow>
              ) : cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.id.slice(0, 8)}…</TableCell>
                  <TableCell className="font-mono text-xs">{c.entity_id.slice(0, 8)}…</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_COLOURS[c.status] || "secondary"}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[250px] truncate">{c.decision_notes || "—"}</TableCell>
                  <TableCell>{c.decided_at ? format(new Date(c.decided_at), "dd MMM yyyy HH:mm") : "—"}</TableCell>
                  <TableCell>{format(new Date(c.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                  <TableCell>
                    {(c.status === "open" || c.status === "escalated") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setActionCase(c); setActionType(""); setDecisionNotes(""); }}
                      >
                        Resolve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
