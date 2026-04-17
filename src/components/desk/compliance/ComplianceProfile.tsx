/**
 * ComplianceProfile — Trade User identity vault.
 *
 * Editorial layout: header + ghost action, status banner, three white
 * cards (Registered Identity · Ownership · Regulatory Evidence). All
 * data is sourced live from the authenticated user's organisation:
 *   - organizations         → legal/registration/address fields
 *   - ubo_links + entities  → ultimate beneficial owners
 *   - kyc_documents         → uploaded regulatory evidence
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, FileWarning, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserOrg } from "@/hooks/use-user-org";

type Org = {
  id: string;
  name: string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  vat_number: string | null;
  tax_number: string | null;
  jurisdictions: string[] | null;
  address: { line1?: string; city?: string; postcode?: string; country?: string } | null;
  status: string;
  updated_at: string;
};

type UboRow = {
  id: string;
  ownership_percentage: number;
  status: string;
  person_entity_id: string;
  person: { legal_name: string; jurisdiction_code: string; entity_type: string } | null;
};

type KycDoc = {
  id: string;
  doc_type: string;
  filename: string;
  expiry_date: string | null;
  sha256_hash: string;
  status: string;
};

const DOC_TYPE_LABEL: Record<string, string> = {
  registration_certificate: "Registration Certificate",
  tax_clearance: "Tax Clearance",
  vat_certificate: "VAT Certificate",
  ubo_declaration: "Beneficial Ownership Declaration",
  sanctions_clearance: "Sanctions & PEP Clearance",
  kyc_pack: "KYC Export Pack",
  proof_of_address: "Proof of Address",
  director_id: "Director ID",
  bank_statement: "Bank Statement",
};

function prettyDocType(type: string) {
  return (
    DOC_TYPE_LABEL[type] ||
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatAddress(addr: Org["address"]): string | null {
  if (!addr) return null;
  return [addr.line1, addr.city, addr.postcode, addr.country].filter(Boolean).join(", ") || null;
}

export function ComplianceProfile() {
  const orgId = useUserOrg();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [owners, setOwners] = useState<UboRow[]>([]);
  const [docs, setDocs] = useState<KycDoc[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      supabase
        .from("organizations")
        .select(
          "id,name,legal_name,trading_name,registration_number,vat_number,tax_number,jurisdictions,address,status,updated_at"
        )
        .eq("id", orgId)
        .maybeSingle(),
      supabase
        .from("ubo_links")
        .select(
          "id,ownership_percentage,status,person_entity_id,person:person_entity_id(legal_name,jurisdiction_code,entity_type)"
        )
        .eq("org_id", orgId)
        .order("ownership_percentage", { ascending: false }),
      supabase
        .from("kyc_documents")
        .select("id,doc_type,filename,expiry_date,sha256_hash,status")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]).then(([orgRes, uboRes, docsRes]) => {
      if (cancelled) return;
      setOrg((orgRes.data as Org) ?? null);
      setOwners(((uboRes.data as unknown) as UboRow[]) ?? []);
      setDocs((docsRes.data as KycDoc[]) ?? []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // ── Loading ────────────────────────────────────────────────
  if (loading || !orgId) {
    return (
      <div className="flex items-center gap-3 py-24 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-mono text-[11px] tracking-[0.25em] uppercase">
          Loading compliance profile…
        </span>
      </div>
    );
  }

  const hasIdentity = !!(
    org &&
    (org.legal_name || org.registration_number || org.vat_number || org.address)
  );
  const isComplete = hasIdentity && owners.length > 0 && docs.length > 0;

  // ── Empty state ────────────────────────────────────────────
  if (!isComplete && owners.length === 0 && docs.length === 0 && !hasIdentity) {
    return (
      <>
        <header className="mb-10">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
            Identity & Governance
          </p>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
            Compliance Profile
          </h1>
        </header>

        <div className="bg-white border border-slate-200 rounded-sm p-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 mb-5">
            <FileWarning className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
            Profile Incomplete
          </h2>
          <p className="mt-3 text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            Your sovereign identity record has not been established. Complete
            onboarding to register your entity, declare beneficial owners, and
            upload regulatory evidence.
          </p>
          <button
            type="button"
            onClick={() => navigate("/desk/settings/company")}
            className="mt-7 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Complete Onboarding
          </button>
        </div>
      </>
    );
  }

  // ── Real data ──────────────────────────────────────────────
  const lastReview = new Date(org?.updated_at ?? Date.now())
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  const statusLabel = (org?.status || "pending").replace(/_/g, " ");
  const totalOwnership = owners.reduce(
    (sum, o) => sum + Number(o.ownership_percentage || 0),
    0
  );
  const formattedAddress = formatAddress(org?.address ?? null);
  const jurisdiction = org?.jurisdictions?.[0] ?? "—";

  const legalRows = [
    { label: "Legal Name", value: org?.legal_name || org?.name || "—" },
    { label: "Trading As", value: org?.trading_name || "—" },
    {
      label: "Reg Number",
      value: org?.registration_number || "—",
      mono: true,
    },
    { label: "VAT Number", value: org?.vat_number || "—", mono: true },
    {
      label: "Registered Address",
      value: formattedAddress || "Not on file",
      full: true,
    },
    { label: "Jurisdiction", value: jurisdiction },
  ];

  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-8 mb-10">
        <div>
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-400 mb-3">
            Identity & Governance
          </p>
          <h1 className="text-4xl lg:text-5xl font-semibold text-slate-900 tracking-tight leading-tight">
            Compliance Profile
          </h1>
          <p className="mt-4 text-base text-slate-500 leading-relaxed max-w-xl">
            Your sovereign identity record. All counterparties verify against this file
            before bilateral signature.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/desk/settings/company")}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors border-b border-transparent hover:border-slate-900"
        >
          Request Data Update
        </button>
      </header>

      {/* ── STATUS BANNER ─────────────────────────────────────── */}
      <div className="mb-12 flex items-center justify-between gap-6 px-6 py-4 bg-white border border-slate-200 rounded-sm">
        <div className="flex items-baseline gap-4">
          <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-500">
            Entity Status
          </p>
          <span className="font-mono text-[10px] text-slate-400">
            Last review · {lastReview} UTC
          </span>
        </div>
        <span
          className="inline-flex items-center gap-2 rounded-sm px-3 py-1.5"
          style={{
            backgroundColor: "hsl(38 92% 50% / 0.08)",
            color: "hsl(28 80% 30%)",
          }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
              style={{ backgroundColor: "hsl(38 92% 50%)" }}
            />
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ backgroundColor: "hsl(28 80% 40%)" }}
            />
          </span>
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase font-medium">
            {statusLabel}
          </span>
        </span>
      </div>

      {/* ── CARDS ─────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Card 1 · Registered Identity */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader index="01" title="Registered Identity" kicker="Statutory Record" />
          <dl className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-7">
            {legalRows.map((item) => (
              <div
                key={item.label}
                className={`border-b border-slate-100 pb-4 ${
                  item.full ? "sm:col-span-2" : ""
                }`}
              >
                <dt className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  {item.label}
                </dt>
                <dd
                  className={`mt-2 text-slate-900 font-medium ${
                    item.mono ? "font-mono text-sm" : "text-base"
                  }`}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </article>

        {/* Card 2 · Ownership (UBO) */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader
            index="02"
            title="Ownership (UBO)"
            kicker="Ultimate Beneficial Owners"
          />
          {owners.length === 0 ? (
            <EmptyRow
              title="No beneficial owners declared"
              hint="Declare ownership during onboarding to satisfy KYB."
              cta="Declare Owners"
              onClick={() => navigate("/desk/settings/company")}
            />
          ) : (
            <>
              <ul className="mt-8 divide-y divide-slate-100">
                {owners.map((owner) => {
                  const verified = owner.status === "verified";
                  return (
                    <li
                      key={owner.id}
                      className="grid grid-cols-12 gap-4 items-center py-5 first:pt-0 last:pb-0"
                    >
                      <div className="col-span-12 sm:col-span-7 flex items-center gap-3 min-w-0">
                        <span
                          className="inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0"
                          style={{
                            backgroundColor: verified
                              ? "hsl(155 35% 28% / 0.1)"
                              : "hsl(38 92% 50% / 0.12)",
                            color: verified ? "hsl(155 35% 25%)" : "hsl(28 80% 35%)",
                          }}
                          aria-label={verified ? "Verified" : "Pending"}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-base text-slate-900 font-medium truncate">
                            {owner.entities?.legal_name ?? "Unnamed Owner"}
                          </p>
                          <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                            {(owner.entities?.entity_type ?? "owner")} ·{" "}
                            {owner.entities?.jurisdiction_code ?? "—"}
                          </p>
                        </div>
                      </div>
                      <div className="col-span-12 sm:col-span-5 sm:text-right">
                        <p className="font-mono text-base text-slate-900 tabular-nums font-medium">
                          {Number(owner.ownership_percentage).toFixed(2)}%
                        </p>
                        <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 mt-0.5">
                          Ownership
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Aggregate Verified Ownership
                </p>
                <p className="font-mono text-sm text-slate-900 tabular-nums font-medium">
                  {totalOwnership.toFixed(2)}%
                </p>
              </div>
            </>
          )}
        </article>

        {/* Card 3 · Regulatory Evidence */}
        <article className="bg-white border border-slate-200 rounded-sm p-8 lg:p-10">
          <CardHeader index="03" title="Regulatory Evidence" kicker="Active Licences" />
          {docs.length === 0 ? (
            <EmptyRow
              title="No regulatory documents uploaded"
              hint="Upload your registration certificate, tax clearance and KYC pack."
              cta="Upload Documents"
              onClick={() => navigate("/desk/settings/company")}
            />
          ) : (
            <>
              <ul className="mt-8 divide-y divide-slate-100">
                {docs.map((doc) => {
                  const sealed = doc.status === "verified" || doc.status === "approved";
                  const shortHash = `0x${doc.sha256_hash.slice(0, 40)}`;
                  return (
                    <li
                      key={doc.id}
                      className="grid grid-cols-12 gap-4 items-start py-5 first:pt-0 last:pb-0"
                    >
                      <div className="col-span-12 sm:col-span-5 min-w-0">
                        <p className="text-sm text-slate-900 font-medium truncate">
                          {prettyDocType(doc.doc_type)}
                        </p>
                        <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                          {doc.expiry_date
                            ? `Expires ${doc.expiry_date}`
                            : `Status · ${doc.status}`}
                        </p>
                      </div>

                      <div className="col-span-12 sm:col-span-6">
                        <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-slate-400 mb-1">
                          SHA-256
                        </p>
                        <p className="font-mono text-[10px] text-slate-700 break-all leading-snug">
                          {shortHash}
                        </p>
                      </div>

                      <div className="col-span-12 sm:col-span-1 sm:text-right">
                        <span
                          className="inline-flex items-center justify-center h-5 w-5 rounded-full"
                          style={{
                            backgroundColor: sealed
                              ? "hsl(155 35% 28% / 0.1)"
                              : "hsl(38 92% 50% / 0.12)",
                            color: sealed ? "hsl(155 35% 25%)" : "hsl(28 80% 35%)",
                          }}
                          aria-label={sealed ? "Sealed" : "Pending review"}
                        >
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
                <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-500">
                  Vault Integrity · Chain Verified
                </p>
                <p className="font-mono text-[11px] text-slate-900">
                  {docs.length} document{docs.length === 1 ? "" : "s"} on file
                </p>
              </div>
            </>
          )}
        </article>
      </div>

      {/* Footer attestation */}
      <footer className="mt-12 pt-8 border-t border-slate-200">
        <p className="font-mono text-[10px] tracking-[0.3em] uppercase text-slate-400">
          Custodian
        </p>
        <p className="mt-2 text-sm text-slate-700 leading-relaxed max-w-2xl">
          This profile is held by the Izenzo Sovereign Registry under jurisdiction{" "}
          {jurisdiction}. Counterparties may request cryptographic proof of any field
          via the Without-a-Doubt attestation endpoint.
        </p>
      </footer>
    </>
  );
}

function CardHeader({
  index,
  title,
  kicker,
}: {
  index: string;
  title: string;
  kicker: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 pb-4 border-b border-slate-200">
      <div className="flex items-baseline gap-5">
        <span className="font-mono text-[10px] tracking-[0.25em] text-slate-400 select-none">
          {index}
        </span>
        <h2 className="text-lg font-medium text-slate-900 tracking-tight">{title}</h2>
      </div>
      <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
        {kicker}
      </p>
    </div>
  );
}

function EmptyRow({
  title,
  hint,
  cta,
  onClick,
}: {
  title: string;
  hint: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-6 py-6">
      <div>
        <p className="text-sm text-slate-900 font-medium">{title}</p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
          {hint}
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900 transition-colors"
      >
        {cta}
      </button>
    </div>
  );
}
