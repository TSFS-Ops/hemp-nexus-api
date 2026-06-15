/**
 * CompanyIdentityTab, KYB Command Center.
 *
 * Replaces the prior "status badge + read-only fields" loop with a real
 * 3-step intake controller:
 *   §01 Entity Details   → writes to organizations + entities
 *   §02 Beneficial Owners → writes to entities (person) + ubo_links
 *   §03 Documents         → uploads to kyc-documents bucket + kyc_documents row
 *
 * Verification badge is derived from real KYB signals, never from the
 * always-"active" organizations.status column.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  Plus,
  Trash2,
  Upload,
  FileCheck2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { sha256HexOfBlob } from "@/lib/crypto";

// ──────────────────────────────────────────────────────────────────────
// Types

interface OrgData {
  id: string;
  legal_name: string | null;
  registration_number: string | null;
  jurisdictions: string[] | null;
  trading_name: string | null;
  vat_number: string | null;
  tax_number: string | null;
  status: string;
}

interface UboRow {
  id: string;
  ownership_percentage: number;
  status: string;
  person: { legal_name: string; jurisdiction_code: string } | null;
}

interface KycDoc {
  id: string;
  doc_type: string;
  filename: string;
  status: string;
  created_at: string;
}

type VerificationState = "verified" | "in_review" | "incomplete";
type StepKey = "entity" | "owners" | "documents";

const STEPS: { key: StepKey; index: string; label: string }[] = [
  { key: "entity", index: "§01", label: "Entity Details" },
  { key: "owners", index: "§02", label: "Beneficial Owners" },
  { key: "documents", index: "§03", label: "Documents" },
];

const DOC_TYPES = [
  "incorporation_certificate",
  "tax_clearance",
  "memorandum_of_incorporation",
  "directors_register",
  "proof_of_address",
] as const;

// ──────────────────────────────────────────────────────────────────────

export function CompanyIdentityTab() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [companyEntityId, setCompanyEntityId] = useState<string | null>(null);
  const [owners, setOwners] = useState<UboRow[]>([]);
  const [docs, setDocs] = useState<KycDoc[]>([]);
  const [verification, setVerification] = useState<VerificationState>("incomplete");
  const [loading, setLoading] = useState(true);

  // Deep-link: read ?step= from URL on mount and whenever it changes externally
  const initialStep: StepKey = (() => {
    const s = searchParams.get("step");
    return s === "owners" || s === "documents" || s === "entity" ? s : "entity";
  })();
  const [activeStep, setActiveStep] = useState<StepKey>(initialStep);

  // Sync URL → state when ?step changes (e.g. user clicks deep link from ComplianceProfile)
  useEffect(() => {
    const s = searchParams.get("step");
    if (s === "owners" || s === "documents" || s === "entity") {
      setActiveStep(s);
    }
  }, [searchParams]);

  // Sync state → URL when user clicks a stepper tab (so deep links remain shareable)
  const selectStep = (key: StepKey) => {
    setActiveStep(key);
    const next = new URLSearchParams(searchParams);
    next.set("step", key);
    setSearchParams(next, { replace: true });
  };

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.org_id) {
      setLoading(false);
      return;
    }
    const orgId = profile.org_id;

    const [{ data: orgData }, { data: entityRows }, { data: docRows }] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, legal_name, registration_number, jurisdictions, trading_name, vat_number, tax_number, status")
        .eq("id", orgId)
        .maybeSingle(),
      supabase
        .from("entities")
        .select("id, status, entity_type")
        .eq("org_id", orgId)
        .eq("entity_type", "COMPANY"),
      supabase
        .from("kyc_documents")
        .select("id, doc_type, filename, status, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
    ]);

    setOrg(orgData as OrgData | null);
    setDocs((docRows ?? []) as KycDoc[]);

    const company = (entityRows ?? [])[0];
    setCompanyEntityId(company?.id ?? null);

    if (company?.id) {
      const { data: uboRows } = await supabase
        .from("ubo_links")
        .select("id, ownership_percentage, status, person:entities!ubo_links_person_entity_id_fkey(legal_name, jurisdiction_code)")
        .eq("company_entity_id", company.id);
      setOwners((uboRows ?? []) as unknown as UboRow[]);
    } else {
      setOwners([]);
    }

    // Derive verification, never trust orgData.status alone.
    const hasCoreFields = !!(orgData?.legal_name && orgData?.registration_number);
    const hasVerifiedEntity = (entityRows ?? []).some((e) => e.status === "verified");
    const hasVerifiedDocs = (docRows ?? []).some((d) => d.status === "verified" || d.status === "approved");

    if (hasVerifiedEntity && hasVerifiedDocs) setVerification("verified");
    else if (hasCoreFields || (entityRows ?? []).some((e) => e.status === "pending")) setVerification("in_review");
    else setVerification("incomplete");

    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading KYB profile…
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header + verification badge */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-8 mb-8 md:mb-10">
        <div>
          <h2 className="text-lg md:text-xl font-medium text-foreground tracking-tight">Company Identity</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
            Optional now - completing this speeds up your first Proof of Intent. Identity is bound to every POI you generate.
          </p>
        </div>
        <div className="self-start"><VerificationBadge state={verification} /></div>
      </div>

      {/* Stepper */}
      <nav className="mb-8 md:mb-10 flex items-center gap-1 border-b border-border -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
        {STEPS.map((s) => {
          const active = s.key === activeStep;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => selectStep(s.key)}
              className={[
                "px-4 py-3 text-left transition-colors border-b-2 -mb-px shrink-0 whitespace-nowrap",
                active
                  ? "border-slate-900 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase opacity-70">{s.index}</p>
              <p className="text-sm font-medium mt-0.5">{s.label}</p>
            </button>
          );
        })}
      </nav>

      {activeStep === "entity" && (
        <EntityDetailsStep
          org={org}
          companyEntityId={companyEntityId}
          onSaved={async () => {
            await refresh();
            selectStep("owners");
          }}
        />
      )}

      {activeStep === "owners" && (
        <OwnersStep
          orgId={org?.id ?? null}
          companyEntityId={companyEntityId}
          owners={owners}
          onChanged={refresh}
        />
      )}

      {activeStep === "documents" && (
        <DocumentsStep orgId={org?.id ?? null} userId={user?.id ?? null} docs={docs} onChanged={refresh} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 1, Entity details

function EntityDetailsStep({
  org,
  companyEntityId,
  onSaved,
}: {
  org: OrgData | null;
  companyEntityId: string | null;
  onSaved: () => Promise<void> | void;
}) {
  const [legalName, setLegalName] = useState(org?.legal_name ?? "");
  const [tradingName, setTradingName] = useState(org?.trading_name ?? "");
  const [registration, setRegistration] = useState(org?.registration_number ?? "");
  const [taxNumber, setTaxNumber] = useState(org?.tax_number ?? org?.vat_number ?? "");
  const [jurisdiction, setJurisdiction] = useState(org?.jurisdictions?.[0] ?? "");
  const [saving, setSaving] = useState(false);

  const valid = legalName.trim().length >= 2 && registration.trim().length >= 2 && jurisdiction.trim().length >= 2;

  // ── Unsaved-changes guard ──
  // Compares each local form field against the loaded org snapshot.
  // After a successful save the parent refresh() updates `org`, which
  // realigns the snapshot and clears dirty.
  const isDirty =
    !saving &&
    (
      legalName.trim() !== (org?.legal_name ?? "").trim() ||
      tradingName.trim() !== (org?.trading_name ?? "").trim() ||
      registration.trim() !== (org?.registration_number ?? "").trim() ||
      taxNumber.trim() !== (org?.tax_number ?? org?.vat_number ?? "").trim() ||
      jurisdiction.trim() !== (org?.jurisdictions?.[0] ?? "").trim()
    );
  const { GuardDialog } = useUnsavedChangesGuard(isDirty, {
    title: "Unsaved entity details",
    message:
      "You have unsaved changes to your company KYB profile. If you leave now, your edits will be discarded.",
    confirmLabel: "Discard and leave",
    cancelLabel: "Stay on page",
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!org?.id || !valid) return;
    setSaving(true);
    try {
      const jur = jurisdiction.trim().toUpperCase();
      const { error: orgErr } = await supabase
        .from("organizations")
        .update({
          legal_name: legalName.trim(),
          trading_name: tradingName.trim() || null,
          registration_number: registration.trim(),
          tax_number: taxNumber.trim() || null,
          jurisdictions: [jur],
        })
        .eq("id", org.id);
      if (orgErr) throw orgErr;

      // Mirror to entities (company) so the KYB graph has a node.
      if (companyEntityId) {
        const { error } = await supabase
          .from("entities")
          .update({
            legal_name: legalName.trim(),
            registration_number: registration.trim(),
            tax_number: taxNumber.trim() || null,
            jurisdiction_code: jur,
            status: "PENDING",
          })
          .eq("id", companyEntityId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("entities").insert({
          org_id: org.id,
          entity_type: "COMPANY",
          legal_name: legalName.trim(),
          registration_number: registration.trim(),
          tax_number: taxNumber.trim() || null,
          jurisdiction_code: jur,
          status: "PENDING",
        });
        if (error) throw error;
      }

      toast.success("Entity details saved. Moved to compliance review.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save entity details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <FormField label="Legal Entity Name" required>
        <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={200} placeholder="e.g. Acme Trading (Pty) Ltd" />
      </FormField>
      <FormField label="Trading Name (optional)">
        <Input value={tradingName} onChange={(e) => setTradingName(e.target.value)} maxLength={200} placeholder="If different from legal name" />
      </FormField>
      <FormField label="Registration Number" required>
        <Input value={registration} onChange={(e) => setRegistration(e.target.value)} maxLength={80} placeholder="e.g. 2018/123456/07" />
      </FormField>
      <FormField label="VAT / Tax Number">
        <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} maxLength={80} placeholder="e.g. 4123456789" />
      </FormField>
      <FormField label="Jurisdiction (ISO-3166)" required>
        <Input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} maxLength={3} placeholder="ZA · GB · US" />
      </FormField>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border">
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Saving moves status to <span className="text-muted-foreground">pending</span>
        </p>
        <Button type="submit" disabled={!valid || saving} className="gap-2 w-full sm:w-auto">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {saving ? "Saving…" : "Save & Continue"}
        </Button>
      </div>
      {GuardDialog}
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2, Beneficial owners

function OwnersStep({
  orgId,
  companyEntityId,
  owners,
  onChanged,
}: {
  orgId: string | null;
  companyEntityId: string | null;
  owners: UboRow[];
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [adding, setAdding] = useState(false);

  const totalOwnership = useMemo(
    () => owners.reduce((acc, o) => acc + Number(o.ownership_percentage || 0), 0),
    [owners]
  );

  if (!companyEntityId) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50/60 p-6 text-sm text-amber-900">
        Save your entity details first (Step §01). The company record must exist before owners can be linked.
      </div>
    );
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !companyEntityId) return;
    const pctNum = Number(pct);
    if (!name.trim() || !jurisdiction.trim() || !Number.isFinite(pctNum) || pctNum <= 0 || pctNum > 100) {
      toast.error("Enter a name, valid jurisdiction code, and ownership 0.01 to 100");
      return;
    }
    setAdding(true);
    try {
      const { data: person, error: personErr } = await supabase
        .from("entities")
        .insert({
          org_id: orgId,
          entity_type: "INDIVIDUAL",
          legal_name: name.trim(),
          jurisdiction_code: jurisdiction.trim().toUpperCase(),
          status: "PENDING",
        })
        .select("id")
        .single();
      if (personErr) throw personErr;

      const { error: linkErr } = await supabase.from("ubo_links").insert({
        org_id: orgId,
        company_entity_id: companyEntityId,
        person_entity_id: person.id,
        ownership_percentage: pctNum,
        status: "pending",
      });
      if (linkErr) throw linkErr;

      setName("");
      setPct("");
      setJurisdiction("");
      toast.success("Beneficial owner declared.");
      await onChanged();
    } catch (err) {
      // Surface the underlying database message (e.g. RLS rejection,
      // unique-constraint violation when the same person is declared
      // twice for the same company) so the operator can self-diagnose
      // instead of seeing a bare "Failed to add owner".
      const raw = err instanceof Error ? err.message : String(err);
      let friendly = raw || "Failed to add owner";
      if (/row-level security|violates row-level security/i.test(raw)) {
        friendly =
          "You don't have permission to declare a beneficial owner for this organisation. Contact an administrator if you believe this is a mistake.";
      } else if (/duplicate key value|unique constraint/i.test(raw)) {
        friendly =
          "This person is already declared as a beneficial owner for this company.";
      } else if (/check constraint.*ownership_percentage|ownership_percentage_check/i.test(raw)) {
        friendly = "Ownership percentage must be greater than 0 and at most 100.";
      }
      console.error("[UBO add] failed", err);
      toast.error(friendly, { duration: 8000 });
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(linkId: string) {
    const { error } = await supabase.from("ubo_links").delete().eq("id", linkId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Owner removed.");
    await onChanged();
  }

  return (
    <div className="space-y-8">
      {/* List */}
      <div className="rounded-md border border-border bg-card">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
            Declared Owners ({owners.length})
          </p>
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            Σ {totalOwnership.toFixed(2)}%
          </p>
        </div>
        {owners.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            No beneficial owners declared yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {owners.map((o) => (
              <li key={o.id} className="px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">
                    {o.person?.legal_name ?? "Unnamed"}
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mt-0.5">
                    {o.person?.jurisdiction_code ?? "-"} · {o.status}
                  </p>
                </div>
                <p className="font-mono text-sm text-foreground tabular-nums">
                  {Number(o.ownership_percentage).toFixed(2)}%
                </p>
                <button
                  type="button"
                  onClick={() => handleRemove(o.id)}
                  className="p-1.5 rounded-sm text-muted-foreground/70 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  aria-label="Remove owner"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="rounded-md border border-border bg-muted/40 p-5 space-y-4">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">Add Beneficial Owner</p>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-6">
            <Label htmlFor="ubo-name" className="text-xs text-muted-foreground">Full Legal Name</Label>
            <Input id="ubo-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="e.g. Jane Smith" />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="ubo-jur" className="text-xs text-muted-foreground">Jurisdiction</Label>
            <Input id="ubo-jur" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} maxLength={3} placeholder="ZA" />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="ubo-pct" className="text-xs text-muted-foreground">Ownership %</Label>
            <Input id="ubo-pct" type="number" step="0.01" min="0.01" max="100" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="25.00" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={adding} className="gap-2">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {adding ? "Adding…" : "Add Owner"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 3, Documents

function DocumentsStep({
  orgId,
  userId,
  docs,
  onChanged,
}: {
  orgId: string | null;
  userId: string | null;
  docs: KycDoc[];
  onChanged: () => Promise<void> | void;
}) {
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("incorporation_certificate");
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!orgId || !userId) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File exceeds 20MB limit.");
      return;
    }
    setUploading(true);
    try {
      const sha = await sha256HexOfBlob(file);
      const safeName = file.name.replace(/[^\w.\-]/g, "_");
      const path = `${orgId}/${docType}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("kyc-documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (uploadErr) throw uploadErr;

      const { error: rowErr } = await supabase.from("kyc_documents").insert({
        org_id: orgId,
        uploaded_by: userId,
        doc_type: docType,
        filename: file.name,
        file_size: file.size,
        mime_type: file.type || "application/octet-stream",
        storage_path: path,
        sha256_hash: sha,
        status: "pending",
      });
      if (rowErr) throw rowErr;

      toast.success("Document uploaded. Hash sealed for audit.");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Doc type + drop zone */}
      <div className="rounded-md border border-border bg-card p-5 space-y-4">
        <div>
          <Label htmlFor="doc-type" className="text-xs text-muted-foreground">Document Type</Label>
          <select
            id="doc-type"
            value={docType}
            onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-base md:text-sm min-h-[44px]"
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <label
          className={[
            "block rounded-md border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors",
            uploading
              ? "border-border bg-muted cursor-wait"
              : "border-border bg-muted/40 hover:border-slate-500 hover:bg-muted",
          ].join(" ")}
        >
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-sm">Hashing & uploading…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="h-5 w-5" />
              <p className="text-sm font-medium text-foreground">Click to upload</p>
              <p className="text-xs text-muted-foreground">PDF, PNG or JPG · max 20MB · SHA-256 sealed on upload</p>
            </div>
          )}
        </label>
      </div>

      {/* Existing docs */}
      <div className="rounded-md border border-border bg-card">
        <div className="px-5 py-3 border-b border-border">
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
            Submitted Documents ({docs.length})
          </p>
        </div>
        {docs.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            No documents submitted yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="px-5 py-4 flex items-center gap-4">
                <FileCheck2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{d.filename}</p>
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mt-0.5">
                    {d.doc_type.replace(/_/g, " ")} · {new Date(d.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={[
                    "font-mono text-[10px] tracking-[0.2em] uppercase px-2 py-1 rounded-sm",
                    d.status === "verified" || d.status === "approved"
                      ? "bg-[hsl(var(--emerald-muted))] text-[hsl(var(--emerald))] border border-[hsl(var(--emerald)/0.2)]"
                      : d.status === "rejected"
                        ? "bg-rose-50 text-rose-800 border border-rose-200"
                        : "bg-amber-50 text-amber-800 border border-amber-200",
                  ].join(" ")}
                >
                  {d.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers

function VerificationBadge({ state }: { state: VerificationState }) {
  if (state === "verified") {
    return (
      <div className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[hsl(var(--emerald-muted))] border border-[hsl(var(--emerald)/0.2)] text-[hsl(var(--emerald))] text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        Verified Counterparty
      </div>
    );
  }
  if (state === "in_review") {
    // Muted per "light wedge" policy: avoid loud amber "Awaiting Compliance Review"
    // pre-engagement. KYB enforcement still fires at POI mint / WaD gates.
    return (
      <div className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-muted border border-border text-muted-foreground text-xs font-medium">
        <Clock className="h-3.5 w-3.5" strokeWidth={2} />
        Profile in progress
      </div>
    );
  }
  return (
    <div className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-muted border border-border text-muted-foreground text-xs font-medium">
      <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />
      Complete when ready
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}
