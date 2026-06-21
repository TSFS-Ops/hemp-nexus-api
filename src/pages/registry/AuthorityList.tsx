import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/BackButton";

/**
 * Batch 12 — Authority requests list (user-facing).
 * Route: /registry/authority
 */
export default function RegistryAuthorityList() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("registry_authority_requests")
          .select("id,company_name,country_code,status,requested_scopes,created_at,is_sensitive")
          .order("created_at", { ascending: false });
        setRows(data ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  return (
    <div className="container max-w-3xl py-8 space-y-4">
      <BackButton />
      <h1 className="text-2xl font-semibold">Your authority-to-act requests</h1>
      <p className="text-sm text-muted-foreground">
        Authority approval applies only to the selected scopes. It does not verify the company profile or bank details.
      </p>
      {loading ? <p>Loading…</p> : rows.length === 0 ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No authority requests yet.</CardContent></Card>
      ) : rows.map((r) => (
        <Card key={r.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <Link to={`/registry/authority/${r.id}`} className="hover:underline">{r.company_name}</Link>
              <Badge variant="secondary">{r.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div>Country: {r.country_code}</div>
            <div>Scopes: {(r.requested_scopes ?? []).join(", ") || "—"}</div>
            {r.is_sensitive && <Badge variant="outline">Sensitive scopes</Badge>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
