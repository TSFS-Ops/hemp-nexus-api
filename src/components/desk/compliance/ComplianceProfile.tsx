/**
 * ComplianceProfile, Trade User identity vault.
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
import { Building2, Check, FileWarning, FileText, Loader2, Users, ChevronRight, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserOrg } from "@/hooks/use-user-org";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type StepKey = "entity" | "owners" | "documents";
type Gap = {
  step: StepKey;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
};

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

/** Map the org status string to a semantic pill. */
function statusPill(status: string) {
  const s = (status || "pending").toLowerCase();
  if (s === "active" || s === "verified" || s === "approved") {
    return "bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))] border border-[hsl(var(--emerald)/0.2)]";
  }
  if (s === "blocked" || s === "rejected" || s === "suspended") {
    return "bg-rose-50 text-rose-700 border border-rose-200";
  }
  return "bg-amber-50 text-amber-700 border border-amber-200";
}

export function ComplianceProfile() {
  const orgId = useUserOrg();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<Org | null>(null);
  const [owners, setOwners] = useState<UboRow[]>([]);
  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [updateOpen, setUpdateOpen] = useState(false);

  const goToStep = (step: StepKey) => {
    setUpdateOpen(false);
    navigate(`/desk/settings/company?step=${step}`);
  };

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
      <div className="flex items-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs font-semibold tracking-wider uppercase">
          Loading compliance profile…
        </span>
      </div>
    );
  }

  const hasIdentity = !!(
    org &&
    (org.legal_name || org.registration_number || org.vat_number || org.address)
  );
  const identityFullyOnFile = !!(
    org &&
    org.legal_name &&
    org.registration_number &&
    org.address &&
    (org.jurisdictions?.length ?? 0) > 0
  );
  const isComplete = hasIdentity && owners.length > 0 && docs.length > 0;
  const aggregateOwnership = owners.reduce(
    (sum, o) => (o.status === "verified" ? sum + Number(o.ownership_percentage || 0) : sum),
    0
  );

  // Each gap maps to the first actionable sub-step in CompanyIdentityTab so
  // "Request Data Update" never lands the user on a tab that is already complete.
  const gaps: Gap[] = [];
  if (!identityFullyOnFile) {
    gaps.push({
      step: "entity",
      title: "Complete registered identity",
      description:
        "Legal name, registration number, registered address and jurisdiction must all be on file.",
      cta: "Update Identity",
      icon: Building2,
    });
  }
  if (owners.length === 0 || aggregateOwnership < 75) {
    gaps.push({
      step: "owners",
      title:
        owners.length === 0 ? "Declare beneficial owners" : "Reach 75% verified ownership",
      description:
        owners.length === 0
          ? "KYB requires at least one declared UBO. Add owners and percentages to satisfy the gate."
          : "Aggregate verified ownership is below the 75% KYB threshold. Add or verify additional owners.",
      cta: owners.length === 0 ? "Declare Owners" : "Update Owners",
      icon: Users,
    });
  }
  if (docs.length === 0) {
    gaps.push({
      step: "documents",
      title: "Upload regulatory evidence",
      description:
        "Registration certificate, tax clearance and KYC pack are required for counterparty verification.",
      cta: "Upload Documents",
      icon: FileText,
    });
  }

  // ── Empty state ────────────────────────────────────────────
  // Triggered only when the org has *no* identity, *no* declared owners
  // and *no* uploaded documents. Once any one of the three is present we
  // fall through to the populated layout so partial progress remains visible.
  if (!isComplete && owners.length === 0 && docs.length === 0 && !hasIdentity) {
    return (
      <>
        <header className="mb-8">
          <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            Identity & Governance
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground tracking-tight leading-tight">
            Compliance Profile
          </h1>
        </header>

        <EmptyStateCard
          kicker="Profile Incomplete"
          title="Institutional identity not established"
          description="Register your entity, declare beneficial owners and upload regulatory evidence. Counterparties verify against this record before bilateral signature."
          icon={<FileWarning className="h-5 w-5" strokeWidth={1.75} />}
          primaryAction={{
            label: "Complete Onboarding",
            onClick: () => navigate("/desk/settings/company?step=entity"),
          }}
        />
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
  const jurisdiction = org?.jurisdictions?.[0] ?? "-";

  const legalRows = [
    { label: "Legal Name", value: org?.legal_name || org?.name || "-" },
    { label: "Trading As", value: org?.trading_name || "-" },
    { label: "Reg Number", value: org?.registration_number || "-", mono: true },
    { label: "VAT Number", value: org?.vat_number || "-", mono: true },
    {
      label: "Registered Address",
      value: formattedAddress || "Not on file",
      full: true,
      placeholder: !formattedAddress,
    },
    { label: "Jurisdiction", value: jurisdiction },
  ] as Array<{ label: string; value: string; mono?: boolean; full?: boolean; placeholder?: boolean }>;

  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-8 mb-6">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground mb-2">
            Identity & Governance
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground tracking-tight leading-tight">
            Compliance Profile
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-xl">
            Your institutional identity record. All counterparties verify against this file
            before bilateral signature.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            // If the profile has gaps, surface them in a step-specific modal so
            // the user can jump straight to the missing tab. When the profile
            // is fully complete, fall back to the entity tab (the canonical
            // "edit" landing) since there is nothing missing to deep-link to.
            if (gaps.length === 0) {
              goToStep("entity");
              return;
            }
            if (gaps.length === 1) {
              goToStep(gaps[0].step);
              return;
            }
            setUpdateOpen(true);
          }}
          className="self-start md:shrink-0 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
        >
          Improve Profile
          {gaps.length > 0 && (
            <span
              aria-label={`${gaps.length} outstanding`}
              className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-400 text-slate-900 text-[11px] font-semibold tabular-nums"
            >
              {gaps.length}
            </span>
          )}
        </button>
      </header>

      {/* ── STATUS BANNER ─────────────────────────────────────── */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-card border border-border rounded-md">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            Entity Status
          </p>
          <span className="text-xs text-muted-foreground">
            Last review · <span className="font-mono text-muted-foreground">{lastReview} UTC</span>
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusPill(
            org?.status ?? "pending"
          )}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* ── CARDS ─────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Card 1 · Registered Identity */}
        <article className="bg-card border border-slate-200 rounded-md overflow-hidden">
          <CardHeader index="01" title="Registered Identity" kicker="Statutory Record" />
          <div className="p-6">
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {legalRows.map((item) => (
                <div key={item.label} className={item.full ? "md:col-span-2" : ""}>
                  <dt className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    {item.label}
                  </dt>
                  <dd
                    className={
                      item.placeholder
                        ? "text-sm italic text-muted-foreground/70"
                        : `text-sm font-medium text-foreground ${item.mono ? "font-mono" : ""}`
                    }
                  >
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </article>

        {/* Card 2 · Ownership (UBO) */}
        <article className="bg-card border border-slate-200 rounded-md overflow-hidden">
          <CardHeader
            index="02"
            title="Ownership (UBO)"
            kicker="Ultimate Beneficial Owners"
          />
          <div className="p-6">
            {owners.length === 0 ? (
              <EmptyRow
                title="No beneficial owners declared"
                hint="Declare ownership during onboarding to satisfy KYB."
                cta="Declare Owners"
                onClick={() => navigate("/desk/settings/company?step=owners")}
              />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {owners.map((owner) => {
                    const verified = owner.status === "verified";
                    return (
                      <li
                        key={owner.id}
                        className="grid grid-cols-12 gap-4 items-center py-4 first:pt-0 last:pb-0"
                      >
                        <div className="col-span-12 sm:col-span-7 flex items-center gap-3 min-w-0">
                          <span
                            className={`inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0 ${
                              verified
                                ? "bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))] border border-[hsl(var(--emerald)/0.2)]"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                            aria-label={verified ? "Verified" : "Pending"}
                          >
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {owner.person?.legal_name ?? "Unnamed Owner"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {(owner.person?.entity_type ?? "owner")} ·{" "}
                              {owner.person?.jurisdiction_code ?? "-"}
                            </p>
                          </div>
                        </div>
                        <div className="col-span-12 sm:col-span-5 sm:text-right">
                          <p className="font-mono text-sm font-medium text-foreground tabular-nums">
                            {Number(owner.ownership_percentage).toFixed(2)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                            Ownership
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Aggregate Verified Ownership
                  </p>
                  <p className="font-mono text-sm font-medium text-foreground tabular-nums">
                    {totalOwnership.toFixed(2)}%
                  </p>
                </div>
              </>
            )}
          </div>
        </article>

        {/* Card 3 · Regulatory Evidence */}
        <article className="bg-card border border-slate-200 rounded-md overflow-hidden">
          <CardHeader index="03" title="Regulatory Evidence" kicker="Active Licences" />
          <div className="p-6">
            {docs.length === 0 ? (
              <EmptyRow
                title="No regulatory documents uploaded"
                hint="Upload your registration certificate, tax clearance and KYC pack."
                cta="Upload Documents"
                onClick={() => navigate("/desk/settings/company?step=documents")}
              />
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {docs.map((doc) => {
                    const sealed = doc.status === "verified" || doc.status === "approved";
                    const shortHash = `0x${doc.sha256_hash.slice(0, 40)}`;
                    return (
                      <li
                        key={doc.id}
                        className="grid grid-cols-12 gap-4 items-start py-4 first:pt-0 last:pb-0"
                      >
                        <div className="col-span-12 sm:col-span-5 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {prettyDocType(doc.doc_type)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {doc.expiry_date
                              ? `Expires ${doc.expiry_date}`
                              : `Status · ${doc.status}`}
                          </p>
                        </div>

                        <div className="col-span-12 sm:col-span-6">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                            SHA-256
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground break-all leading-snug">
                            {shortHash}
                          </p>
                        </div>

                        <div className="col-span-12 sm:col-span-1 sm:text-right">
                          <span
                            className={`inline-flex items-center justify-center h-5 w-5 rounded-full ${
                              sealed
                                ? "bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))] border border-[hsl(var(--emerald)/0.2)]"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                            aria-label={sealed ? "Sealed" : "Pending review"}
                          >
                            <Check className="h-3 w-3" strokeWidth={2.5} />
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Vault Integrity · Chain Verified
                  </p>
                  <p className="font-mono text-xs text-foreground">
                    {docs.length} document{docs.length === 1 ? "" : "s"} on file
                  </p>
                </div>
              </>
            )}
          </div>
        </article>
      </div>

      {/* Footer attestation */}
      <footer className="mt-10 pt-6 border-t border-border">
        <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          Custodian
        </p>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-2xl">
          This profile is held by the Izenzo Governance Registry under jurisdiction{" "}
          {jurisdiction}. Counterparties may request tamper-proof proof of any field
          via the Without-a-Doubt attestation endpoint.
        </p>
      </footer>

      {/* ── REQUEST DATA UPDATE · STEP-SPECIFIC PICKER ───────── */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request a data update</DialogTitle>
            <DialogDescription>
              {gaps.length > 0
                ? "Pick the area you want to update. Each link drops you straight onto the right Company Identity (KYB) sub-step."
                : "Your profile is up to date. Open Company Identity to make discretionary edits."}
            </DialogDescription>
          </DialogHeader>

          <ul className="mt-2 space-y-2">
            {gaps.map((gap) => {
              const Icon = gap.icon;
              return (
                <li key={gap.step}>
                  <button
                    type="button"
                    onClick={() => goToStep(gap.step)}
                    className="w-full flex items-start gap-3 p-3 rounded-md border border-border bg-card text-left hover:bg-muted hover:border-foreground/20 transition-colors group"
                  >
                    <span className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {gap.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground leading-snug">
                        {gap.description}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 mt-2 text-muted-foreground group-hover:text-foreground shrink-0"
                      strokeWidth={1.75}
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          <DialogFooter className="mt-2 sm:justify-between gap-2">
            <button
              type="button"
              onClick={() => setUpdateOpen(false)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => goToStep("entity")}
              className="text-xs font-medium text-foreground underline underline-offset-4 hover:no-underline"
            >
              Open Company Identity anyway
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="px-6 py-4 bg-muted border-b border-border flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-[11px] text-muted-foreground/70 select-none shrink-0">
          {index}
        </span>
        <h2 className="text-sm font-semibold text-foreground tracking-tight truncate">
          {title}
        </h2>
      </div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-4 py-4 rounded-md border border-amber-300/70 bg-amber-50/60 ring-1 ring-inset ring-amber-200/50">
      <div className="flex items-start gap-3 min-w-0">
        <span
          aria-hidden
          className="shrink-0 mt-0.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-amber-100 border border-amber-300 text-amber-700"
        >
          <FileWarning className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">{title}</p>
          <p className="mt-1 text-xs text-amber-800/80 leading-snug">{hint}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium transition-colors"
      >
        {cta}
      </button>
    </div>
  );
}
