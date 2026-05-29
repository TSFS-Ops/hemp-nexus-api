/**
 * Batch 4 — HQ Identity admin panel.
 *
 * Platform-admin only. Lists organisations with their SSO and SCIM
 * lifecycle posture, and lets an admin:
 *   - configure SSO metadata (calls org-sso-config PUT)
 *   - run a connection test (calls org-sso-test-connection)
 *   - change SCIM user state (calls org-scim-user-lifecycle)
 *
 * Claim-control:
 *   - The "SSO live" badge is ONLY rendered when ssoClaimAllowed() === true.
 *   - The phrase "SCIM live" is NEVER rendered — Batch 4 ships lifecycle
 *     structure only, no external SCIM HTTP endpoint exists yet.
 *   - "Enterprise ready", "Bank ready", "DFI ready" are not used.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShieldCheck, ShieldAlert, PlugZap } from "lucide-react";
import {
  ssoClaimAllowed,
  ssoStatusLabel,
  ssoStatusTone,
  SCIM_TRANSITIONS,
  isValidScimTransition,
  type SsoStatus,
  type ScimState,
} from "@/lib/identity/sso-claim";
import { IDENTITY_AUDIT_NAME_LIST } from "@/lib/identity/identity-audit";
import { parseEdgeError } from "@/lib/edge-error";

interface OrgRow {
  id: string;
  name: string | null;
  legal_name: string | null;
}

interface SsoConfigRow {
  id: string;
  org_id: string;
  provider: string;
  metadata_url: string | null;
  metadata_xml_ref: string | null;
  verified_domains: string[];
  entity_id: string | null;
  acs_url: string | null;
  certificate_status: string;
  failure_reason: string | null;
  status: SsoStatus;
  last_test_result: "pass" | "fail" | null;
  last_tested_at: string | null;
  supabase_sso_provider_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ScimRow {
  id: string;
  org_id: string;
  user_id: string;
  state: ScimState;
  source: string;
  external_id: string | null;
  last_state_change_at: string;
  last_state_change_reason: string | null;
  email?: string | null;
  full_name?: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

function statusToneClasses(tone: ReturnType<typeof ssoStatusTone>): string {
  switch (tone) {
    case "success":
      return "bg-emerald-100 text-emerald-900 border-emerald-300";
    case "warning":
      return "bg-amber-100 text-amber-900 border-amber-300";
    case "danger":
      return "bg-rose-100 text-rose-900 border-rose-300";
    default:
      return "bg-slate-100 text-slate-700 border-slate-300";
  }
}

function SsoStatusPill({ config }: { config: SsoConfigRow | null }) {
  const status: SsoStatus = (config?.status as SsoStatus) ?? "not_configured";
  const tone = ssoStatusTone(status);
  const label = ssoStatusLabel(status);
  const claimOk = ssoClaimAllowed(config);
  // Defence-in-depth: even if the DB row says 'live', refuse to render the
  // "SSO live" label unless ssoClaimAllowed() is true.
  const safeLabel = status === "live" && !claimOk ? "Live (claim blocked)" : label;
  return (
    <Badge variant="outline" className={`gap-1 font-mono text-[10px] tracking-wide ${statusToneClasses(tone)}`}>
      {safeLabel}
    </Badge>
  );
}

function ScimStateBadge({ state }: { state: ScimState }) {
  const cls: Record<ScimState, string> = {
    invited: "bg-amber-50 text-amber-900 border-amber-200",
    active: "bg-emerald-50 text-emerald-900 border-emerald-200",
    suspended: "bg-rose-50 text-rose-900 border-rose-200",
    deprovisioned: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return (
    <Badge variant="outline" className={`gap-1 font-mono text-[10px] ${cls[state]}`}>
      {state}
    </Badge>
  );
}

export function AdminIdentityPanel() {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [configs, setConfigs] = useState<Record<string, SsoConfigRow | null>>({});
  const [scimCounts, setScimCounts] = useState<Record<string, Record<ScimState, number>>>({});
  const [loading, setLoading] = useState(false);
  const [drawerOrg, setDrawerOrg] = useState<OrgRow | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: orgRows, error: orgsErr }, { data: cfgRows }, { data: scimRows }] = await Promise.all([
        supabase
          .from("organizations")
          .select("id,name,legal_name")
          .order("name", { ascending: true })
          .limit(500),
        supabase.from("org_sso_configs").select("*").limit(1000),
        supabase
          .from("org_scim_user_states")
          .select("org_id,state")
          .limit(2000),
      ]);
      if (orgsErr) throw orgsErr;

      const cfgByOrg: Record<string, SsoConfigRow | null> = {};
      ((cfgRows ?? []) as unknown as SsoConfigRow[]).forEach((c) => {
        cfgByOrg[c.org_id] = c;
      });

      const counts: Record<string, Record<ScimState, number>> = {};
      ((scimRows ?? []) as { org_id: string; state: ScimState }[]).forEach((r) => {
        if (!counts[r.org_id]) {
          counts[r.org_id] = { invited: 0, active: 0, suspended: 0, deprovisioned: 0 };
        }
        counts[r.org_id][r.state] = (counts[r.org_id][r.state] ?? 0) + 1;
      });

      setOrgs((orgRows ?? []) as OrgRow[]);
      setConfigs(cfgByOrg);
      setScimCounts(counts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to load identity data", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Org-level SSO/SAML configuration and SCIM-style user lifecycle.
          {" "}
          <span className="font-mono">No custom SAML.</span> Live SSO is only flipped on
          per-org after a passing connection test against a Supabase native SAML
          provider. SCIM lifecycle structure only — no external SCIM HTTP endpoint
          exists in Batch 4.
        </p>
        <Button size="sm" variant="outline" onClick={() => void loadAll()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 mr-2 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-2" />}
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="font-mono text-[10px] tracking-wide uppercase text-muted-foreground">
              <th className="px-3 py-2">Organisation</th>
              <th className="px-3 py-2">SSO status</th>
              <th className="px-3 py-2">Verified domains</th>
              <th className="px-3 py-2">Last tested</th>
              <th className="px-3 py-2">Claim allowed</th>
              <th className="px-3 py-2">SCIM lifecycle</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">No organisations.</td></tr>
            )}
            {orgs.map((org) => {
              const cfg = configs[org.id] ?? null;
              const counts = scimCounts[org.id] ?? { invited: 0, active: 0, suspended: 0, deprovisioned: 0 };
              const claimOk = ssoClaimAllowed(cfg);
              return (
                <tr key={org.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium">{org.name ?? org.legal_name ?? "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{org.id}</div>
                  </td>
                  <td className="px-3 py-2"><SsoStatusPill config={cfg} /></td>
                  <td className="px-3 py-2">
                    {(cfg?.verified_domains ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span className="font-mono text-[11px]">
                        {(cfg!.verified_domains.slice(0, 3)).join(", ")}
                        {cfg!.verified_domains.length > 3 ? ` +${cfg!.verified_domains.length - 3}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {cfg?.last_tested_at ? new Date(cfg.last_tested_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {claimOk ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200 gap-1">
                        <ShieldCheck className="h-3 w-3" /> Yes
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 gap-1">
                        <ShieldAlert className="h-3 w-3" /> No
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    inv {counts.invited} · act {counts.active} · sus {counts.suspended} · dep {counts.deprovisioned}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setDrawerOrg(org)}>
                      Manage
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <OrgIdentityDrawer
        org={drawerOrg}
        onClose={() => setDrawerOrg(null)}
        onChanged={() => void loadAll()}
      />
    </div>
  );
}

function OrgIdentityDrawer({
  org,
  onClose,
  onChanged,
}: {
  org: OrgRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<SsoConfigRow | null>(null);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [scimRows, setScimRows] = useState<ScimRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [metadataUrl, setMetadataUrl] = useState("");
  const [metadataXmlRef, setMetadataXmlRef] = useState("");
  const [verifiedDomains, setVerifiedDomains] = useState("");
  const [entityId, setEntityId] = useState("");
  const [acsUrl, setAcsUrl] = useState("");
  const [providerId, setProviderId] = useState("");
  const [statusDraft, setStatusDraft] = useState<SsoStatus>("not_configured");

  const load = useCallback(async () => {
    if (!org) return;
    setBusy(true);
    try {
      const [{ data: cfgRow }, { data: auditRows }, { data: scimList }] = await Promise.all([
        supabase.from("org_sso_configs").select("*").eq("org_id", org.id).maybeSingle(),
        supabase
          .from("audit_logs")
          .select("id,action,actor_user_id,entity_id,metadata,created_at")
          .eq("org_id", org.id)
          .in("action", IDENTITY_AUDIT_NAME_LIST as unknown as string[])
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("org_scim_user_states")
          .select("*")
          .eq("org_id", org.id)
          .order("last_state_change_at", { ascending: false })
          .limit(200),
      ]);
      const c = (cfgRow as unknown as SsoConfigRow | null) ?? null;
      setCfg(c);
      setMetadataUrl(c?.metadata_url ?? "");
      setMetadataXmlRef(c?.metadata_xml_ref ?? "");
      setVerifiedDomains((c?.verified_domains ?? []).join(", "));
      setEntityId(c?.entity_id ?? "");
      setAcsUrl(c?.acs_url ?? "");
      setProviderId(c?.supabase_sso_provider_id ?? "");
      setStatusDraft((c?.status as SsoStatus) ?? "not_configured");
      setAudits((auditRows ?? []) as AuditRow[]);
      setScimRows((scimList ?? []) as unknown as ScimRow[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to load org identity", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, [org, toast]);

  useEffect(() => {
    if (org) void load();
  }, [org, load]);

  const saveMetadata = async () => {
    if (!org) return;
    if (statusDraft === ("live" as never) || statusDraft === ("failed" as never)) {
      toast({
        title: "Status cannot be promoted here",
        description: "Use Test Connection to promote to Live. Failed is set automatically when a test fails.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const domains = verifiedDomains
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      const { data, error } = await supabase.functions.invoke("org-sso-config", {
        method: "PUT",
        body: {
          org_id: org.id,
          metadata_url: metadataUrl || null,
          metadata_xml_ref: metadataXmlRef || null,
          verified_domains: domains,
          entity_id: entityId || null,
          acs_url: acsUrl || null,
          supabase_sso_provider_id: providerId || null,
          status: statusDraft,
        },
      });
      if (error) throw error;
      toast({ title: "Identity configuration saved" });
      onChanged();
      await load();
      void data;
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({ title: "Save failed", description: parsed.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    if (!org) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("org-sso-test-connection", {
        method: "POST",
        body: { org_id: org.id },
      });
      if (error) throw error;
      const ok = (data as { test?: { pass?: boolean } } | null)?.test?.pass === true;
      toast({
        title: ok ? "Connection test passed" : "Connection test failed",
        description: ok
          ? "Status promoted to Live."
          : "Status moved to Failed. Inspect failure reason and re-test after fixing.",
        variant: ok ? "default" : "destructive",
      });
      onChanged();
      await load();
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({ title: "Test failed", description: parsed.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!org} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {org && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                Identity · {org.name ?? org.legal_name ?? "—"}
                <SsoStatusPill config={cfg} />
              </SheetTitle>
              <SheetDescription className="font-mono text-[10px] text-muted-foreground">
                {org.id}
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="sso" className="mt-4">
              <TabsList>
                <TabsTrigger value="sso">SSO</TabsTrigger>
                <TabsTrigger value="users">User lifecycle</TabsTrigger>
                <TabsTrigger value="audit">Audit ({audits.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="sso" className="space-y-3 mt-4">
                <div>
                  <Label htmlFor="md_url">SAML metadata URL</Label>
                  <Input id="md_url" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} placeholder="https://idp.example.com/metadata.xml" />
                </div>
                <div>
                  <Label htmlFor="md_xml">Uploaded metadata XML reference</Label>
                  <Input id="md_xml" value={metadataXmlRef} onChange={(e) => setMetadataXmlRef(e.target.value)} placeholder="storage path or fingerprint" />
                </div>
                <div>
                  <Label htmlFor="domains">Verified domains (comma-separated)</Label>
                  <Textarea id="domains" value={verifiedDomains} onChange={(e) => setVerifiedDomains(e.target.value)} placeholder="example.com, corp.example.com" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ent">Entity ID</Label>
                    <Input id="ent" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="acs">ACS URL</Label>
                    <Input id="acs" value={acsUrl} onChange={(e) => setAcsUrl(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="prov">Supabase SSO provider id</Label>
                  <Input id="prov" value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="set after supabase--configure_saml_sso succeeds" />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={statusDraft} onValueChange={(v) => setStatusDraft(v as SsoStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_configured">Not configured</SelectItem>
                      <SelectItem value="pending_metadata">Pending metadata</SelectItem>
                      <SelectItem value="configured_not_connected">Configured — not connected</SelectItem>
                      <SelectItem value="disabled">Disabled</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Live and Failed are set only by Test Connection.
                  </p>
                </div>

                {cfg?.failure_reason && (
                  <div className="rounded-sm border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                    <div className="font-medium mb-1">Last failure</div>
                    <div className="font-mono text-[11px] break-all">{cfg.failure_reason}</div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={saveMetadata} disabled={busy}>Save configuration</Button>
                  <Button variant="outline" onClick={testConnection} disabled={busy || !providerId}>
                    <PlugZap className="h-3 w-3 mr-2" /> Test connection
                  </Button>
                </div>
                {!providerId && (
                  <p className="text-[11px] text-muted-foreground">
                    Test Connection is disabled until a Supabase SSO provider id is recorded.
                    Wire it via <span className="font-mono">supabase--configure_saml_sso</span> once IdP metadata is provided.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="users" className="mt-4">
                <ScimLifecycleTable
                  orgId={org.id}
                  rows={scimRows}
                  onRefresh={load}
                />
              </TabsContent>

              <TabsContent value="audit" className="mt-4 space-y-2">
                {audits.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No identity audit events yet for this organisation.</p>
                ) : (
                  audits.map((a) => (
                    <div key={a.id} className="border border-border rounded-sm p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px]">{a.action}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                      {a.metadata && Object.keys(a.metadata).length > 0 && (
                        <pre className="mt-1 text-[10px] text-muted-foreground overflow-x-auto">
                          {JSON.stringify(a.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScimLifecycleTable({
  orgId,
  rows,
  onRefresh,
}: {
  orgId: string;
  rows: ScimRow[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [targetById, setTargetById] = useState<Record<string, ScimState | "">>({});

  const submit = async (row: ScimRow) => {
    const next = targetById[row.user_id];
    const reason = (reasonById[row.user_id] ?? "").trim();
    if (!next || !reason) {
      toast({ title: "Pick a new state and provide a reason", variant: "destructive" });
      return;
    }
    if (!isValidScimTransition(row.state, next as ScimState)) {
      toast({ title: "Invalid transition", description: `${row.state} → ${next} is not allowed.`, variant: "destructive" });
      return;
    }
    setBusyId(row.user_id);
    try {
      const { error } = await supabase.functions.invoke("org-scim-user-lifecycle", {
        method: "POST",
        body: { org_id: orgId, user_id: row.user_id, state: next, reason },
      });
      if (error) throw error;
      toast({ title: `User moved to ${next}` });
      setReasonById((m) => ({ ...m, [row.user_id]: "" }));
      setTargetById((m) => ({ ...m, [row.user_id]: "" }));
      onRefresh();
    } catch (e) {
      const parsed = await parseEdgeError(e);
      toast({ title: "Lifecycle change failed", description: parsed.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No user lifecycle rows yet. Records are created when an admin
          first transitions a user via this panel.
        </p>
      ) : (
        rows.map((r) => {
          const allowed = SCIM_TRANSITIONS[r.state] ?? [];
          return (
            <div key={r.id} className="border border-border rounded-sm p-3 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[11px]">{r.user_id}</div>
                <ScimStateBadge state={r.state} />
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                source: {r.source} · last change: {new Date(r.last_state_change_at).toLocaleString()}
                {r.last_state_change_reason ? ` · "${r.last_state_change_reason}"` : ""}
              </div>
              <div className="flex flex-wrap gap-2 items-end pt-1">
                <div>
                  <Label className="text-[10px]">New state</Label>
                  <Select
                    value={targetById[r.user_id] ?? ""}
                    onValueChange={(v) => setTargetById((m) => ({ ...m, [r.user_id]: v as ScimState }))}
                  >
                    <SelectTrigger className="w-[160px]"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {allowed.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-[10px]">Reason (audited)</Label>
                  <Input
                    value={reasonById[r.user_id] ?? ""}
                    onChange={(e) => setReasonById((m) => ({ ...m, [r.user_id]: e.target.value }))}
                    placeholder="why are you changing state?"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => void submit(r)}
                  disabled={busyId === r.user_id || allowed.length === 0}
                >
                  {busyId === r.user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
