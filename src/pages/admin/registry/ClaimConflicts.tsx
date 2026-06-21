import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";

interface Row {
  id: string;
  company_reference: string;
  status: string;
  first_claim_id: string | null;
  second_claim_id: string | null;
  related_claim_ids: string[];
  created_at: string;
}

export default function AdminRegistryClaimConflicts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("registry_claim_conflicts" as never)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        setRows((data as unknown as Row[]) ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Claim conflicts</h1>
        <ReadinessBanner moduleCode="M022" state="shell_ready" />
        <p className="text-sm text-muted-foreground">
          Later claims are accepted but marked as a conflict. No claimant receives higher privileges
          while a claim conflict is unresolved. Scoped access may be granted when multiple
          claimants have valid evidence.
        </p>
        <Card>
          <CardHeader><CardTitle>Open conflicts</CardTitle></CardHeader>
          <CardContent>
            {loading ? <p>Loading…</p> : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No conflicts.</p>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{r.company_reference}</div>
                        <div className="text-xs text-muted-foreground">
                          Related claims: {(r.related_claim_ids ?? []).length + (r.first_claim_id ? 1 : 0) + (r.second_claim_id ? 1 : 0)}
                        </div>
                      </div>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
