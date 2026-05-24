import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Lock, ShieldCheck, AlertTriangle } from "lucide-react";

interface BrdConstraint {
  id: string;
  constraint_key: string;
  description: string;
  locked: boolean;
  current_value: string;
  last_changed_at: string;
}

export function BrdConstraintsPanel() {
  const [constraints, setConstraints] = useState<BrdConstraint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConstraints();
  }, []);

  const fetchConstraints = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("brd_constraints")
        .select("*")
        .order("constraint_key");

      if (error) throw error;
      setConstraints((data as unknown as BrdConstraint[]) || []);
    } catch (error) {
      console.error("Error fetching BRD constraints:", error);
      toast.error("Failed to load BRD constraints");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const keyLabels: Record<string, string> = {
    rpo_zero: "RPO = 0 (Synchronous Replication)",
    idempotency_mandatory: "Mandatory Idempotency Keys",
    signed_payload_required: "ECDSA Signed Payload Enforcement",
    partition_consistency: "CP Mode (Partition Rejection)",
    append_only_ledger: "Append-Only Completion Ledger",
    minimum_retention_years: "Minimum Data Retention",
    hash_algorithm: "Hash Algorithm",
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">BRD Constraints</h2>
        <p className="text-muted-foreground mt-2">
          These constraints are locked and cannot be modified without a Director-level change record and formal BRD revision approval.
        </p>
      </div>

      <Card className="border-amber-500/30 bg-amber-50/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Change Control Policy
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Any modification to these constraints requires: (1) a formal BRD revision request, (2) Director-level written approval, and (3) a permanent change record in the audit trail. These safeguards ensure that critical system invariants cannot be altered without governance oversight.
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {constraints.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {c.locked ? <Lock className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4" />}
                  {keyLabels[c.constraint_key] || c.constraint_key}
                </CardTitle>
                <Badge
                  variant={c.locked ? "secondary" : "default"}
                  className={c.locked ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" : ""}
                >
                  {c.locked ? "LOCKED" : "UNLOCKED"}
                </Badge>
              </div>
              <CardDescription>{c.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-muted-foreground">Current value: </span>
                  <code className="bg-muted px-2 py-0.5 rounded font-mono text-xs">{c.current_value}</code>
                </div>
                <span className="text-xs text-muted-foreground">
                  Last reviewed: {new Date(c.last_changed_at).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Governance Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• <strong>Retention:</strong> Minimum 7 years, then cold storage with tamper-proof integrity preserved.</p>
          <p>• <strong>Data residency:</strong> Single approved production-region storage policy in effect. A trading jurisdiction is recorded at onboarding for governance purposes. Per-organisation residency commitments require separate Izenzo approval and are not automatically applied.</p>
          <p>• <strong>RPO/RTO:</strong> Collapse ledger RPO = 0 (synchronous replication). RTO ≤ 60 minutes.</p>
          <p>• <strong>Immutability:</strong> Collapse ledger and break-glass logs are append-only with database-level triggers preventing UPDATE/DELETE.</p>
        </CardContent>
      </Card>
    </div>
  );
}
