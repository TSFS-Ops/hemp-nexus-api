/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: New Deal Release form. Calls fw_admin_release_deal_v1.
 *
 * Consent gate + non-empty admin override reason are enforced client-side
 * (zod schema) and server-side by the RPC. Raw document toggles default
 * OFF and require an explicit warning before enabling.
 */
import { useMemo, useState } from "react";
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
import { createRelease, listFunderOrganisations } from "@/lib/funder-workspace/admin-client";
import {
  DEFAULT_RELEASE_PERMISSIONS,
  RAW_DOCUMENT_PERMISSION_KEYS,
  requiresAdminOverride,
} from "@/lib/funder-workspace/permissions";
import { releaseFormSchema, type ReleaseFormValues } from "@/lib/funder-workspace/validation";
import { CONSENT_STATUSES } from "@/lib/funder-workspace/types";

const RAW_KEYS = new Set<string>(RAW_DOCUMENT_PERMISSION_KEYS);

export default function FunderWorkspaceNewRelease() {
  const navigate = useNavigate();
  const orgsQuery = useQuery({ queryKey: ["fw-orgs"], queryFn: listFunderOrganisations });

  const [values, setValues] = useState<ReleaseFormValues>({
    funder_organisation_id: "",
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

  const overrideNeeded = requiresAdminOverride(values.buyer_consent_status, values.seller_consent_status);
  const rawEnabled = values.can_view_raw_documents || values.can_download_raw_documents || values.can_view_unmasked_sensitive_details;

  const approvedOrgs = useMemo(() => {
    return (orgsQuery.data ?? []).filter((o) => o.status === "active" && (o.approval_status === "approved" || o.approval_status === "admin_created" || o.approval_status === null));
  }, [orgsQuery.data]);

  const set = <K extends keyof ReleaseFormValues>(k: K, v: ReleaseFormValues[K]) => {
    setValues((prev) => ({ ...prev, [k]: v }));
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
      const releaseId = await createRelease({
        p_funder_organisation_id: parsed.data.funder_organisation_id,
        p_deal_reference: parsed.data.deal_reference.trim(),
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
      <BackButton to="/admin/funder-workspace/releases" label="Releases" />
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
                    <SelectItem key={o.id} value={o.id}>{o.name} ({o.jurisdiction ?? "—"})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.funder_organisation_id && <p className="text-xs text-destructive mt-1">{errors.funder_organisation_id}</p>}
            </div>
            <div>
              <Label htmlFor="deal-ref">Deal reference *</Label>
              <Input id="deal-ref" value={values.deal_reference} onChange={(e) => set("deal_reference", e.target.value)} data-testid="fw-release-deal-ref" />
              {errors.deal_reference && <p className="text-xs text-destructive mt-1">{errors.deal_reference}</p>}
            </div>
            <div>
              <Label htmlFor="pack-id">Evidence pack ID (UUID) *</Label>
              <Input id="pack-id" value={values.evidence_pack_id} onChange={(e) => set("evidence_pack_id", e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              {errors.evidence_pack_id && <p className="text-xs text-destructive mt-1">{errors.evidence_pack_id}</p>}
            </div>
            <div>
              <Label htmlFor="pack-ver">Evidence pack version *</Label>
              <Input id="pack-ver" value={values.evidence_pack_version} onChange={(e) => set("evidence_pack_version", e.target.value)} placeholder="e.g. 1" />
              {errors.evidence_pack_version && <p className="text-xs text-destructive mt-1">{errors.evidence_pack_version}</p>}
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
                  {CONSENT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Seller consent</Label>
              <Select value={values.seller_consent_status} onValueChange={(v) => set("seller_consent_status", v as never)}>
                <SelectTrigger data-testid="fw-release-seller-consent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
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
