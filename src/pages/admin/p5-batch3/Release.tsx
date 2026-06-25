/**
 * P-5 Batch 3 — Stage 4 Release-to-Funder admin flow.
 *
 * Wraps p5b3CreateAccessGrant. Submit is blocked unless every required
 * field — funder user, transaction reference, evidence pack version,
 * release reason, expiry — is provided.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  P5B3_FUNDER_ROLES,
  P5B3_REQUEST_CATEGORIES,
  type P5B3FunderRole,
} from "@/lib/p5-batch3/constants";
import { p5b3CreateAccessGrant } from "@/lib/p5-batch3/rpc";
import { P5B3ProviderSafeLabel } from "./components/P5B3ProviderSafeLabel";

export default function P5Batch3Release() {
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<P5B3FunderRole>("funder_reviewer");
  const [txnRef, setTxnRef] = useState("");
  const [dealId, setDealId] = useState("");
  const [packId, setPackId] = useState("");
  const [packVersion, setPackVersion] = useState("");
  const [expiry, setExpiry] = useState("");
  const [canDownload, setCanDownload] = useState(false);
  const [unmaskedBank, setUnmaskedBank] = useState(false);
  const [permitted, setPermitted] = useState<string[]>(["commercial", "financial"]);
  const [releaseReason, setReleaseReason] = useState("");
  const [ndaRef, setNdaRef] = useState("");
  const [busy, setBusy] = useState(false);

  const validation = useMemo(() => {
    const errs: string[] = [];
    if (!orgId.trim()) errs.push("Funder organisation is required");
    if (!userId.trim()) errs.push("Named funder user is required");
    if (!txnRef.trim()) errs.push("Transaction reference is required");
    if (!packId.trim()) errs.push("Evidence pack ID is required");
    if (!packVersion.trim()) errs.push("Evidence pack version is required");
    if (!expiry.trim()) errs.push("Expiry is required");
    if (releaseReason.trim().length < 4) errs.push("Release reason is required");
    return errs;
  }, [orgId, userId, txnRef, packId, packVersion, expiry, releaseReason]);

  const submit = async () => {
    if (validation.length > 0) {
      toast.error(validation[0]);
      return;
    }
    setBusy(true);
    try {
      await p5b3CreateAccessGrant({
        p_user_id: userId.trim(),
        p_transaction_reference: txnRef.trim(),
        p_deal_id: dealId.trim() || null,
        p_evidence_pack_id: packId.trim(),
        p_evidence_pack_version: packVersion.trim(),
        p_role: role,
        p_access_scope: { organisation_id: orgId.trim() },
        p_permitted_categories: permitted,
        p_can_download: canDownload,
        p_can_view_raw_documents: false,
        p_unmasked_bank_details: unmaskedBank,
        p_release_reason: releaseReason.trim(),
        p_nda_reference: ndaRef.trim() || null,
        p_expiry_at: new Date(expiry).toISOString(),
      });
      toast.success("Access grant created");
      setReleaseReason("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <Link to="/admin/p5-batch3" className="text-sm text-muted-foreground underline">← Funder Workflow</Link>
        <h1 className="text-2xl font-semibold mt-1">Release to Funder</h1>
        <p className="text-sm text-muted-foreground">
          A funder role alone does not grant access. Access is scoped to one named user,
          one transaction reference, one evidence pack version, and an explicit expiry.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grant scope</CardTitle>
          <CardDescription>All fields are recorded in the audit trail.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Funder organisation ID" value={orgId} onChange={setOrgId} required />
          <Field label="Named funder user ID" value={userId} onChange={setUserId} required />
          <div className="space-y-1">
            <Label>Role for this grant</Label>
            <Select value={role} onValueChange={(v) => setRole(v as P5B3FunderRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {P5B3_FUNDER_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Field label="Transaction reference" value={txnRef} onChange={setTxnRef} required />
          <Field label="Deal ID (optional)" value={dealId} onChange={setDealId} />
          <Field label="Evidence pack ID" value={packId} onChange={setPackId} required />
          <Field label="Evidence pack version" value={packVersion} onChange={setPackVersion} required />
          <div className="space-y-1">
            <Label htmlFor="p5b3-expiry">Access expires at *</Label>
            <Input id="p5b3-expiry" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <Field label="NDA reference (optional)" value={ndaRef} onChange={setNdaRef} />
          <div className="md:col-span-2 space-y-1">
            <Label>Permitted request categories</Label>
            <div className="flex flex-wrap gap-2">
              {P5B3_REQUEST_CATEGORIES.map((c) => {
                const checked = permitted.includes(c);
                return (
                  <label key={c} className="flex items-center gap-1 text-xs border rounded px-2 py-1">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setPermitted((prev) =>
                          v ? [...prev, c] : prev.filter((x) => x !== c),
                        )
                      }
                    />
                    {c}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center gap-2">
              <Checkbox id="p5b3-can-download" checked={canDownload} onCheckedChange={(v) => setCanDownload(Boolean(v))} />
              <Label htmlFor="p5b3-can-download">Permit PDF download of released evidence pack</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="p5b3-unmask-bank" checked={unmaskedBank} onCheckedChange={(v) => setUnmaskedBank(Boolean(v))} />
              <Label htmlFor="p5b3-unmask-bank">Permit unmasked banking visibility (requires NDA reference)</Label>
            </div>
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label htmlFor="p5b3-reason">Release reason *</Label>
            <Textarea
              id="p5b3-reason"
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder="Recorded in audit"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview — funder-facing wording</CardTitle>
          <CardDescription>
            All provider-derived labels in the funder surface are routed through the wording guard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            Provider status:{" "}
            <P5B3ProviderSafeLabel
              label="Verified"
              context={{ provider_live: false, provider_result_reference: null, approved_manual_decision_ref: null }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Unsafe labels (e.g. unverified provider claims) are automatically replaced.
          </div>
        </CardContent>
      </Card>

      {validation.length > 0 ? (
        <ul className="text-sm text-destructive list-disc pl-5">
          {validation.map((v) => <li key={v}>{v}</li>)}
        </ul>
      ) : null}

      <div className="flex justify-end">
        <Button
          disabled={busy || validation.length > 0}
          onClick={submit}
          data-testid="p5b3-release-submit"
        >
          Create access grant
        </Button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, required = false,
}: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}{required ? " *" : ""}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
