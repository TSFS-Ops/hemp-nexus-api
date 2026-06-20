/**
 * Batch 3 — M003 Company Profile shell. Safe envelope only. Raw bank details
 * are NEVER fetched or displayed; only the bank-detail status label appears.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import { supabase } from "@/integrations/supabase/client";

type ProfileEnvelope = {
  company_reference: string;
  claim_status: string;
  authority_status: string;
  profile_verification_status: string;
  bank_detail_status_label: string;
  notice: string;
};

export default function CompanyProfile() {
  const { id } = useParams();
  const [envelope, setEnvelope] = useState<ProfileEnvelope | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("registry-company-profile", { body: { company_reference: id } });
        if (data) setEnvelope(data as ProfileEnvelope);
      } catch (err) { console.error(err); }
    })();
  }, [id]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Company profile</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M003" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono text-xs">Record ID: {id}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground" data-testid="profile-empty-state">
            No production record is loaded. The sections below show the safe envelope returned by the profile shell.
          </p>
          {envelope && (
            <div className="grid grid-cols-2 gap-2" data-testid="profile-envelope">
              <div><span className="text-xs text-muted-foreground">Claim status</span><div><Badge variant="secondary">{envelope.claim_status}</Badge></div></div>
              <div><span className="text-xs text-muted-foreground">Authority status</span><div><Badge variant="secondary">{envelope.authority_status}</Badge></div></div>
              <div><span className="text-xs text-muted-foreground">Profile verification</span><div><Badge variant="secondary">{envelope.profile_verification_status}</Badge></div></div>
              <div><span className="text-xs text-muted-foreground">Bank-detail status</span><div><Badge variant="secondary">{envelope.bank_detail_status_label}</Badge></div></div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Raw bank-detail fields are never rendered on this surface. Only the status label above is exposed.
          </p>
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Audit timeline (placeholder)</p>
            <p className="text-[11px] text-muted-foreground italic">Timeline will appear once authority + verification workflows are recorded in a later batch.</p>
          </div>
          <Button asChild>
            <Link to={`/registry/company/${id}/claim`} data-testid="profile-claim-cta">Claim this company</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
