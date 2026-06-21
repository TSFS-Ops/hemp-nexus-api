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
  field_path: string;
  proposed_value: string;
  sensitive_field: boolean;
  created_at: string;
}

export default function AdminRegistryCorrectionRequests() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("registry_company_correction_requests" as never)
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
        <h1 className="text-2xl font-semibold">Correction requests</h1>
        <ReadinessBanner moduleCode="M021" state="shell_ready" />
        <p className="text-sm text-muted-foreground">
          Claimants may not directly edit registry data. Public and API-visible fields do not
          change until an admin approves. Correction approval does not verify the company.
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
                        <div className="font-medium">{r.company_reference}</div>
                        <div className="text-xs text-muted-foreground">{r.field_path}</div>
                      </div>
                      <div className="flex gap-2">
                        {r.sensitive_field && <Badge variant="destructive">sensitive</Badge>}
                        <Badge variant="outline">{r.status}</Badge>
                      </div>
                    </div>
                    <div className="mt-2 text-sm">Proposed: <span className="font-mono">{r.proposed_value}</span></div>
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
