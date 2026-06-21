/**
 * Batch 15B — Institutional API Admin: Usage and blocked events.
 *
 * Safe display of registry_api_usage_events and registry_api_blocked_events.
 * No raw bank, no personal contact, no raw provider payloads, no full keys.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  REGISTRY_API_MODE_LABELS,
  describeBlockedReason,
} from "@/lib/registry-api-hardening-ui";

interface UsageEvent {
  id: string;
  client_id: string | null;
  endpoint: string;
  scope: string | null;
  mode: string | null;
  country: string | null;
  result_state: string;
  usable: boolean | null;
  rate_limited: boolean | null;
  request_id: string | null;
  created_at: string;
}

interface BlockedEvent {
  id: string;
  client_id: string | null;
  endpoint: string;
  scope: string | null;
  mode: string | null;
  country: string | null;
  blocked_reason: string;
  gate_name: string | null;
  request_id: string | null;
  created_at: string;
}

function Page() {
  const [usage, setUsage] = useState<UsageEvent[]>([]);
  const [blocked, setBlocked] = useState<BlockedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [onlyRateLimited, setOnlyRateLimited] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [u, b] = await Promise.all([
        supabase
          .from("registry_api_usage_events" as any)
          .select(
            "id, client_id, endpoint, scope, mode, country, result_state, usable, rate_limited, request_id, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("registry_api_blocked_events" as any)
          .select(
            "id, client_id, endpoint, scope, mode, country, blocked_reason, gate_name, request_id, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      setUsage(((u.data ?? []) as unknown) as UsageEvent[]);
      setBlocked(((b.data ?? []) as unknown) as BlockedEvent[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredUsage = useMemo(() => {
    return usage.filter((u) => {
      if (clientFilter && (u.client_id ?? "").toLowerCase() !== clientFilter.toLowerCase()) return false;
      if (endpointFilter && !u.endpoint.toLowerCase().includes(endpointFilter.toLowerCase())) return false;
      if (scopeFilter && (u.scope ?? "") !== scopeFilter) return false;
      if (modeFilter && (u.mode ?? "") !== modeFilter) return false;
      if (onlyRateLimited && !u.rate_limited) return false;
      return true;
    });
  }, [usage, clientFilter, endpointFilter, scopeFilter, modeFilter, onlyRateLimited]);

  const filteredBlocked = useMemo(() => {
    return blocked.filter((b) => {
      if (clientFilter && (b.client_id ?? "").toLowerCase() !== clientFilter.toLowerCase()) return false;
      if (endpointFilter && !b.endpoint.toLowerCase().includes(endpointFilter.toLowerCase())) return false;
      if (scopeFilter && (b.scope ?? "") !== scopeFilter) return false;
      if (modeFilter && (b.mode ?? "") !== modeFilter) return false;
      return true;
    });
  }, [blocked, clientFilter, endpointFilter, scopeFilter, modeFilter]);

  return (
    <main className="max-w-7xl mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            API usage & blocked events
          </h1>
          <p className="text-sm text-slate-500">
            Safe audit-grade view. No raw bank details, no personal contacts, no raw
            provider payloads, no full API keys are rendered.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          <Link to="/admin/registry/api-clients" className="underline">
            Clients
          </Link>
          {" · "}
          <Link to="/admin/registry/api-test-console" className="underline">
            Test console
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Client ID</Label>
            <Input
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              data-testid="filter-client"
            />
          </div>
          <div>
            <Label className="text-xs">Endpoint</Label>
            <Input
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
              placeholder="profile-status"
              data-testid="filter-endpoint"
            />
          </div>
          <div>
            <Label className="text-xs">Scope</Label>
            <Input
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              placeholder="registry.profile.status.read"
              data-testid="filter-scope"
            />
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              data-testid="filter-mode"
            >
              <option value="">Any</option>
              {Object.entries(REGISTRY_API_MODE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 col-span-full text-xs text-slate-600">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyBlocked}
                onChange={(e) => setOnlyBlocked(e.target.checked)}
                data-testid="filter-only-blocked"
              />
              Show blocked events only
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={onlyRateLimited}
                onChange={(e) => setOnlyRateLimited(e.target.checked)}
                data-testid="filter-only-rate-limited"
              />
              Rate-limited only
            </label>
          </div>
        </CardContent>
      </Card>

      {!onlyBlocked && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${filteredUsage.length} usage event${filteredUsage.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {filteredUsage.length === 0 ? (
              <p className="text-sm text-slate-500">No usage events.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-2">Request</th>
                    <th className="text-left py-2 px-2">Endpoint</th>
                    <th className="text-left py-2 px-2">Scope</th>
                    <th className="text-left py-2 px-2">Mode</th>
                    <th className="text-left py-2 px-2">Country</th>
                    <th className="text-left py-2 px-2">Result</th>
                    <th className="text-left py-2 px-2">Usable</th>
                    <th className="text-left py-2 px-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsage.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100" data-testid="usage-row">
                      <td className="py-2 px-2 font-mono text-[10px]">{u.request_id ?? u.id.slice(0, 8)}</td>
                      <td className="py-2 px-2">{u.endpoint}</td>
                      <td className="py-2 px-2 font-mono text-[10px]">{u.scope ?? "—"}</td>
                      <td className="py-2 px-2">{u.mode ?? "—"}</td>
                      <td className="py-2 px-2">{u.country ?? "—"}</td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-[10px]">{u.result_state}</Badge>
                      </td>
                      <td className="py-2 px-2" data-testid="usable-cell">
                        {u.usable ? (
                          <Badge className="text-[10px] bg-emerald-600">Usable</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Not usable</Badge>
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-500">
                        {new Date(u.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${filteredBlocked.length} blocked event${filteredBlocked.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredBlocked.length === 0 ? (
            <p className="text-sm text-slate-500">No blocked events.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2">Request</th>
                  <th className="text-left py-2 px-2">Endpoint</th>
                  <th className="text-left py-2 px-2">Scope</th>
                  <th className="text-left py-2 px-2">Mode</th>
                  <th className="text-left py-2 px-2">Country</th>
                  <th className="text-left py-2 px-2">Blocked reason</th>
                  <th className="text-left py-2 px-2">Gate</th>
                  <th className="text-left py-2 px-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredBlocked.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100" data-testid="blocked-row">
                    <td className="py-2 px-2 font-mono text-[10px]">{b.request_id ?? b.id.slice(0, 8)}</td>
                    <td className="py-2 px-2">{b.endpoint}</td>
                    <td className="py-2 px-2 font-mono text-[10px]">{b.scope ?? "—"}</td>
                    <td className="py-2 px-2">{b.mode ?? "—"}</td>
                    <td className="py-2 px-2">{b.country ?? "—"}</td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200" data-testid="blocked-reason-badge">
                        {describeBlockedReason(b.blocked_reason)}
                      </Badge>
                    </td>
                    <td className="py-2 px-2 font-mono text-[10px]">{b.gate_name ?? "—"}</td>
                    <td className="py-2 px-2 text-slate-500">
                      {new Date(b.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function AdminApiUsage() {
  return (
    <RequireAuth role="platform_admin" fallbackRoute="/desk">
      <Page />
    </RequireAuth>
  );
}
