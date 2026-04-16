import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CheckCircle2, Clock } from "lucide-react";

interface OrgData {
  legal_name: string | null;
  registration_number: string | null;
  jurisdictions: string[] | null;
  trading_name: string | null;
  vat_number: string | null;
  status: string;
}

export function CompanyIdentityTab() {
  const { user } = useAuth();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.org_id) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("organizations")
        .select("legal_name, registration_number, jurisdictions, trading_name, vat_number, status")
        .eq("id", profile.org_id)
        .maybeSingle();
      setOrg(data as OrgData | null);
      setLoading(false);
    })();
  }, [user]);

  if (loading) return <div className="text-sm text-slate-400">Loading…</div>;

  const isVerified = org?.status === "active" || org?.status === "verified";

  return (
    <div className="max-w-3xl">
      {/* Header row with status badge */}
      <div className="flex items-start justify-between gap-8 mb-12">
        <div>
          <h2 className="text-xl font-medium text-slate-900 tracking-tight">
            Company Identity
          </h2>
          <p className="mt-2 text-sm text-slate-500 leading-relaxed max-w-md">
            Your verified Know-Your-Business profile. This identity is bound to every Proof of Intent you generate.
          </p>
        </div>
        {isVerified ? (
          <div className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Verified Counterparty
          </div>
        ) : (
          <div className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
            Awaiting Compliance Review
          </div>
        )}
      </div>

      {/* Form */}
      <div className="space-y-10">
        <ReadOnlyField label="Legal Entity Name" value={org?.legal_name} />
        <ReadOnlyField label="Trading Name" value={org?.trading_name} />
        <ReadOnlyField label="Registration Number" value={org?.registration_number} mono />
        <ReadOnlyField label="VAT / Tax Number" value={org?.vat_number} mono />
        <div className="space-y-3">
          <label className="block text-xs font-medium tracking-wider uppercase text-slate-500">
            Verified Jurisdictions
          </label>
          <div className="flex flex-wrap gap-2">
            {org?.jurisdictions && org.jurisdictions.length > 0 ? (
              org.jurisdictions.map((j) => (
                <span
                  key={j}
                  className="inline-flex items-center px-3 py-1.5 rounded-md border border-slate-200 bg-white text-xs font-mono tracking-wide text-slate-700"
                >
                  {j}
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-400">No jurisdictions registered.</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-12 pt-8 border-t border-slate-200">
        <p className="text-xs text-slate-400 leading-relaxed max-w-md">
          To update legal entity information, please contact our compliance team. All changes require re-verification.
        </p>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium tracking-wider uppercase text-slate-500">
        {label}
      </label>
      <div
        className={[
          "w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm",
          mono ? "font-mono text-slate-700" : "text-slate-900",
        ].join(" ")}
      >
        {value || <span className="text-slate-400">Not provided</span>}
      </div>
    </div>
  );
}
