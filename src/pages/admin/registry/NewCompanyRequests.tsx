import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY } from "@/lib/registry-claim-rules";

interface Row {
  id: string;
  company_name: string;
  country_code: string;
  status: string;
  created_at: string;
  claimant_email: string;
  reason_for_adding: string;
  duplicate_candidate_ids: string[];
}

export default function AdminRegistryNewCompanyRequests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("registry_new_company_requests" as never)
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
        <h1 className="text-2xl font-semibold">New-company requests</h1>
        <ReadinessBanner moduleCode="M020" state="shell_ready" />
        <p className="text-sm text-muted-foreground">
          Claim approval is not authority approval. Claim approval is not company verification.
          Claim approval is not bank-detail verification. {REGISTRY_PROVISIONAL_RECORD_DISPLAY_COPY}
        </p>
        <Card>
          <CardHeader><CardTitle>Queue</CardTitle></CardHeader>
          <CardContent>
            {loading ? <p>Loading…</p> : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{r.company_name} <span className="text-xs text-muted-foreground">({r.country_code})</span></div>
                        <div className="text-xs text-muted-foreground">{r.claimant_email}</div>
                      </div>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <div className="mt-2 text-sm">{r.reason_for_adding}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Duplicate candidates: {r.duplicate_candidate_ids?.length ?? 0}
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
