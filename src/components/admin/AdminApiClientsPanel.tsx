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
