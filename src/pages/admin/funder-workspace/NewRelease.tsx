/**
 * Institutional Funder Evidence Workspace — Batch 2 + Batch 8
 * Admin: New Deal Release form. Calls fw_admin_release_deal_v2 (canonical
 * match_id required). The unrestricted free-text deal-reference field has
 * been replaced with a server-backed canonical deal selector.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  createReleaseV2,
  listEligibleEvidencePacks,
  listFunderOrganisations,
} from "@/lib/funder-workspace/admin-client";
import { CanonicalDealSelector } from "./components/CanonicalDealSelector";
import {
  DEFAULT_RELEASE_PERMISSIONS,
  RAW_DOCUMENT_PERMISSION_KEYS,
  requiresAdminOverride,
} from "@/lib/funder-workspace/permissions";
import { releaseFormSchema, type ReleaseFormValues } from "@/lib/funder-workspace/validation";
import { CONSENT_STATUSES, type ConsentStatus } from "@/lib/funder-workspace/types";

const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  not_required: "Not required",
  pending: "Pending",
  granted: "Granted",
  declined: "Declined",
  overridden: "Overridden (admin)",
};

const RAW_KEYS = new Set<string>(RAW_DOCUMENT_PERMISSION_KEYS);

export default function FunderWorkspaceNewRelease() {
  const navigate = useNavigate();
  const orgsQuery = useQuery({ queryKey: ["fw-orgs"], queryFn: listFunderOrganisations });

  const [values, setValues] = useState<ReleaseFormValues>({
    funder_organisation_id: "",
    match_id: "",
    deal_reference: "",
    evidence_pack_id: "",
    evidence_pack_version: "",
    release_reason: "",
    expires_at: "",
    buyer_consent_status: "pending",
    seller_consent_status: "pending",
    admin_override_reason: "",
    ...DEFAULT_RELEASE_PERMISSIONS,
  });

  const [errors, setErrors] = useState<Partial<Record<keyof ReleaseFormValues, string>>>({});
  const [busy, setBusy] = useState(false);
  const packsQuery = useQuery({
    queryKey: ["fw-eligible-packs", values.match_id],
    queryFn: () => listEligibleEvidencePacks(values.match_id),
    enabled: false,
  });

  const overrideNeeded = requiresAdminOverride(values.buyer_consent_status, values.seller_consent_status);
  const rawEnabled = values.can_view_raw_documents || values.can_download_raw_documents || values.can_view_unmasked_sensitive_details;
  const packs = packsQuery.data ?? [];

  const approvedOrgs = useMemo(() => {
    return (orgsQuery.data ?? []).filter((o) => o.status === "active" && (o.approval_status === "approved" || o.approval_status === "admin_created" || o.approval_status === null));
  }, [orgsQuery.data]);

  const set = <K extends keyof ReleaseFormValues>(k: K, v: ReleaseFormValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
  };

  useEffect(() => {
    if (!values.match_id) return;
    void packsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.match_id]);

  useEffect(() => {
    if (!values.match_id || packsQuery.isFetching) return;
    const current = packs.find(
      (p) =>
        p.evidence_pack_id === values.evidence_pack_id &&
        p.evidence_pack_version === values.evidence_pack_version,
    );
    if (current) return;
    if (packs.length === 1) {
      setValues((prev) => ({
        ...prev,
        evidence_pack_id: packs[0].evidence_pack_id,
        evidence_pack_version: packs[0].evidence_pack_version,
      }));
      return;
    }
    if (values.evidence_pack_id || values.evidence_pack_version) {
      setValues((prev) => ({ ...prev, evidence_pack_id: "", evidence_pack_version: "" }));
    }
  }, [packs, packsQuery.isFetching, values.evidence_pack_id, values.evidence_pack_version, values.match_id]);

  const choosePack = (compound: string) => {
    const pack = packs.find((p) => `${p.evidence_pack_id}::${p.evidence_pack_version}` === compound);
    if (!pack) return;
    setValues((prev) => ({
      ...prev,
      evidence_pack_id: pack.evidence_pack_id,
      evidence_pack_version: pack.evidence_pack_version,
    }));
  };

  const onDealChange = (matchId: string) => {
    setValues((prev) => ({
      ...prev,
      match_id: matchId,
      evidence_pack_id: "",
      evidence_pack_version: "",
    }));
  };

  const toggleRaw = (k: keyof ReleaseFormValues, v: boolean) => {
    if (v && RAW_KEYS.has(k as string)) {
      const ok = window.confirm(
        "You are enabling a raw-document / unmasked-detail permission. This grants the funder access to underlying documents or sensitive fields. Continue?",
      );
      if (!ok) return;
    }
    set(k, v as never);
  };

  const submit = async () => {
    const parsed = releaseFormSchema.safeParse(values);
    if (!parsed.success) {
      const fe: Partial<Record<keyof ReleaseFormValues, string>> = {};
      for (const iss of parsed.error.issues) {
        const key = iss.path[0] as keyof ReleaseFormValues | undefined;
        if (key) fe[key] = iss.message;
      }
      setErrors(fe);
      toast.error("Please fix the highlighted fields");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const releaseId = await createReleaseV2({
        p_funder_organisation_id: parsed.data.funder_organisation_id,
        p_match_id: parsed.data.match_id,
        p_evidence_pack_id: parsed.data.evidence_pack_id,
        p_evidence_pack_version: parsed.data.evidence_pack_version.trim(),
        p_release_reason: parsed.data.release_reason.trim(),
        p_expires_at: new Date(parsed.data.expires_at).toISOString(),
        p_can_download_compiled_pack: parsed.data.can_download_compiled_pack,
        p_can_view_raw_documents: parsed.data.can_view_raw_documents,
        p_can_download_raw_documents: parsed.data.can_download_raw_documents,
        p_can_view_unmasked_sensitive_details: parsed.data.can_view_unmasked_sensitive_details,
        p_buyer_consent_status: parsed.data.buyer_consent_status,
        p_seller_consent_status: parsed.data.seller_consent_status,
        p_admin_override_reason: parsed.data.admin_override_reason?.trim() || null,
      });

      toast.success("Release created");
      if (releaseId) navigate(`/admin/funder-workspace/releases/${releaseId}`);
      else navigate(`/admin/funder-workspace/releases`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-3xl" data-testid="fw-admin-new-release">
      <BackButton fallback="/admin/funder-workspace/releases" label="Releases" />
      <div>
        <h1 className="text-2xl font-semibold">Release a deal to a funder</h1>
        <p className="text-sm text-muted-foreground">
          Grants a funder organisation access to a specific evidence pack version. Consent gating and audit are enforced server-side.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Release scope</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Funder organisation *</Label>
              <Select value={values.funder_organisation_id} onValueChange={(v) => set("funder_organisation_id", v)}>
                <SelectTrigger data-testid="fw-release-org"><SelectValue placeholder="Select an approved funder" /></SelectTrigger>
                <SelectContent>
                  {approvedOrgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.jurisdiction ? `${o.name} (${o.jurisdiction})` : o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.funder_organisation_id && <p className="text-xs text-destructive mt-1">{errors.funder_organisation_id}</p>}
            </div>
            <div className="md:col-span-2">
              <Label>Canonical deal *</Label>
              <CanonicalDealSelector
                value={values.match_id}
                onChange={(matchId) => onDealChange(matchId)}
              />
              {errors.match_id && <p className="text-xs text-destructive mt-1">{errors.match_id}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                Select a real deal from the platform. Free-text references are not accepted for new releases.
              </p>
            </div>

            <div className="md:col-span-2" data-testid="fw-release-evidence-pack-section">
              <Label>Evidence pack *</Label>
              {!values.match_id && (
                <p className="text-sm text-muted-foreground mt-1">
                  Select a canonical deal first.
                </p>
              )}
              {values.match_id && packsQuery.isFetching && (
                <p className="text-sm text-muted-foreground mt-1">Finding available evidence packs…</p>
              )}
              {values.match_id && !packsQuery.isFetching && packs.length === 0 && (
                <Alert className="mt-2" data-testid="fw-release-no-pack">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>No evidence pack available</AlertTitle>
                  <AlertDescription>
                    No evidence pack is available for this deal yet. Create or prepare the evidence pack before releasing the deal.
                  </AlertDescription>
                </Alert>
              )}
              {packs.length === 1 && values.evidence_pack_id && (
                <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="fw-release-auto-pack">
                  {packs[0].label}
                </div>
              )}
              {packs.length > 1 && (
                <Select
                  value={values.evidence_pack_id ? `${values.evidence_pack_id}::${values.evidence_pack_version}` : ""}
                  onValueChange={choosePack}
                >
                  <SelectTrigger className="mt-2" data-testid="fw-release-pack-selector">
                    <SelectValue placeholder="Select an evidence pack" />
                  </SelectTrigger>
                  <SelectContent>
                    {packs.map((p) => (
                      <SelectItem key={`${p.evidence_pack_id}::${p.evidence_pack_version}`} value={`${p.evidence_pack_id}::${p.evidence_pack_version}`}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(errors.evidence_pack_id || errors.evidence_pack_version) && (
                <p className="text-xs text-destructive mt-1">
                  {errors.evidence_pack_id ?? errors.evidence_pack_version}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="expires-at">Expiry date *</Label>
              <Input id="expires-at" type="datetime-local" value={values.expires_at} onChange={(e) => set("expires_at", e.target.value)} data-testid="fw-release-expiry" />
              {errors.expires_at && <p className="text-xs text-destructive mt-1">{errors.expires_at}</p>}
            </div>
          </div>
          <div>
            <Label htmlFor="release-reason">Release reason *</Label>
            <Textarea id="release-reason" value={values.release_reason} onChange={(e) => set("release_reason", e.target.value)} maxLength={1000} />
            {errors.release_reason && <p className="text-xs text-destructive mt-1">{errors.release_reason}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Consent</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Buyer consent</Label>
              <Select value={values.buyer_consent_status} onValueChange={(v) => set("buyer_consent_status", v as never)}>
                <SelectTrigger data-testid="fw-release-buyer-consent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{CONSENT_STATUS_LABELS[s]}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Seller consent</Label>
              <Select value={values.seller_consent_status} onValueChange={(v) => set("seller_consent_status", v as never)}>
                <SelectTrigger data-testid="fw-release-seller-consent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{CONSENT_STATUS_LABELS[s]}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {overrideNeeded && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Admin override required</AlertTitle>
              <AlertDescription>
                Buyer or seller consent is not "granted" or "not_required". Provide a written admin override reason. This will be captured in the audit ledger.
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Label htmlFor="override-reason">Admin override reason{overrideNeeded ? " *" : ""}</Label>
            <Textarea
              id="override-reason"
              value={values.admin_override_reason ?? ""}
              onChange={(e) => set("admin_override_reason", e.target.value)}
              maxLength={1000}
              placeholder={overrideNeeded ? "Explain why this release proceeds without full consent." : "Optional — leave blank if not overriding."}
              data-testid="fw-release-override-reason"
            />
            {errors.admin_override_reason && <p className="text-xs text-destructive mt-1">{errors.admin_override_reason}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Permissions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <PermToggle label="Can view evidence summary" checked={values.can_view_evidence_summary} onChange={(v) => set("can_view_evidence_summary", v)} />
          <PermToggle label="Can view evidence room" checked={values.can_view_evidence_room} onChange={(v) => set("can_view_evidence_room", v)} />
          <PermToggle label="Can download compiled pack" checked={values.can_download_compiled_pack} onChange={(v) => set("can_download_compiled_pack", v)} />
          <div className="border-t pt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Raw-document and unmasked-detail toggles default OFF. Enabling them grants deeper access.
            </p>
            <PermToggle label="Can view raw documents" checked={values.can_view_raw_documents} onChange={(v) => toggleRaw("can_view_raw_documents", v)} testId="fw-release-raw-view" warn />
            <PermToggle label="Can download raw documents" checked={values.can_download_raw_documents} onChange={(v) => toggleRaw("can_download_raw_documents", v)} testId="fw-release-raw-download" warn />
            <PermToggle label="Can view unmasked sensitive details" checked={values.can_view_unmasked_sensitive_details} onChange={(v) => toggleRaw("can_view_unmasked_sensitive_details", v)} testId="fw-release-unmasked" warn />
          </div>
          {rawEnabled && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Elevated access enabled</AlertTitle>
              <AlertDescription>
                This release grants raw-document or unmasked-detail access. Confirm the funder has the appropriate NDA in place.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate("/admin/funder-workspace/releases")}>Cancel</Button>
        <Button onClick={submit} disabled={busy} data-testid="fw-release-submit">Create release</Button>
      </div>
    </div>
  );
}

function PermToggle({
  label, checked, onChange, testId, warn,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className={warn ? "text-sm" : "text-sm"}>{label}</div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

// Re-export for tests to avoid re-inferring the schema shape.
export const __FW_RELEASE_SCHEMA__ = releaseFormSchema as z.ZodTypeAny;
