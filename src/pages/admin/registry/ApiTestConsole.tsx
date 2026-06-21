/**
 * Batch 15B — Institutional API Admin: Safe test console.
 *
 * Routes test calls through Batch 15 edge functions
 * (registry-api-profile-status, registry-api-payment-status). Renders ONLY
 * the safe envelope returned by the backend. Never displays raw bank data,
 * masked bank data, raw personal contacts, raw evidence, full keys, or raw
 * provider payloads.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  REGISTRY_API_MODE_LABELS,
  REGISTRY_API_UI_COPY,
  paymentStatusLabel,
} from "@/lib/registry-api-hardening-ui";
import {
  REGISTRY_API_HARDENED_SCOPES,
  REGISTRY_API_MODES,
} from "@/lib/registry-api-hardening";

const ENDPOINTS = [
  { value: "registry-api-profile-status", label: "Profile status" },
  { value: "registry-api-payment-status", label: "Payment status" },
] as const;

interface ClientOption {
  id: string;
  display_name: string;
  client_code: string;
  lifecycle_status: string | null;
}

interface SafeEnvelope {
  request_id?: string;
  client_id?: string | null;
  mode?: string;
  scope?: string;
  endpoint?: string;
  result_state?: string;
  usable?: boolean;
  safe_status?: string;
  safe_reason?: string;
  country?: string | null;
  company_reference?: string | null;
  source_summary?: string | null;
  readiness_summary?: string | null;
  expires_at?: string | null;
  audit_reference?: string;
  // Optional structured fields the backend may include for display.
  readiness_state?: string | null;
  lifecycle_state?: string | null;
  claim_status?: string | null;
  authority_status?: string | null;
  raw_verification_status?: string | null;
  gate_decisions?: Array<{ gate: string; passed: boolean; reason: string }>;
}

function Page() {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [mode, setMode] = useState<string>("sandbox");
  const [endpoint, setEndpoint] = useState<(typeof ENDPOINTS)[number]["value"]>(
    "registry-api-profile-status",
  );
  const [scope, setScope] = useState<string>("registry.profile.status.read");
  const [companyId, setCompanyId] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [envelope, setEnvelope] = useState<SafeEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("registry_api_clients" as any)
        .select("id, display_name, client_code, lifecycle_status")
        .order("display_name", { ascending: true })
        .limit(200);
      setClients(((data ?? []) as unknown) as ClientOption[]);
    })();
  }, []);

  useEffect(() => {
    setScope(
      endpoint === "registry-api-payment-status"
        ? "registry.payment_status.read"
        : "registry.profile.status.read",
    );
  }, [endpoint]);

  async function runTest() {
    if (!clientId || !companyId.trim()) {
      setError("Select a client and provide a company identifier.");
      return;
    }
    setBusy(true);
    setError(null);
    setEnvelope(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(endpoint, {
        body: {
          test_console: true,
          client_id: clientId,
          mode,
          scope,
          company_reference: companyId.trim(),
          country: country.trim() ? country.trim().toUpperCase() : null,
        },
      });
      if (invokeError) throw invokeError;
      setEnvelope((data ?? null) as SafeEnvelope | null);
    } catch (err) {
      console.error("Test console run failed", err);
      setError("Test run failed. See console.");
    } finally {
      setBusy(false);
    }
  }

  const isPayment = endpoint === "registry-api-payment-status";
  const payment = envelope
    ? paymentStatusLabel({
        resultState: envelope.result_state ?? null,
        usable: envelope.usable ?? null,
        rawVerificationStatus: envelope.raw_verification_status,
        expiresAt: envelope.expires_at ?? null,
      })
    : null;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            API test console
          </h1>
          <p className="text-sm text-slate-500" data-testid="test-console-warning">
            {REGISTRY_API_UI_COPY.testConsoleWarning}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          <Link to="/admin/registry/api-clients" className="underline">
            Clients
          </Link>
          {" · "}
          <Link to="/admin/registry/api-usage" className="underline">
            Usage
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test request</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Client</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              data-testid="select-client"
            >
              <option value="">Select…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name} ({c.client_code}) — {c.lifecycle_status ?? "draft"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              data-testid="select-mode"
            >
              {REGISTRY_API_MODES.map((m) => (
                <option key={m} value={m}>
                  {REGISTRY_API_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Endpoint</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value as typeof endpoint)}
              data-testid="select-endpoint"
            >
              {ENDPOINTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Scope</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              data-testid="select-scope"
            >
              {REGISTRY_API_HARDENED_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Company identifier</Label>
            <Input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="Registration number or registry ID"
              data-testid="input-company"
            />
          </div>
          <div>
            <Label className="text-xs">Country (ISO-2, optional)</Label>
            <Input
              value={country}
              maxLength={2}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              data-testid="input-country"
            />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={runTest} disabled={busy} data-testid="run-test-btn">
              {busy ? "Running…" : "Run test"}
            </Button>
            {error && <p className="text-xs text-rose-700 mt-2">{error}</p>}
          </div>
        </CardContent>
      </Card>

      {envelope && (
        <Card data-testid="response-envelope">
          <CardHeader>
            <CardTitle className="text-base">Safe response envelope</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <p className="text-[11px] text-slate-500">
              {REGISTRY_API_UI_COPY.testConsoleWarning}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                Result state:{" "}
                <Badge variant="outline" data-testid="result-state-badge">
                  {envelope.result_state ?? "—"}
                </Badge>
              </div>
              <div data-testid="usable-row">
                Usable:{" "}
                {envelope.usable ? (
                  <Badge className="bg-emerald-600">Yes</Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}
              </div>
              <div>Endpoint: {envelope.endpoint ?? endpoint}</div>
              <div>Scope: {envelope.scope ?? scope}</div>
              <div>Mode: {envelope.mode ?? mode}</div>
              <div>Country: {envelope.country ?? "—"}</div>
              <div>Audit reference: {envelope.audit_reference ?? envelope.request_id ?? "—"}</div>
              <div>Expires at: {envelope.expires_at ?? "—"}</div>
            </div>
            <p className="text-slate-700">{envelope.safe_reason ?? "—"}</p>

            {!isPayment && (
              <div className="space-y-1">
                <p className="text-slate-500 uppercase text-[10px] tracking-wider">
                  Profile summary
                </p>
                <p>Readiness: {envelope.readiness_summary ?? envelope.readiness_state ?? "—"}</p>
                <p>Lifecycle: {envelope.lifecycle_state ?? "—"}</p>
                <p>Claim: {envelope.claim_status ?? "—"}</p>
                <p>Authority: {envelope.authority_status ?? "—"}</p>
                <p>Source: {envelope.source_summary ?? "—"}</p>
                <p className="text-[11px] text-amber-700">
                  Imported or source-backed data is not independently verified by Izenzo.
                  Claim approval and authority approval do not by themselves verify the
                  company.
                </p>
              </div>
            )}

            {isPayment && payment && (
              <div className="space-y-1" data-testid="payment-status-block">
                <p className="text-slate-500 uppercase text-[10px] tracking-wider">
                  Payment status
                </p>
                <Badge
                  className={
                    payment.isVerified
                      ? "bg-emerald-600"
                      : "bg-amber-50 text-amber-800 border border-amber-200"
                  }
                  variant={payment.isVerified ? "default" : "outline"}
                  data-testid="payment-status-badge"
                >
                  {payment.label}
                </Badge>
                {!payment.isVerified && (
                  <p className="text-[11px] text-slate-500">
                    Non-final, expired, revoked, disputed and provider-error states never
                    render as verified.
                  </p>
                )}
              </div>
            )}

            {envelope.gate_decisions && envelope.gate_decisions.length > 0 && (
              <div>
                <p className="text-slate-500 uppercase text-[10px] tracking-wider mb-1">
                  Gate decisions
                </p>
                <ul className="space-y-1">
                  {envelope.gate_decisions.map((g, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          g.passed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-rose-50 text-rose-700 border-rose-200"
                        }`}
                      >
                        {g.passed ? "PASS" : "FAIL"}
                      </Badge>
                      <span className="font-mono">{g.gate}</span>
                      <span className="text-slate-500">{g.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

export default function AdminApiTestConsole() {
  return (
    <RequireAuth role="platform_admin" fallbackRoute="/desk">
      <Page />
    </RequireAuth>
  );
}
