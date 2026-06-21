import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/BackButton";
import {
  REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE,
  REGISTRY_AUTHORITY_B12_PUBLIC_REJECTION_NOTICE,
  REGISTRY_AUTHORITY_B12_PUBLIC_NEXT_STEP_BANK,
} from "@/lib/registry-authority-workflow";

/**
 * Batch 12 — Authority status page (user-facing).
 * Route: /registry/authority/:authorityRequestId
 */
export default function RegistryAuthorityStatus() {
  const { authorityRequestId } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("registry-authority-status", {
          body: { authority_request_id: authorityRequestId },
        });
        setData(res);
      } finally {
        setLoading(false);
      }
    })();
  }, [authorityRequestId]);

  if (loading) return <div className="container py-8">Loading…</div>;
  if (!data?.authority) return <div className="container py-8">Not found.</div>;
  const ar = data.authority;

  return (
    <div className="container max-w-3xl py-8 space-y-4">
      <BackButton />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{ar.company_name}</span>
            <Badge>{ar.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {ar.status === "approved" && (
            <p className="rounded border bg-muted p-3 text-foreground">
              {REGISTRY_AUTHORITY_B12_PUBLIC_APPROVAL_NOTICE}
            </p>
          )}
          {ar.status === "rejected" && (
            <p className="rounded border bg-muted p-3 text-foreground">
              {REGISTRY_AUTHORITY_B12_PUBLIC_REJECTION_NOTICE}
            </p>
          )}
          {ar.status === "approved" && (ar.requested_scopes ?? []).includes("bank_detail_submission") && (
            <p className="text-xs text-muted-foreground">{REGISTRY_AUTHORITY_B12_PUBLIC_NEXT_STEP_BANK}</p>
          )}
          <div>
            <div className="font-medium">Requested scopes</div>
            <ul className="list-disc pl-5 text-muted-foreground">
              {(ar.requested_scopes ?? []).map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          {(data.scopes ?? []).length > 0 && (
            <div>
              <div className="font-medium">Scope decisions</div>
              <ul className="text-xs text-muted-foreground">
                {(data.scopes ?? []).map((s: any) => (
                  <li key={s.scope_code}>{s.scope_code} — {s.status}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
