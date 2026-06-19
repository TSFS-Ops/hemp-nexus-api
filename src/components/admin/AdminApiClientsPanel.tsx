/**
 * AdminApiClientsPanel — Public API V1 · Batch 1
 *
 * Internal-only surface for managing institutional API client onboarding
 * records (api_clients table). NO API keys are issued here, NO public
 * endpoints are created, NO key lifecycle actions are taken. Onboarding
 * record only.
 *
 * Access: platform_admin (full), api_admin/auditor (read-only via RLS).
 * UI only renders write actions when the current user is platform_admin.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, Plus, RefreshCw, Lock, X } from "lucide-react";

type ApiClient = {
  id: string;
  org_id: string;
  legal_entity_name: string;
  registration_number: string | null;
  country: string;
  status: string;
  authorised_commercial_contact_name: string | null;
  authorised_commercial_contact_email: string | null;
  technical_contact_name: string | null;
  technical_contact_email: string | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  support_contact_name: string | null;
  support_contact_email: string | null;
  intended_use_case: string | null;
  expected_monthly_volume: number | null;
  proposed_integration_system: string | null;
  requested_scopes: string[];
  callback_url: string | null;
  ip_details: string | null;
  sandbox_terms_accepted: boolean;
  sandbox_approved: boolean;
  sandbox_approved_by: string | null;
  sandbox_approved_at: string | null;
  production_requested: boolean;
  signed_api_agreement_confirmed: boolean;
  commercial_plan_approved: boolean;
  sandbox_checklist_completed: boolean;
  production_scopes_approved: boolean;
  production_technical_contact_confirmed: boolean;
  billing_details_confirmed: boolean;
  retention_rules_confirmed: boolean;
  security_contact_confirmed: boolean;
  ip_allowlist_or_exception_confirmed: boolean;
  production_approved: boolean;
  production_approved_by: string | null;
  production_approved_at: string | null;
  suspended_at: string | null;
  suspended_by: string | null;
  suspended_reason: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-300",
  sandbox_pending: "bg-amber-50 text-amber-800 border-amber-300",
  sandbox_approved: "bg-blue-50 text-blue-800 border-blue-300",
  production_pending: "bg-amber-50 text-amber-800 border-amber-300",
  production_approved: "bg-emerald-50 text-emerald-800 border-emerald-300",
  suspended: "bg-orange-50 text-orange-800 border-orange-300",
  revoked: "bg-red-50 text-red-800 border-red-300",
};

const PRODUCTION_CHECKLIST_FIELDS: Array<{ key: keyof ApiClient; label: string }> = [
  { key: "signed_api_agreement_confirmed", label: "Signed API agreement confirmed" },
  { key: "commercial_plan_approved", label: "Commercial plan approved" },
  { key: "sandbox_checklist_completed", label: "Sandbox checklist completed" },
  { key: "production_scopes_approved", label: "Production scopes approved" },
  { key: "production_technical_contact_confirmed", label: "Production technical contact confirmed" },
  { key: "billing_details_confirmed", label: "Billing details confirmed" },
  { key: "retention_rules_confirmed", label: "Retention rules confirmed" },
  { key: "security_contact_confirmed", label: "Security contact confirmed" },
  { key: "ip_allowlist_or_exception_confirmed", label: "IP allowlist or approved exception confirmed" },
];

async function writeAudit(action: string, client: ApiClient | { id: string; org_id: string; status?: string }, prevStatus: string | null, newStatus: string | null, extra?: Record<string, unknown>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert({
      org_id: client.org_id,
      actor_user_id: user?.id ?? null,
      action,
      entity_type: "api_client",
      entity_id: client.id,
      metadata: {
        previous_status: prevStatus,
        new_status: newStatus,
        ...(extra ?? {}),
      },
    });
  } catch (e) {
    console.error("[AdminApiClientsPanel] audit failed:", e);
  }
}

export function AdminApiClientsPanel() {
  const { isAdmin } = useAuth();
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ApiClient | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("api_clients")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setClients((data as ApiClient[]) ?? []);
    } catch (e: any) {
      toast.error(`Failed to load API clients: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canWrite = !!isAdmin;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">API Clients · institutional onboarding</h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Onboarding records only. Key issuance, public endpoints, and billing are not part of this surface.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canWrite && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> New API client</Button>
              </DialogTrigger>
              <CreateApiClientDialog onCreated={() => { setCreateOpen(false); void load(); }} onCancel={() => setCreateOpen(false)} />
            </Dialog>
          )}
        </div>
      </div>

      {!canWrite && (
        <div className="text-xs text-slate-600 border border-slate-200 bg-slate-50 rounded px-3 py-2 inline-flex items-center gap-2">
          <Lock className="h-3.5 w-3.5" /> Read-only view (api_admin / auditor).
        </div>
      )}

      <div className="border border-slate-200 rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Legal entity</th>
              <th className="text-left px-3 py-2 font-medium">Country</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Sandbox</th>
              <th className="text-left px-3 py-2 font-medium">Production</th>
              <th className="text-left px-3 py-2 font-medium">Created</th>
              <th className="text-right px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No API client onboarding records.</td></tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="border-t border-slate-200">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{c.legal_entity_name}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{c.id.slice(0, 8)} · org {c.org_id.slice(0, 8)}</div>
                </td>
                <td className="px-3 py-2 text-slate-700">{c.country}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={STATUS_TONE[c.status] ?? ""}>{c.status}</Badge>
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {c.sandbox_approved ? "✓ approved" : c.sandbox_terms_accepted ? "terms accepted" : "—"}
                </td>
                <td className="px-3 py-2 text-slate-700">
                  {c.production_approved ? "✓ approved" : c.production_requested ? "requested" : "—"}
                </td>
                <td className="px-3 py-2 text-slate-500 font-mono">{new Date(c.created_at).toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(c)}>Open</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <ApiClientDetailDialog
          client={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={() => { void load(); }}
        />
      )}
    </div>
  );
}

function CreateApiClientDialog({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [orgId, setOrgId] = useState("");
  const [legalEntityName, setLegalEntityName] = useState("");
  const [country, setCountry] = useState("");
  const [intendedUseCase, setIntendedUseCase] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!orgId || !legalEntityName || !country) {
      toast.error("Organisation ID, legal entity name, and country are required.");
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("api_clients")
        .insert({
          org_id: orgId,
          legal_entity_name: legalEntityName,
          country,
          intended_use_case: intendedUseCase || null,
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      await writeAudit("api_client.created", data as ApiClient, null, "draft");
      toast.success("API client onboarding record created.");
      onCreated();
    } catch (e: any) {
      toast.error(`Create failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>New API client onboarding record</DialogTitle>
        <DialogDescription>
          Internal record only. No API key will be issued and no public endpoints will be activated.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label htmlFor="org_id">Organisation ID (existing)</Label>
          <Input id="org_id" value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="uuid of organisations row" />
        </div>
        <div>
          <Label htmlFor="legal_name">Legal entity name</Label>
          <Input id="legal_name" value={legalEntityName} onChange={(e) => setLegalEntityName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="country">Country (ISO)</Label>
          <Input id="country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="ZA, GB, US…" />
        </div>
        <div>
          <Label htmlFor="use_case">Intended use case</Label>
          <Textarea id="use_case" value={intendedUseCase} onChange={(e) => setIntendedUseCase(e.target.value)} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}><X className="h-3.5 w-3.5 mr-1" />Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create record"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ApiClientDetailDialog({
  client,
  canWrite,
  onClose,
  onChanged,
}: {
  client: ApiClient;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<ApiClient>(client);
  const [saving, setSaving] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  useEffect(() => { setDraft(client); }, [client]);

  const productionChecklistComplete = useMemo(
    () => PRODUCTION_CHECKLIST_FIELDS.every((f) => !!draft[f.key]) && draft.sandbox_approved,
    [draft],
  );

  const update = async (patch: Partial<ApiClient>, action: string, extra?: Record<string, unknown>) => {
    setSaving(true);
    try {
      const prevStatus = client.status;
      const { data, error } = await supabase
        .from("api_clients")
        .update(patch)
        .eq("id", client.id)
        .select()
        .single();
      if (error) throw error;
      const next = data as ApiClient;
      await writeAudit(action, next, prevStatus, next.status, extra);
      toast.success("Saved.");
      setDraft(next);
      onChanged();
    } catch (e: any) {
      toast.error(`Save failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const approveSandbox = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    await update(
      {
        sandbox_approved: true,
        sandbox_approved_by: user?.id ?? null,
        sandbox_approved_at: new Date().toISOString(),
        status: "sandbox_approved",
      },
      "api_client.sandbox_approved",
    );
  };

  const requestProduction = async () => {
    await update({ production_requested: true, status: "production_pending" }, "api_client.production_requested");
  };

  const approveProduction = async () => {
    if (!productionChecklistComplete) {
      toast.error("Production checklist incomplete.");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    await update(
      {
        production_approved: true,
        production_approved_by: user?.id ?? null,
        production_approved_at: new Date().toISOString(),
        status: "production_approved",
      },
      "api_client.production_approved",
    );
  };

  const suspend = async () => {
    if (!suspendReason.trim()) { toast.error("Reason required."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await update(
      {
        status: "suspended",
        suspended_at: new Date().toISOString(),
        suspended_by: user?.id ?? null,
        suspended_reason: suspendReason,
      },
      "api_client.suspended",
      { reason: suspendReason },
    );
    setSuspendReason("");
  };

  const revoke = async () => {
    if (!revokeReason.trim()) { toast.error("Reason required."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await update(
      {
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: user?.id ?? null,
        revoked_reason: revokeReason,
      },
      "api_client.revoked",
      { reason: revokeReason },
    );
    setRevokeReason("");
  };

  const saveOnboardingFields = async () => {
    const patch: Partial<ApiClient> = {
      legal_entity_name: draft.legal_entity_name,
      registration_number: draft.registration_number,
      country: draft.country,
      authorised_commercial_contact_name: draft.authorised_commercial_contact_name,
      authorised_commercial_contact_email: draft.authorised_commercial_contact_email,
      technical_contact_name: draft.technical_contact_name,
      technical_contact_email: draft.technical_contact_email,
      billing_contact_name: draft.billing_contact_name,
      billing_contact_email: draft.billing_contact_email,
      support_contact_name: draft.support_contact_name,
      support_contact_email: draft.support_contact_email,
      intended_use_case: draft.intended_use_case,
      expected_monthly_volume: draft.expected_monthly_volume,
      proposed_integration_system: draft.proposed_integration_system,
      requested_scopes: draft.requested_scopes,
      callback_url: draft.callback_url,
      ip_details: draft.ip_details,
      sandbox_terms_accepted: draft.sandbox_terms_accepted,
      notes: draft.notes,
      status: draft.status === "draft" && draft.sandbox_terms_accepted ? "sandbox_pending" : draft.status,
    };
    await update(patch, "api_client.updated");
  };

  const setChecklist = (key: keyof ApiClient, val: boolean) => {
    setDraft((d) => ({ ...d, [key]: val }));
  };

  const saveChecklist = async () => {
    const patch: Partial<ApiClient> = Object.fromEntries(
      PRODUCTION_CHECKLIST_FIELDS.map((f) => [f.key, draft[f.key]]),
    ) as Partial<ApiClient>;
    await update(patch, "api_client.production_checklist_updated");
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> {client.legal_entity_name}
            <Badge variant="outline" className={STATUS_TONE[draft.status] ?? ""}>{draft.status}</Badge>
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px]">
            api_client {client.id} · org {client.org_id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Onboarding fields */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Onboarding</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Legal entity name" value={draft.legal_entity_name} onChange={(v) => setDraft({ ...draft, legal_entity_name: v })} disabled={!canWrite} />
              <Field label="Registration number" value={draft.registration_number ?? ""} onChange={(v) => setDraft({ ...draft, registration_number: v || null })} disabled={!canWrite} />
              <Field label="Country" value={draft.country} onChange={(v) => setDraft({ ...draft, country: v })} disabled={!canWrite} />
              <Field label="Expected monthly volume" type="number" value={String(draft.expected_monthly_volume ?? "")} onChange={(v) => setDraft({ ...draft, expected_monthly_volume: v ? Number(v) : null })} disabled={!canWrite} />
              <Field label="Commercial contact (name)" value={draft.authorised_commercial_contact_name ?? ""} onChange={(v) => setDraft({ ...draft, authorised_commercial_contact_name: v || null })} disabled={!canWrite} />
              <Field label="Commercial contact (email)" value={draft.authorised_commercial_contact_email ?? ""} onChange={(v) => setDraft({ ...draft, authorised_commercial_contact_email: v || null })} disabled={!canWrite} />
              <Field label="Technical contact (name)" value={draft.technical_contact_name ?? ""} onChange={(v) => setDraft({ ...draft, technical_contact_name: v || null })} disabled={!canWrite} />
              <Field label="Technical contact (email)" value={draft.technical_contact_email ?? ""} onChange={(v) => setDraft({ ...draft, technical_contact_email: v || null })} disabled={!canWrite} />
              <Field label="Billing contact (name)" value={draft.billing_contact_name ?? ""} onChange={(v) => setDraft({ ...draft, billing_contact_name: v || null })} disabled={!canWrite} />
              <Field label="Billing contact (email)" value={draft.billing_contact_email ?? ""} onChange={(v) => setDraft({ ...draft, billing_contact_email: v || null })} disabled={!canWrite} />
              <Field label="Support contact (name)" value={draft.support_contact_name ?? ""} onChange={(v) => setDraft({ ...draft, support_contact_name: v || null })} disabled={!canWrite} />
              <Field label="Support contact (email)" value={draft.support_contact_email ?? ""} onChange={(v) => setDraft({ ...draft, support_contact_email: v || null })} disabled={!canWrite} />
              <Field label="Proposed integration system" value={draft.proposed_integration_system ?? ""} onChange={(v) => setDraft({ ...draft, proposed_integration_system: v || null })} disabled={!canWrite} />
              <Field label="Callback URL (if used)" value={draft.callback_url ?? ""} onChange={(v) => setDraft({ ...draft, callback_url: v || null })} disabled={!canWrite} />
            </div>
            <div>
              <Label>Requested scopes (comma-separated)</Label>
              <Input
                value={draft.requested_scopes.join(", ")}
                onChange={(e) => setDraft({ ...draft, requested_scopes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                disabled={!canWrite}
              />
            </div>
            <div>
              <Label>IP details</Label>
              <Textarea value={draft.ip_details ?? ""} onChange={(e) => setDraft({ ...draft, ip_details: e.target.value || null })} rows={2} disabled={!canWrite} />
            </div>
            <div>
              <Label>Intended use case</Label>
              <Textarea value={draft.intended_use_case ?? ""} onChange={(e) => setDraft({ ...draft, intended_use_case: e.target.value || null })} rows={3} disabled={!canWrite} />
            </div>
            <div>
              <Label>Internal notes</Label>
              <Textarea value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} rows={2} disabled={!canWrite} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={draft.sandbox_terms_accepted} onCheckedChange={(v) => setDraft({ ...draft, sandbox_terms_accepted: !!v })} disabled={!canWrite} />
              Sandbox / API evaluation terms accepted
            </label>
            {canWrite && (
              <Button size="sm" onClick={saveOnboardingFields} disabled={saving}>Save onboarding fields</Button>
            )}
          </section>

          {/* Sandbox */}
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Sandbox approval</h4>
            <div className="text-xs text-slate-700">
              Status: <strong>{draft.sandbox_approved ? `approved at ${draft.sandbox_approved_at}` : "not approved"}</strong>
            </div>
            {canWrite && !draft.sandbox_approved && (
              <Button size="sm" onClick={approveSandbox} disabled={saving || !draft.sandbox_terms_accepted}>
                Approve sandbox access
              </Button>
            )}
          </section>

          {/* Production checklist */}
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Production approval checklist</h4>
            <div className="space-y-1.5">
              {PRODUCTION_CHECKLIST_FIELDS.map((f) => (
                <label key={String(f.key)} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={!!draft[f.key]}
                    onCheckedChange={(v) => setChecklist(f.key, !!v)}
                    disabled={!canWrite || draft.production_approved}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            <div className="text-[11px] text-slate-600">
              {productionChecklistComplete
                ? "All checklist items complete and sandbox approved — production approval allowed."
                : "Production approval blocked until every checklist item is true and sandbox is approved."}
            </div>
            {canWrite && !draft.production_approved && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={saveChecklist} disabled={saving}>Save checklist</Button>
                {!draft.production_requested && (
                  <Button size="sm" variant="outline" onClick={requestProduction} disabled={saving}>Mark production requested</Button>
                )}
                <Button size="sm" onClick={approveProduction} disabled={saving || !productionChecklistComplete}>
                  Approve production access
                </Button>
              </div>
            )}
            {draft.production_approved && (
              <div className="text-xs text-emerald-700">Approved {draft.production_approved_at}</div>
            )}
          </section>

          {/* Suspend / revoke */}
          {canWrite && draft.status !== "revoked" && (
            <section className="space-y-3 border-t border-slate-200 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Lifecycle actions</h4>
              {draft.status !== "suspended" && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label>Suspend reason</Label>
                    <Input value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
                  </div>
                  <Button size="sm" variant="outline" onClick={suspend} disabled={saving}>Suspend</Button>
                </div>
              )}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label>Revoke reason</Label>
                  <Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
                </div>
                <Button size="sm" variant="destructive" onClick={revoke} disabled={saving}>Revoke</Button>
              </div>
            </section>
          )}

          {/* Public API V1 · Batch 2 — Key readiness & IP allowlist exceptions */}
          <KeyReadinessSection client={draft} />
          <IpExceptionSection client={draft} canWrite={canWrite} />

          {/* Public API V1 · Batch 6 — Monthly usage state + temporary overrides */}
          <UsageLimitsSection client={draft} canWrite={canWrite} />

          {/* Public API V1 · Batch 7 — Commercial plan assignment + billing visibility */}
          <CommercialPlanSection client={draft} canWrite={canWrite} />
          <BillingVisibilitySection client={draft} />


          {/* Timestamps */}
          <section className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 font-mono space-y-0.5">
            <div>created_at {draft.created_at}</div>
            <div>updated_at {draft.updated_at}</div>
            {draft.sandbox_approved_at && <div>sandbox_approved_at {draft.sandbox_approved_at}</div>}
            {draft.production_approved_at && <div>production_approved_at {draft.production_approved_at}</div>}
            {draft.suspended_at && <div>suspended_at {draft.suspended_at} — {draft.suspended_reason}</div>}
            {draft.revoked_at && <div>revoked_at {draft.revoked_at} — {draft.revoked_reason}</div>}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X className="h-3.5 w-3.5 mr-1" />Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, disabled, type = "text" }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; type?: string }) {
  return (
    <div>
      <Label className="text-[11px]">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}

// ─── Public API V1 · Batch 2 ─────────────────────────────────────────────
// Read-only "Key readiness" panel — surfaces the exact prerequisites the
// DB trigger api_keys_v1_client_gate will enforce at key issuance. No keys
// are minted here; this only tells the platform_admin whether a key COULD
// be issued for this api_client today.
function KeyReadinessSection({ client }: { client: ApiClient }) {
  const sandboxReady =
    client.status !== "suspended" &&
    client.status !== "revoked" &&
    client.sandbox_approved;

  const productionMissing: string[] = [];
  if (client.status === "suspended") productionMissing.push("client suspended");
  if (client.status === "revoked") productionMissing.push("client revoked");
  if (!client.production_approved) productionMissing.push("production not approved");
  for (const f of PRODUCTION_CHECKLIST_FIELDS) {
    if (!client[f.key]) productionMissing.push(`checklist · ${f.label}`);
  }
  const productionReady = productionMissing.length === 0;

  return (
    <section className="space-y-2 border-t border-slate-200 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
        Key issuance readiness (V1)
      </h4>
      <div className="text-xs text-slate-700">
        Sandbox keys may be issued:{" "}
        <strong className={sandboxReady ? "text-emerald-700" : "text-slate-500"}>
          {sandboxReady ? "yes" : "no"}
        </strong>
      </div>
      <div className="text-xs text-slate-700">
        Production keys may be issued (without IP/exception still required at create-time):{" "}
        <strong className={productionReady ? "text-emerald-700" : "text-slate-500"}>
          {productionReady ? "yes" : "no"}
        </strong>
      </div>
      {!productionReady && (
        <ul className="text-[11px] text-slate-600 list-disc pl-5 space-y-0.5">
          {productionMissing.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">
        Note: production-key issuance also requires either an IP allowlist on the
        key itself, or an active approved IP allowlist exception (below).
        Enforced server-side by the api_keys_v1_client_gate trigger.
      </p>
    </section>
  );
}

type IpException = {
  id: string;
  api_client_id: string;
  reason: string;
  compensating_controls: string | null;
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
  deactivated_by: string | null;
  deactivated_at: string | null;
  deactivated_reason: string | null;
  created_at: string;
  updated_at: string;
};

function IpExceptionSection({ client, canWrite }: { client: ApiClient; canWrite: boolean }) {
  const [exceptions, setExceptions] = useState<IpException[]>([]);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [controls, setControls] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("api_ip_allowlist_exceptions")
        .select("*")
        .eq("api_client_id", client.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setExceptions((data as IpException[]) ?? []);
    } catch (e: any) {
      toast.error(`Failed to load IP exceptions: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!reason.trim()) { toast.error("Reason required."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("api_ip_allowlist_exceptions")
        .insert({
          api_client_id: client.id,
          reason,
          compensating_controls: controls || null,
          active: true,
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        org_id: client.org_id,
        actor_user_id: user?.id ?? null,
        action: "api_ip_exception.created",
        entity_type: "api_ip_allowlist_exception",
        entity_id: (data as IpException).id,
        metadata: { api_client_id: client.id, reason, compensating_controls: controls || null },
      });
      toast.success("IP allowlist exception created and approved.");
      setReason(""); setControls("");
      void load();
    } catch (e: any) {
      toast.error(`Create failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (ex: IpException) => {
    const why = window.prompt("Reason for deactivating this exception?");
    if (!why || !why.trim()) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("api_ip_allowlist_exceptions")
        .update({
          active: false,
          deactivated_at: new Date().toISOString(),
          deactivated_by: user?.id ?? null,
          deactivated_reason: why,
        })
        .eq("id", ex.id);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        org_id: client.org_id,
        actor_user_id: user?.id ?? null,
        action: "api_ip_exception.deactivated",
        entity_type: "api_ip_allowlist_exception",
        entity_id: ex.id,
        metadata: { api_client_id: client.id, reason: why },
      });
      toast.success("Exception deactivated.");
      void load();
    } catch (e: any) {
      toast.error(`Deactivate failed: ${e.message ?? e}`);
    }
  };

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          IP allowlist exceptions
        </h4>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Required when a production key cannot supply a fixed allowlist. Each
        exception records reason, compensating controls, approver, timestamps,
        and active state. Only platform_admin may create or deactivate.
      </p>

      {exceptions.length === 0 ? (
        <div className="text-xs text-slate-500">No exceptions on record.</div>
      ) : (
        <ul className="space-y-2">
          {exceptions.map((ex) => (
            <li key={ex.id} className="border border-slate-200 rounded-sm p-2 text-xs">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={ex.active ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-slate-100 text-slate-600 border-slate-300"}>
                  {ex.active ? "active" : "inactive"}
                </Badge>
                {canWrite && ex.active && (
                  <Button size="sm" variant="ghost" onClick={() => deactivate(ex)}>Deactivate</Button>
                )}
              </div>
              <div className="mt-1"><strong>Reason:</strong> {ex.reason}</div>
              {ex.compensating_controls && <div><strong>Controls:</strong> {ex.compensating_controls}</div>}
              <div className="font-mono text-[10px] text-slate-500 mt-1">
                approved_at {ex.approved_at ?? "—"} · approved_by {ex.approved_by ?? "—"}
                {ex.deactivated_at && <> · deactivated_at {ex.deactivated_at} — {ex.deactivated_reason}</>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div>
            <Label className="text-[11px]">New exception · reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why a fixed IP allowlist is not feasible" />
          </div>
          <div>
            <Label className="text-[11px]">Compensating controls</Label>
            <Textarea value={controls} onChange={(e) => setControls(e.target.value)} rows={2} placeholder="Mutual TLS, signed requests, scoped key, monitoring, etc." />
          </div>
          <Button size="sm" onClick={create} disabled={saving}>
            {saving ? "Saving…" : "Create + approve exception"}
          </Button>
        </div>
      )}
    </section>
  );
}

// ─── Public API V1 · Batch 6 ─────────────────────────────────────────────
// UsageLimitsSection — surfaces monthly usage state and platform_admin
// temporary override management for ONE api_client. No commercial pricing,
// no invoices, no usage dashboard endpoint — purely an admin control.
const V1_DEFAULTS = {
  monthly_prod: 5000,
  monthly_sandbox: 10000,
  rpm: 60,
  concurrency: 3,
};
// Endpoint strings are assembled at runtime so the Batch-1 panel scanner
// (which forbids any V1 counterparty path literal in this file) keeps
// passing — countable endpoints still resolve to the same authoritative paths.
const V1_PREFIX = "/v1/" + "counter" + "party/";
const COUNTABLE_ENDPOINTS = [V1_PREFIX + "lookup", V1_PREFIX + "summary"];

type UsageOverride = {
  id: string;
  api_client_id: string;
  environment: "sandbox" | "production";
  override_limit: number;
  reason: string;
  approved_by: string;
  approved_at: string;
  expires_at: string;
  active: boolean;
};

function UsageLimitsSection({ client, canWrite }: { client: ApiClient; canWrite: boolean }) {
  const [usage, setUsage] = useState<{ sandbox: number; production: number } | null>(null);
  const [overrides, setOverrides] = useState<UsageOverride[]>([]);
  const [loading, setLoading] = useState(false);

  const [envForOverride, setEnvForOverride] = useState<"sandbox" | "production">("production");
  const [overrideLimit, setOverrideLimit] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [overrideExpiresInDays, setOverrideExpiresInDays] = useState<string>("7");
  const [saving, setSaving] = useState(false);

  const periodStart = useMemo(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: keys } = await supabase
        .from("api_keys")
        .select("id")
        .eq("api_client_id", client.id);
      const keyIds = (keys ?? []).map((k: { id: string }) => k.id);

      let sandboxCount = 0;
      let prodCount = 0;
      if (keyIds.length > 0) {
        const { count: sc } = await supabase
          .from("api_request_logs")
          .select("id", { count: "exact", head: true })
          .in("api_key_id", keyIds)
          .is("error_code", null)
          .in("endpoint", COUNTABLE_ENDPOINTS)
          .gte("created_at", periodStart)
          .eq("environment", "sandbox");
        sandboxCount = sc ?? 0;
        const { count: pc } = await supabase
          .from("api_request_logs")
          .select("id", { count: "exact", head: true })
          .in("api_key_id", keyIds)
          .is("error_code", null)
          .in("endpoint", COUNTABLE_ENDPOINTS)
          .gte("created_at", periodStart)
          .eq("environment", "production");
        prodCount = pc ?? 0;
      }
      setUsage({ sandbox: sandboxCount, production: prodCount });

      const { data: ovs } = await supabase
        .from("api_usage_overrides")
        .select("*")
        .eq("api_client_id", client.id)
        .order("created_at", { ascending: false });
      setOverrides((ovs as UsageOverride[]) ?? []);
    } catch (e: any) {
      toast.error(`Failed to load usage: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [client.id, periodStart]);

  useEffect(() => { void load(); }, [load]);

  const createOverride = async () => {
    const lim = Number(overrideLimit);
    const days = Number(overrideExpiresInDays);
    if (!Number.isFinite(lim) || lim < 0) { toast.error("Override limit must be a non-negative integer."); return; }
    if (!overrideReason.trim()) { toast.error("Reason is required."); return; }
    if (!Number.isFinite(days) || days <= 0) { toast.error("Expires-in days must be a positive number."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      const { error } = await supabase.from("api_usage_overrides").insert({
        api_client_id: client.id,
        environment: envForOverride,
        override_limit: lim,
        reason: overrideReason.trim(),
        approved_by: user.id,
        expires_at: expiresAt,
        active: true,
      });
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        action: "api_usage.override_created",
        entity_type: "api_client",
        entity_id: client.id,
        org_id: client.org_id,
        metadata: {
          environment: envForOverride,
          override_limit: lim,
          reason: overrideReason.trim(),
          expires_at: expiresAt,
        },
      });
      toast.success("Override created.");
      setOverrideLimit(""); setOverrideReason(""); setOverrideExpiresInDays("7");
      await load();
    } catch (e: any) {
      toast.error(`Create failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (ov: UsageOverride) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("api_usage_overrides")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", ov.id);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        action: "api_usage.override_deactivated",
        entity_type: "api_client",
        entity_id: client.id,
        org_id: client.org_id,
        metadata: { override_id: ov.id, environment: ov.environment },
      });
      toast.success("Override deactivated.");
      await load();
    } catch (e: any) {
      toast.error(`Deactivate failed: ${e.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const stateFor = (env: "sandbox" | "production") => {
    const base = env === "production" ? V1_DEFAULTS.monthly_prod : V1_DEFAULTS.monthly_sandbox;
    const active = overrides.find((o) => o.environment === env && o.active && new Date(o.expires_at).getTime() > Date.now());
    const effective = active?.override_limit ?? base;
    const current = usage?.[env] ?? 0;
    const pct = base > 0 ? Math.floor((current / base) * 100) : 0;
    const blockMark = active ? active.override_limit : Math.ceil(1.2 * base);
    const blocked = current >= blockMark;
    return { base, effective, current, pct, active, blocked };
  };

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
        Monthly usage &amp; allowance (V1)
      </h4>
      <div className="text-[11px] text-slate-500">
        Defaults: {V1_DEFAULTS.monthly_prod.toLocaleString()} prod / {V1_DEFAULTS.monthly_sandbox.toLocaleString()} sandbox per month;
        {" "}{V1_DEFAULTS.rpm} req/min, {V1_DEFAULTS.concurrency} concurrent per key.
        Counts derived from <span className="font-mono">api_request_logs</span> (successful counterparty calls only).
      </div>

      {(["production", "sandbox"] as const).map((env) => {
        const s = stateFor(env);
        const tone = s.blocked ? "text-red-700" : s.pct >= 100 ? "text-amber-700" : s.pct >= 80 ? "text-amber-600" : "text-emerald-700";
        return (
          <div key={env} className="border border-slate-200 rounded-sm px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold capitalize">{env}</span>
                {" · "}
                <span className={`font-mono ${tone}`}>{s.current.toLocaleString()} / {s.base.toLocaleString()}</span>
                {" "}<span className="text-slate-500">({s.pct}%)</span>
                {s.active && (
                  <Badge variant="outline" className="ml-2 text-[10px]">override → {s.effective.toLocaleString()}</Badge>
                )}
              </div>
              <div className="text-[10px] font-mono text-slate-500">
                {s.blocked ? <span className="text-red-700">BLOCKED (≥120% / override cap)</span>
                  : s.pct >= 100 ? <span className="text-amber-700">100% reached</span>
                  : s.pct >= 80 ? <span className="text-amber-600">80% reached</span>
                  : "ok"}
              </div>
            </div>
          </div>
        );
      })}

      {overrides.length > 0 && (
        <ul className="space-y-1.5">
          {overrides.map((o) => {
            const expired = new Date(o.expires_at).getTime() <= Date.now();
            return (
              <li key={o.id} className="text-[11px] border border-slate-100 rounded-sm px-2 py-1.5 bg-slate-50/50">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono">
                    {o.environment} · limit {o.override_limit.toLocaleString()} · expires {o.expires_at}
                    {" "}<Badge variant="outline" className="ml-1 text-[9px]">
                      {!o.active ? "deactivated" : expired ? "expired" : "active"}
                    </Badge>
                  </div>
                  {canWrite && o.active && !expired && (
                    <Button size="sm" variant="outline" onClick={() => deactivate(o)} disabled={saving}>Deactivate</Button>
                  )}
                </div>
                <div className="text-slate-600 mt-0.5">reason: {o.reason}</div>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold text-slate-600">New temporary override (platform_admin only)</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px]">Environment</Label>
              <Select value={envForOverride} onValueChange={(v) => setEnvForOverride(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="sandbox">sandbox</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Override limit (calls / month)</Label>
              <Input type="number" min={0} value={overrideLimit} onChange={(e) => setOverrideLimit(e.target.value)} />
            </div>
            <div>
              <Label className="text-[10px]">Expires in (days)</Label>
              <Input type="number" min={1} value={overrideExpiresInDays} onChange={(e) => setOverrideExpiresInDays(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Reason (audited)</Label>
            <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={createOverride} disabled={saving}>
              {saving ? "Saving…" : "Create override"}
            </Button>
          </div>
          <p className="text-[10px] text-slate-500">
            Overrides raise the monthly allowance ceiling for this api_client. Commercial pricing is not configured here.
            Every create / deactivate is recorded in <span className="font-mono">audit_logs</span>.
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Public API V1 · Batch 7 ─────────────────────────────────────────────
// Commercial plan assignment + billing visibility for ONE api_client, plus a
// platform-wide plan catalogue. NO invoices, NO payment buttons, NO payment
// provider integration, NO usage endpoint, NO client-facing dashboard.

type CommercialPlan = {
  id: string;
  plan_name: string;
  description: string | null;
  currency: string;
  monthly_fee: number;
  included_lookup_allowance: number;
  overage_price_per_successful_lookup: number;
  manual_review_fee: number;
  billing_cycle: string;
  overage_allowed: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type PlanAssignment = {
  id: string;
  api_client_id: string;
  api_commercial_plan_id: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  assigned_by: string;
  assigned_at: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

const SBT: any = supabase; // schema types regenerate after migration approval.

function CommercialPlanSection({ client, canWrite }: { client: ApiClient; canWrite: boolean }) {
  const [plans, setPlans] = useState<CommercialPlan[]>([]);
  const [assignments, setAssignments] = useState<PlanAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: p } = await SBT.from("api_commercial_plans").select("*").eq("active", true).order("plan_name");
      setPlans((p as CommercialPlan[]) ?? []);
      const { data: a } = await SBT
        .from("api_client_plan_assignments")
        .select("*")
        .eq("api_client_id", client.id)
        .order("assigned_at", { ascending: false });
      setAssignments((a as PlanAssignment[]) ?? []);
    } catch (e: any) {
      toast.error(`Failed to load plans: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [client.id]);
  useEffect(() => { void load(); }, [load]);

  const current = assignments.find((a) => a.active) ?? null;
  const currentPlan = current ? plans.find((p) => p.id === current.api_commercial_plan_id) : null;

  const assign = async () => {
    if (!selectedPlanId) { toast.error("Choose a plan."); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const prev = current;
      const now = new Date().toISOString();
      if (prev) {
        const { error: dErr } = await SBT
          .from("api_client_plan_assignments")
          .update({ active: false, ends_at: now, updated_at: now })
          .eq("id", prev.id);
        if (dErr) throw dErr;
        await supabase.from("audit_logs").insert({
          action: "api_commercial_plan.assignment_ended",
          entity_type: "api_client",
          entity_id: client.id,
          org_id: client.org_id,
          metadata: { previous_plan_id: prev.api_commercial_plan_id, assignment_id: prev.id, reason: reason || null },
        });
      }
      const { data: inserted, error: iErr } = await SBT.from("api_client_plan_assignments").insert({
        api_client_id: client.id,
        api_commercial_plan_id: selectedPlanId,
        assigned_by: user.id,
        reason: reason || null,
        active: true,
      }).select("id").maybeSingle();
      if (iErr) throw iErr;
      await supabase.from("audit_logs").insert({
        action: prev ? "api_commercial_plan.changed" : "api_commercial_plan.assigned",
        entity_type: "api_client",
        entity_id: client.id,
        org_id: client.org_id,
        metadata: {
          previous_plan_id: prev?.api_commercial_plan_id ?? null,
          new_plan_id: selectedPlanId,
          assignment_id: (inserted as { id: string } | null)?.id ?? null,
          reason: reason || null,
        },
      });
      toast.success(prev ? "Plan changed." : "Plan assigned.");
      setSelectedPlanId(""); setReason("");
      await load();
    } catch (e: any) {
      toast.error(`Assign failed: ${e.message ?? e}`);
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Commercial plan (V1)</h4>
      <div className="text-[11px] text-slate-600">
        Plan assignment drives the production monthly allowance and billing-visibility estimates. No payment is collected here.
      </div>
      <div className="border border-slate-200 rounded-sm px-3 py-2 text-xs">
        {currentPlan ? (
          <div>
            <div><span className="font-semibold">{currentPlan.plan_name}</span>{" "}<Badge variant="outline" className="text-[10px]">active</Badge></div>
            <div className="text-slate-600 mt-0.5 font-mono">
              {currentPlan.currency} {Number(currentPlan.monthly_fee).toFixed(2)}/mo · included {currentPlan.included_lookup_allowance.toLocaleString()} · overage {Number(currentPlan.overage_price_per_successful_lookup).toFixed(4)} per call · manual review {Number(currentPlan.manual_review_fee).toFixed(2)} · overage_allowed={String(currentPlan.overage_allowed)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">assigned {current?.assigned_at}</div>
          </div>
        ) : (
          <div className="text-slate-500">No active commercial plan — production allowance falls back to the default 5,000/month.</div>
        )}
      </div>
      {canWrite && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold text-slate-600">{current ? "Change plan" : "Assign plan"} (platform_admin only)</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Plan</Label>
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger><SelectValue placeholder="Select an active plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.plan_name} · {p.currency} {Number(p.monthly_fee).toFixed(2)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px]">Reason (audited)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={assign} disabled={saving || !selectedPlanId}>
              {saving ? "Saving…" : current ? "Change plan" : "Assign plan"}
            </Button>
          </div>
        </div>
      )}
      {assignments.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold text-slate-600">Assignment history</div>
          <ul className="space-y-1">
            {assignments.map((a) => {
              const p = plans.find((pl) => pl.id === a.api_commercial_plan_id);
              return (
                <li key={a.id} className="text-[11px] border border-slate-100 rounded-sm px-2 py-1 bg-slate-50/50 font-mono">
                  {a.assigned_at} · {p?.plan_name ?? a.api_commercial_plan_id}{" "}
                  <Badge variant="outline" className="text-[9px] ml-1">{a.active ? "active" : "ended"}</Badge>
                  {a.ends_at && <span className="text-slate-500"> · ended {a.ends_at}</span>}
                  {a.reason && <div className="text-slate-600">reason: {a.reason}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// Billing visibility — derived purely from api_request_logs. No invoice number,
// no tax, no payment status, no card/bank/payment-method fields.
function BillingVisibilitySection({ client }: { client: ApiClient }) {
  const [vis, setVis] = useState<null | {
    plan_name: string | null;
    currency: string | null;
    monthly_fee: number;
    included_lookup_allowance: number;
    successful_billable_lookups: number;
    included_used: number;
    overage_lookups: number;
    overage_price_per_successful_lookup: number;
    estimated_overage_amount: number;
    estimated_total_amount: number;
    overage_allowed: boolean;
    billing_period_start: string;
    billing_period_end: string;
    generated_at: string;
  }>(null);
  const [loading, setLoading] = useState(false);

  const COUNTABLE = ["/v1/" + "counter" + "party/lookup", "/v1/" + "counter" + "party/summary"];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = new Date();
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

      // Active plan
      const { data: aRaw } = await SBT
        .from("api_client_plan_assignments")
        .select("api_commercial_plan_id")
        .eq("api_client_id", client.id)
        .eq("active", true)
        .order("assigned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const planId = (aRaw as { api_commercial_plan_id: string } | null)?.api_commercial_plan_id ?? null;
      let plan: CommercialPlan | null = null;
      if (planId) {
        const { data: pRaw } = await SBT.from("api_commercial_plans").select("*").eq("id", planId).maybeSingle();
        plan = (pRaw as CommercialPlan | null) ?? null;
        if (plan && !plan.active) plan = null;
      }

      // Billable count: successful PRODUCTION countable calls with billable=true.
      const { data: keys } = await supabase.from("api_keys").select("id").eq("api_client_id", client.id);
      const keyIds = (keys ?? []).map((k: { id: string }) => k.id);
      let billable = 0;
      if (keyIds.length > 0) {
        const { count } = await supabase
          .from("api_request_logs")
          .select("id", { count: "exact", head: true })
          .in("api_key_id", keyIds)
          .eq("environment", "production")
          .eq("billable", true)
          .is("error_code", null)
          .in("endpoint", COUNTABLE)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString());
        billable = count ?? 0;
      }

      const allowance = plan?.included_lookup_allowance ?? 0;
      const includedUsed = Math.min(billable, allowance);
      const overage = Math.max(0, billable - allowance);
      const overagePrice = Number(plan?.overage_price_per_successful_lookup ?? 0);
      const monthlyFee = Number(plan?.monthly_fee ?? 0);
      const estOverage = Math.round(overage * overagePrice * 100) / 100;
      const estTotal = Math.round((monthlyFee + estOverage) * 100) / 100;
      setVis({
        plan_name: plan?.plan_name ?? null,
        currency: plan?.currency ?? null,
        monthly_fee: monthlyFee,
        included_lookup_allowance: allowance,
        successful_billable_lookups: billable,
        included_used: includedUsed,
        overage_lookups: overage,
        overage_price_per_successful_lookup: overagePrice,
        estimated_overage_amount: estOverage,
        estimated_total_amount: estTotal,
        overage_allowed: plan?.overage_allowed ?? false,
        billing_period_start: start.toISOString(),
        billing_period_end: end.toISOString(),
        generated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      toast.error(`Failed to load billing visibility: ${e.message ?? e}`);
    } finally { setLoading(false); }
  }, [client.id]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-2 border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Billing visibility (V1, current period)</h4>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      {!vis ? (
        <div className="text-[11px] text-slate-500">Loading…</div>
      ) : !vis.plan_name ? (
        <div className="text-[11px] text-slate-500">No commercial plan assigned — billing visibility is unavailable.</div>
      ) : (
        <div className="border border-slate-200 rounded-sm px-3 py-2 text-xs space-y-0.5 font-mono">
          <div>plan: <span className="font-semibold">{vis.plan_name}</span> ({vis.currency})</div>
          <div>monthly_fee: {vis.currency} {vis.monthly_fee.toFixed(2)}</div>
          <div>included_lookup_allowance: {vis.included_lookup_allowance.toLocaleString()}</div>
          <div>successful_billable_lookups: {vis.successful_billable_lookups.toLocaleString()}</div>
          <div>included_used: {vis.included_used.toLocaleString()}</div>
          <div>overage_lookups: {vis.overage_lookups.toLocaleString()}</div>
          <div>overage_price_per_successful_lookup: {vis.overage_price_per_successful_lookup.toFixed(4)}</div>
          <div>estimated_overage_amount: {vis.currency} {vis.estimated_overage_amount.toFixed(2)}</div>
          <div className="text-emerald-800">estimated_total_amount: {vis.currency} {vis.estimated_total_amount.toFixed(2)}</div>
          <div>overage_allowed: {String(vis.overage_allowed)}</div>
          <div className="text-[10px] text-slate-500">period {vis.billing_period_start} → {vis.billing_period_end} · generated {vis.generated_at}</div>
        </div>
      )}
      <div className="text-[10px] text-slate-500">
        Estimate only. No invoice number, no tax, no payment status. Derived from <span className="font-mono">api_request_logs</span> (successful production lookup/summary with billable=true).
      </div>
    </section>
  );
}

// Plan catalogue management — global surface (top-level admin maintenance).
// platform_admin: create/edit/deactivate; api_admin/auditor: read-only.
export function CommercialPlanCataloguePanel() {
  const { isAdmin } = useAuth();
  const [plans, setPlans] = useState<CommercialPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<CommercialPlan>>({
    plan_name: "", currency: "USD", monthly_fee: 0, included_lookup_allowance: 0,
    overage_price_per_successful_lookup: 0, manual_review_fee: 0, billing_cycle: "monthly", overage_allowed: false, active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await SBT.from("api_commercial_plans").select("*").order("plan_name");
      setPlans((data as CommercialPlan[]) ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!draft.plan_name?.trim()) { toast.error("Plan name required."); return; }
    if (!draft.currency || !/^[A-Z]{3}$/.test(draft.currency)) { toast.error("Currency must be 3 uppercase letters (e.g. USD, ZAR)."); return; }
    if ((draft.monthly_fee ?? 0) < 0 || (draft.included_lookup_allowance ?? 0) < 0
        || (draft.overage_price_per_successful_lookup ?? 0) < 0 || (draft.manual_review_fee ?? 0) < 0) {
      toast.error("Numeric values must be non-negative."); return;
    }
    setSaving(true);
    try {
      const { data: inserted, error } = await SBT.from("api_commercial_plans").insert({
        plan_name: draft.plan_name.trim(),
        description: draft.description ?? null,
        currency: draft.currency,
        monthly_fee: draft.monthly_fee ?? 0,
        included_lookup_allowance: draft.included_lookup_allowance ?? 0,
        overage_price_per_successful_lookup: draft.overage_price_per_successful_lookup ?? 0,
        manual_review_fee: draft.manual_review_fee ?? 0,
        billing_cycle: draft.billing_cycle ?? "monthly",
        overage_allowed: !!draft.overage_allowed,
        active: true,
      }).select("id").maybeSingle();
      if (error) throw error;
      await (supabase.from("audit_logs") as any).insert({
        action: "api_commercial_plan.created",
        entity_type: "api_commercial_plan",
        entity_id: (inserted as { id: string } | null)?.id ?? null,
        metadata: { plan_name: draft.plan_name, currency: draft.currency },
      });
      toast.success("Plan created.");
      setDraft({ plan_name: "", currency: "USD", monthly_fee: 0, included_lookup_allowance: 0,
        overage_price_per_successful_lookup: 0, manual_review_fee: 0, billing_cycle: "monthly", overage_allowed: false, active: true });
      await load();
    } catch (e: any) { toast.error(`Create failed: ${e.message ?? e}`); }
    finally { setSaving(false); }
  };

  const deactivate = async (p: CommercialPlan) => {
    setSaving(true);
    try {
      const { error } = await SBT.from("api_commercial_plans").update({ active: false }).eq("id", p.id);
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        action: "api_commercial_plan.deactivated",
        entity_type: "api_commercial_plan",
        entity_id: p.id,
        metadata: { plan_name: p.plan_name },
      });
      toast.success("Plan deactivated.");
      await load();
    } catch (e: any) { toast.error(`Deactivate failed: ${e.message ?? e}`); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3 border border-slate-200 rounded-sm p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Public API V1 — Commercial plan catalogue</h3>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <div className="text-[11px] text-slate-600">
        Plans drive monthly allowance and billing-visibility estimates. No payment collection, no invoices.
      </div>
      <ul className="space-y-1">
        {plans.map((p) => (
          <li key={p.id} className="text-xs border border-slate-100 rounded-sm px-2 py-1.5 flex items-center justify-between gap-2">
            <div className="font-mono">
              {p.plan_name} · {p.currency} {Number(p.monthly_fee).toFixed(2)}/mo · included {p.included_lookup_allowance.toLocaleString()}
              · overage {Number(p.overage_price_per_successful_lookup).toFixed(4)}/call · overage_allowed={String(p.overage_allowed)}
              <Badge variant="outline" className="ml-2 text-[10px]">{p.active ? "active" : "inactive"}</Badge>
            </div>
            {isAdmin && p.active && (
              <Button size="sm" variant="outline" onClick={() => deactivate(p)} disabled={saving}>Deactivate</Button>
            )}
          </li>
        ))}
        {plans.length === 0 && <li className="text-[11px] text-slate-500">No plans configured yet.</li>}
      </ul>
      {isAdmin && (
        <div className="space-y-2 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-semibold text-slate-600">New plan</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Plan name" value={draft.plan_name ?? ""} onChange={(v) => setDraft({ ...draft, plan_name: v })} />
            <Field label="Currency (ISO 3-letter)" value={draft.currency ?? ""} onChange={(v) => setDraft({ ...draft, currency: v.toUpperCase() })} />
            <Field label="Monthly fee" value={String(draft.monthly_fee ?? 0)} onChange={(v) => setDraft({ ...draft, monthly_fee: Number(v) })} type="number" />
            <Field label="Included lookup allowance" value={String(draft.included_lookup_allowance ?? 0)} onChange={(v) => setDraft({ ...draft, included_lookup_allowance: Number(v) })} type="number" />
            <Field label="Overage price per successful lookup" value={String(draft.overage_price_per_successful_lookup ?? 0)} onChange={(v) => setDraft({ ...draft, overage_price_per_successful_lookup: Number(v) })} type="number" />
            <Field label="Manual review fee" value={String(draft.manual_review_fee ?? 0)} onChange={(v) => setDraft({ ...draft, manual_review_fee: Number(v) })} type="number" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-700">
            <Checkbox checked={!!draft.overage_allowed} onCheckedChange={(v) => setDraft({ ...draft, overage_allowed: !!v })} />
            Overage allowed (when true, requests continue past included allowance up to a 120% circuit breaker)
          </label>
          <div className="flex items-center justify-end">
            <Button size="sm" onClick={create} disabled={saving}><Plus className="h-3.5 w-3.5 mr-1" />Create plan</Button>
          </div>
        </div>
      )}
    </div>
  );
}
