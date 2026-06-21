/**
 * Batch 15B — Institutional API Admin: Client detail.
 *
 * Safe presentation of a single client with separated sandbox/production key
 * panels, scope/country/use-case controls, production approval acknowledgement,
 * and audit trail. Full API keys are never rendered after creation.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  REGISTRY_API_LIFECYCLE_LABELS,
  REGISTRY_API_MODE_LABELS,
  REGISTRY_API_UI_COPY,
  buildScopeOptions,
  isClientLifecycleActive,
  isClientLifecycleBlocked,
  isProductionApprovalReady,
  lifecycleTone,
  safeKeyReference,
  summariseList,
  type ProductionApprovalChecklist,
} from "@/lib/registry-api-hardening-ui";

interface ClientDetail {
  id: string;
  client_code: string;
  display_name: string;
  client_type: string | null;
  status: string;
  lifecycle_status: string | null;
  mode: string | null;
  allowed_countries: string[] | null;
  allowed_use_cases: string[] | null;
  rate_limit_profile: string | null;
  scopes: string[] | null;
  production_acknowledged_at: string | null;
  review_due_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  admin_notes: string | null;
  created_at: string;
}

interface KeyRow {
  id: string;
  client_id: string;
  key_type: string | null;
  status: string;
  label: string | null;
  last_four: string | null;
  key_prefix: string | null;
  created_at: string;
  last_rotated_at: string | null;
  rotation_reason: string | null;
}

interface ScopeRow {
  scope_key: string;
}
interface CountryRow {
  country_code: string;
}
interface UseCaseRow {
  use_case_key: string;
}

interface ApprovalEvent {
  id: string;
  audit_event_name: string;
  reason: string | null;
  created_at: string;
}

const TONE_BADGE: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
};

function Detail() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [useCases, setUseCases] = useState<UseCaseRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [ack, setAck] = useState<ProductionApprovalChecklist>({
    hasAllowedCountries: false,
    hasAllowedScopes: false,
    hasAllowedUseCase: false,
    hasRateLimitProfile: false,
    hasBusinessDecisionReference: false,
    hasApprovalReason: false,
    acknowledged: false,
  });
  const [decisionRef, setDecisionRef] = useState("");
  const [approvalReason, setApprovalReason] = useState("");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      const [c, k, s, co, uc, ev] = await Promise.all([
        supabase.from("registry_api_clients" as any).select("*").eq("id", clientId).maybeSingle(),
        supabase
          .from("registry_api_keys" as any)
          .select("id, client_id, key_type, status, label, last_four, key_prefix, created_at, last_rotated_at, rotation_reason")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false }),
        supabase.from("registry_api_client_scopes" as any).select("scope_key").eq("client_id", clientId),
        supabase.from("registry_api_client_countries" as any).select("country_code").eq("client_id", clientId),
        supabase.from("registry_api_client_use_cases" as any).select("use_case_key").eq("client_id", clientId),
        supabase
          .from("registry_api_approval_events" as any)
          .select("id, audit_event_name, reason, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setClient((c.data ?? null) as unknown as ClientDetail | null);
      setKeys(((k.data ?? []) as unknown) as KeyRow[]);
      setScopes(((s.data ?? []) as unknown) as ScopeRow[]);
      setCountries(((co.data ?? []) as unknown) as CountryRow[]);
      setUseCases(((uc.data ?? []) as unknown) as UseCaseRow[]);
      setApprovals(((ev.data ?? []) as unknown) as ApprovalEvent[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (!client) return;
    setAck((prev) => ({
      ...prev,
      hasAllowedCountries: (countries?.length ?? 0) > 0,
      hasAllowedScopes: (scopes?.length ?? 0) > 0,
      hasAllowedUseCase: (useCases?.length ?? 0) > 0,
      hasRateLimitProfile: !!client.rate_limit_profile,
      hasBusinessDecisionReference: decisionRef.trim().length > 0,
      hasApprovalReason: approvalReason.trim().length > 0,
    }));
  }, [client, countries, scopes, useCases, decisionRef, approvalReason]);

  if (loading) {
    return <main className="max-w-6xl mx-auto p-6">Loading client…</main>;
  }
  if (!client) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <p className="text-sm text-slate-600">Client not found.</p>
        <Link to="/admin/registry/api-clients" className="text-xs underline">
          Back to clients
        </Link>
      </main>
    );
  }

  const tone = lifecycleTone(client.lifecycle_status);
  const active = isClientLifecycleActive(client.lifecycle_status);
  const blocked = isClientLifecycleBlocked(client.lifecycle_status);
  const productionApproved = client.lifecycle_status === "production_active";
  const productionAck = !!client.production_acknowledged_at;
  const scopeKeys = new Set(scopes.map((s) => s.scope_key));
  const productionKeys = keys.filter((k) => k.key_type === "production");
  const sandboxKeys = keys.filter((k) => k.key_type !== "production");
  const ready = isProductionApprovalReady(ack);

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            <Link to="/admin/registry/api-clients" className="underline">
              Clients
            </Link>{" "}
            / {client.client_code}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {client.display_name}
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className={`text-[10px] ${TONE_BADGE[tone]}`} data-testid="lifecycle-badge">
              {REGISTRY_API_LIFECYCLE_LABELS[
                (client.lifecycle_status ?? "draft") as keyof typeof REGISTRY_API_LIFECYCLE_LABELS
              ] ?? client.lifecycle_status ?? "—"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Mode:{" "}
              {REGISTRY_API_MODE_LABELS[
                (client.mode ?? "disabled") as keyof typeof REGISTRY_API_MODE_LABELS
              ] ?? client.mode ?? "Disabled"}
            </Badge>
            {blocked && (
              <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200" data-testid="blocked-banner">
                Client is not active
              </Badge>
            )}
            {active && (
              <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                Active
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Scopes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scopes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-500" data-testid="forbidden-scope-explanation">
            {REGISTRY_API_UI_COPY.forbiddenScopesExplanation}
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {buildScopeOptions().map((opt) => {
              const granted = scopeKeys.has(opt.scopeKey);
              return (
                <li
                  key={opt.scopeKey}
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border text-xs ${
                    opt.forbidden
                      ? "border-rose-200 bg-rose-50/40 text-rose-800"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                  data-testid={opt.forbidden ? "forbidden-scope-row" : "scope-row"}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!opt.forbidden && granted}
                      disabled={!opt.selectable}
                      readOnly
                      aria-label={opt.label}
                      data-testid={
                        opt.forbidden ? "forbidden-scope-checkbox" : "scope-checkbox"
                      }
                    />
                    <span className="truncate">{opt.label}</span>
                  </div>
                  <code className="text-[10px] text-slate-500">{opt.scopeKey}</code>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Countries + Use cases */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approved countries</CardTitle>
          </CardHeader>
          <CardContent>
            {countries.length === 0 ? (
              <p className="text-xs text-slate-500">None.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {countries.map((c) => (
                  <Badge key={c.country_code} variant="outline" className="text-[10px]">
                    {c.country_code}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approved use cases</CardTitle>
          </CardHeader>
          <CardContent>
            {useCases.length === 0 ? (
              <p className="text-xs text-slate-500">None.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {useCases.map((u) => (
                  <Badge key={u.use_case_key} variant="outline" className="text-[10px]">
                    {u.use_case_key}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sandbox keys */}
      <Card data-testid="sandbox-keys-panel">
        <CardHeader>
          <CardTitle className="text-base">Sandbox keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[11px] text-slate-500">
            {REGISTRY_API_UI_COPY.keyVisibilityWarning}
          </p>
          {sandboxKeys.length === 0 ? (
            <p className="text-xs text-slate-500">No sandbox keys.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sandboxKeys.map((k) => (
                <li key={k.id} className="py-1.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono">{safeKeyReference({ lastFour: k.last_four, keyPrefix: k.key_prefix })}</span>
                    <span className="ml-2 text-slate-500">{k.label ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        k.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                      data-testid="key-status"
                    >
                      {k.status}
                    </Badge>
                    <span className="text-[10px] text-slate-500">
                      {new Date(k.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Production keys */}
      <Card data-testid="production-keys-panel">
        <CardHeader>
          <CardTitle className="text-base">Production keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!productionApproved && (
            <div
              className="px-3 py-2 rounded border border-amber-200 bg-amber-50 text-[11px] text-amber-800"
              data-testid="production-not-approved-banner"
            >
              Production access has not been approved. Production key controls are disabled.
            </div>
          )}
          {productionKeys.length === 0 ? (
            <p className="text-xs text-slate-500">No production keys.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {productionKeys.map((k) => (
                <li key={k.id} className="py-1.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono">{safeKeyReference({ lastFour: k.last_four, keyPrefix: k.key_prefix })}</span>
                    <span className="ml-2 text-slate-500">{k.label ?? "—"}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]" data-testid="key-status">
                    {k.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <div className="pt-2">
            <Button
              size="sm"
              disabled={!productionApproved}
              data-testid="create-production-key-btn"
              title={
                productionApproved
                  ? "Create production key"
                  : "Production approval required before production keys can be created."
              }
            >
              Create production key
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Production approval */}
      <Card data-testid="production-approval-panel">
        <CardHeader>
          <CardTitle className="text-base">Production approval</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {productionAck ? (
            <p className="text-xs text-emerald-700">
              Production access was acknowledged at{" "}
              {new Date(client.production_acknowledged_at!).toLocaleString()}.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Production approval requires every checklist item to be satisfied.
            </p>
          )}
          <ul className="text-xs space-y-1 text-slate-700">
            <li data-testid="ack-check-countries">
              {ack.hasAllowedCountries ? "✓" : "·"} Allowed countries selected
            </li>
            <li data-testid="ack-check-scopes">
              {ack.hasAllowedScopes ? "✓" : "·"} Allowed scopes selected
            </li>
            <li data-testid="ack-check-use-case">
              {ack.hasAllowedUseCase ? "✓" : "·"} Allowed use case selected
            </li>
            <li data-testid="ack-check-rate-limit">
              {ack.hasRateLimitProfile ? "✓" : "·"} Rate-limit profile selected
            </li>
            <li data-testid="ack-check-decision">
              {ack.hasBusinessDecisionReference ? "✓" : "·"} Business-decision reference recorded
            </li>
            <li data-testid="ack-check-reason">
              {ack.hasApprovalReason ? "✓" : "·"} Approval reason recorded
            </li>
          </ul>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Business decision reference</Label>
              <Input
                value={decisionRef}
                onChange={(e) => setDecisionRef(e.target.value)}
                placeholder="BDR-…"
                data-testid="decision-ref-input"
              />
            </div>
            <div>
              <Label className="text-xs">Approval reason</Label>
              <Input
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                placeholder="Why production is being approved"
                data-testid="approval-reason-input"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700" data-testid="production-ack-label">
            <Checkbox
              checked={ack.acknowledged}
              onCheckedChange={(v) =>
                setAck((prev) => ({ ...prev, acknowledged: v === true }))
              }
              data-testid="production-ack-checkbox"
            />
            <span data-testid="production-ack-text">
              {REGISTRY_API_UI_COPY.productionAcknowledgement}
            </span>
          </label>
          <Button
            size="sm"
            disabled={!ready}
            data-testid="submit-production-approval-btn"
          >
            Submit production approval
          </Button>
        </CardContent>
      </Card>

      {/* Approval history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approval history & audit</CardTitle>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <p className="text-xs text-slate-500">No recorded approval events.</p>
          ) : (
            <ul className="text-xs space-y-1.5">
              {approvals.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono">{a.audit_event_name}</span>
                  <span className="text-slate-500 truncate">{a.reason ?? "—"}</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Summary footer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration summary</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-slate-600 space-y-1">
          <p>Countries: {summariseList(countries.map((c) => c.country_code))}</p>
          <p>Use cases: {summariseList(useCases.map((u) => u.use_case_key))}</p>
          <p>Rate-limit profile: {client.rate_limit_profile ?? "—"}</p>
          <p>Notes: {client.admin_notes ?? "—"}</p>
          <p className="text-[11px] text-slate-500">
            {REGISTRY_API_UI_COPY.rawBankProhibition}
          </p>
        </CardContent>
      </Card>

      <Textarea readOnly value="" aria-hidden className="hidden" />
    </main>
  );
}

export default function AdminApiClientDetail() {
  return (
    <RequireAuth role="platform_admin" fallbackRoute="/desk">
      <Detail />
    </RequireAuth>
  );
}
