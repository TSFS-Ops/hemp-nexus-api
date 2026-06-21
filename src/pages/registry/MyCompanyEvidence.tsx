/**
 * Batch 16 — Evidence centre for a single company.
 *
 * Shows ONLY evidence the logged-in user submitted or is authorised to
 * see (RLS enforced server-side). No other user's evidence is fetched.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_BLOCKED_LABEL } from "@/lib/registry-company-portal-ssot";

interface EvidenceItem {
  id: string;
  evidence_kind: string;
  description: string | null;
  evidence_state?: string | null;
  created_at?: string;
  source: "claim" | "bank_detail";
}

export default function MyCompanyEvidence() {
  const { companyId } = useParams();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) { setLoading(false); return; }

      // Claim evidence (RLS scopes to claimant_user_id)
      const { data: claimEv } = await supabase
        .from("registry_company_claim_evidence")
        .select("id, category, description, evidence_state, created_at")
        .limit(100);

      // Bank-detail evidence the user submitted
      const { data: bankEv } = await supabase
        .from("registry_bank_detail_evidence")
        .select("id, evidence_kind, description, created_at")
        .limit(100);

      const merged: EvidenceItem[] = [
        ...((claimEv ?? []).map((e: any) => ({
          id: e.id,
          evidence_kind: e.category,
          description: e.description,
          evidence_state: e.evidence_state,
          created_at: e.created_at,
          source: "claim" as const,
        }))),
        ...((bankEv ?? []).map((e: any) => ({
          id: e.id,
          evidence_kind: e.evidence_kind,
          description: e.description,
          created_at: e.created_at,
          source: "bank_detail" as const,
        }))),
      ];
      setItems(merged);
      setLoading(false);
    })();
  }, [companyId]);

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <BackButton fallback={`/registry/my-companies/${companyId ?? ""}`} />
      <header>
        <h1 className="text-xl font-semibold">Evidence centre</h1>
        <p className="text-xs text-muted-foreground">
          You can only see evidence you submitted or have been authorised to view.
        </p>
      </header>

      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {!loading && items.length === 0 && (
        <Alert>
          <AlertTitle>No evidence yet</AlertTitle>
          <AlertDescription className="text-xs">{PORTAL_BLOCKED_LABEL.evidence_required}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Submitted evidence</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {items.map((e) => (
            <div key={`${e.source}-${e.id}`} className="flex justify-between border-b py-1">
              <span>
                <Badge variant="outline" className="mr-2">{e.source === "claim" ? "Claim" : "Bank detail"}</Badge>
                {e.evidence_kind}
              </span>
              <span className="text-muted-foreground">{e.evidence_state ?? "submitted"}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
