/**
 * Batch 8 — Public-safe company profile (working).
 *
 * Hydrates the public profile via registry-company-profile edge
 * function. Raw bank details, personal emails, phone numbers and
 * personal residential addresses are never fetched or rendered.
 */
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ProfileResponse {
  found: boolean;
  record?: {
    id: string;
    country_code: string;
    company_name: string;
    registration_number: string | null;
    local_number: string | null;
    vat_number: string | null;
    legal_form: string | null;
    company_status: string | null;
    registered_address: string | null;
    source_summary: string | null;
    source_generated_date: string | null;
  };
  readiness_label?: string;
  claim_status?: string;
  authority_status?: string;
  profile_verification_status?: string;
  bank_detail_status_label?: string;
  claim_available?: boolean;
  claim_blocked_reason?: string | null;
  identifiers?: Array<{ identifier_kind: string; identifier_value: string }>;
  addresses?: Array<{ address_kind: string; address_text: string }>;
  people?: Array<{ role_kind: string; display_name: string | null }>;
  activities?: Array<{ activity_summary: string }>;
  filings?: Array<{ filing_label: string; filing_summary: string | null; filing_date: string | null }>;
  events?: Array<{ event_label: string; event_summary: string | null; event_date: string | null }>;
}

export default function CompanyProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.functions.invoke("registry-company-profile", {
          body: { company_reference: id },
        });
        setProfile(data as ProfileResponse);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <main className="max-w-3xl mx-auto p-6 text-sm text-muted-foreground">Loading…</main>;

  if (!profile?.found || !profile.record) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Company profile</h1>
        <Card>
          <CardContent className="py-6 space-y-3 text-sm">
            <p>No public record was found for this reference.</p>
            <Button asChild>
              <Link to="/registry/new-company-request">Submit a new-company request</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const r = profile.record;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold mb-1">{r.company_name}</h1>
      <div className="flex flex-wrap gap-1 mb-3">
        <Badge variant="secondary" className="text-[10px] font-mono">{profile.readiness_label}</Badge>
        <Badge variant="secondary" className="text-[10px] font-mono">{profile.claim_status}</Badge>
        <Badge variant="secondary" className="text-[10px] font-mono">{profile.authority_status}</Badge>
        <Badge variant="secondary" className="text-[10px] font-mono">{profile.profile_verification_status}</Badge>
        <Badge variant="secondary" className="text-[10px] font-mono">{profile.bank_detail_status_label}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Public-safe fields</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Country:</span> {r.country_code}</div>
          <div><span className="text-muted-foreground">Legal form:</span> {r.legal_form ?? "—"}</div>
          <div><span className="text-muted-foreground">Company status:</span> {r.company_status ?? "—"}</div>
          <div><span className="text-muted-foreground">Registration number:</span> {r.registration_number ?? "—"}</div>
          {r.local_number && <div><span className="text-muted-foreground">Local number:</span> {r.local_number}</div>}
          {r.vat_number && <div><span className="text-muted-foreground">VAT / tax number:</span> {r.vat_number}</div>}
          <div><span className="text-muted-foreground">Registered address:</span> {r.registered_address ?? "—"}</div>
          <div><span className="text-muted-foreground">Source:</span> {r.source_summary ?? "—"} {r.source_generated_date && `(${r.source_generated_date})`}</div>
        </CardContent>
      </Card>

      {(profile.identifiers?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Other identifiers</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {profile.identifiers!.map((id, i) => (
              <div key={i}><span className="text-muted-foreground">{id.identifier_kind.replace("_", " ")}:</span> {id.identifier_value}</div>
            ))}
          </CardContent>
        </Card>
      )}

      {(profile.people?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Public officers / directors / members</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {profile.people!.map((p, i) => (
              <div key={i}><span className="text-muted-foreground">{p.role_kind}:</span> {p.display_name ?? "—"}</div>
            ))}
            <p className="text-[10px] text-muted-foreground pt-2">
              Personal email, phone and residential addresses are never displayed on this surface.
            </p>
          </CardContent>
        </Card>
      )}

      {(profile.activities?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {profile.activities!.map((a, i) => <div key={i}>{a.activity_summary}</div>)}
          </CardContent>
        </Card>
      )}

      {(profile.filings?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Filings (summary)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {profile.filings!.map((f, i) => (
              <div key={i}><span className="text-muted-foreground">{f.filing_label}:</span> {f.filing_summary ?? "—"} {f.filing_date && `(${f.filing_date})`}</div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-4 space-y-2">
          <p className="text-[11px] text-amber-700">
            Source data has not been independently vetted by Izenzo unless the profile status explicitly indicates otherwise.
          </p>
          <p className="text-[10px] text-muted-foreground">
            Raw bank-detail fields are never rendered on this surface. Only the status label above is exposed.
          </p>
          {profile.claim_available ? (
            <Button asChild>
              <Link
                to={`/registry/company/${r.id}/claim`}
                state={{
                  prefill: {
                    company_reference: r.id,
                    company_name: r.company_name,
                    registration_number: r.registration_number ?? "",
                    country_code: r.country_code,
                  },
                }}
                data-testid="profile-claim-cta"
              >
                Start claim
              </Link>
            </Button>
          ) : (
            <div className="space-y-1">
              <Badge variant="secondary" data-testid="claim-blocked-reason">
                {profile.claim_blocked_reason ?? "Claim is not available for this record yet."}
              </Badge>
              <p className="text-[10px] text-muted-foreground">
                You cannot start a claim while this record is in its current state.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
