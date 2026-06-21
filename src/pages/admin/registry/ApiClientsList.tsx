/**
 * Batch 15B — Institutional API Admin: Clients list.
 *
 * Safe read-only listing of registry_api_clients. No secrets, no full keys,
 * no raw bank/personal/evidence data. Suspended/revoked/expired/disabled
 * clients are visibly non-active.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { RequireAuth } from "@/components/RequireAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  REGISTRY_API_LIFECYCLE_LABELS,
  REGISTRY_API_MODE_LABELS,
  isClientLifecycleActive,
  lifecycleTone,
  summariseList,
} from "@/lib/registry-api-hardening-ui";

interface ClientRow {
  id: string;
  client_code: string;
  display_name: string;
  client_type: string | null;
  environment: string;
  status: string;
  lifecycle_status: string | null;
  mode: string | null;
  allowed_countries: string[] | null;
  allowed_use_cases: string[] | null;
  rate_limit_profile: string | null;
  review_due_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const TONE_BADGE: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-rose-50 text-rose-700 border-rose-200",
  neutral: "bg-slate-50 text-slate-600 border-slate-200",
};

function Page() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("");
  const [country, setCountry] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("registry_api_clients" as any)
        .select(
          "id, client_code, display_name, client_type, environment, status, lifecycle_status, mode, allowed_countries, allowed_use_cases, rate_limit_profile, review_due_at, expires_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setRows((data ?? []) as unknown as ClientRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status && (r.lifecycle_status ?? "") !== status) return false;
      if (mode && (r.mode ?? "") !== mode) return false;
      if (country && !(r.allowed_countries ?? []).includes(country.toUpperCase())) return false;
      if (
        filter &&
        !`${r.display_name} ${r.client_code}`.toLowerCase().includes(filter.toLowerCase())
      )
        return false;
      return true;
    });
  }, [rows, status, mode, country, filter]);

  return (
    <main className="max-w-7xl mx-auto p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Institutional API clients
          </h1>
          <p className="text-sm text-slate-500">
            Batch 15B admin view. Read-only safe summary. No secrets, no full keys, no
            raw bank or personal data is rendered.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          <Link to="/admin/registry/api" className="underline">
            Legacy Batch 5 admin
          </Link>
          {" · "}
          <Link to="/admin/registry/api-usage" className="underline">
            Usage log
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
            <Label className="text-xs">Search</Label>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Name or code"
              data-testid="filter-search"
            />
          </div>
          <div>
            <Label className="text-xs">Lifecycle status</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              data-testid="filter-status"
            >
              <option value="">Any</option>
              {Object.entries(REGISTRY_API_LIFECYCLE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
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
          <div>
            <Label className="text-xs">Country (ISO-2)</Label>
            <Input
              value={country}
              maxLength={2}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              placeholder="ZA"
              data-testid="filter-country"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${filtered.length} client${filtered.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-slate-500">Loading API clients…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500" data-testid="empty-state">
              No API clients match the current filters.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2">Client</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Lifecycle</th>
                  <th className="text-left py-2 px-2">Mode</th>
                  <th className="text-left py-2 px-2">Countries</th>
                  <th className="text-left py-2 px-2">Use cases</th>
                  <th className="text-left py-2 px-2">Rate-limit profile</th>
                  <th className="text-left py-2 px-2">Review / expiry</th>
                  <th className="text-left py-2 px-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const tone = lifecycleTone(r.lifecycle_status);
                  const active = isClientLifecycleActive(r.lifecycle_status);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100"
                      data-testid="client-row"
                      data-active={active ? "yes" : "no"}
                    >
                      <td className="py-2 px-2">
                        <div className="font-medium text-slate-900">{r.display_name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{r.client_code}</div>
                      </td>
                      <td className="py-2 px-2 text-slate-600">{r.client_type ?? "—"}</td>
                      <td className="py-2 px-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${TONE_BADGE[tone]}`}
                          data-testid="lifecycle-badge"
                        >
                          {REGISTRY_API_LIFECYCLE_LABELS[
                            (r.lifecycle_status ?? "draft") as keyof typeof REGISTRY_API_LIFECYCLE_LABELS
                          ] ?? r.lifecycle_status ?? "—"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-600">
                        {REGISTRY_API_MODE_LABELS[
                          (r.mode ?? "disabled") as keyof typeof REGISTRY_API_MODE_LABELS
                        ] ?? r.mode ?? "Disabled"}
                      </td>
                      <td className="py-2 px-2 text-slate-600">
                        {summariseList(r.allowed_countries)}
                      </td>
                      <td className="py-2 px-2 text-slate-600">
                        {summariseList(r.allowed_use_cases)}
                      </td>
                      <td className="py-2 px-2 text-slate-600">
                        {r.rate_limit_profile ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-slate-600">
                        {r.review_due_at ? new Date(r.review_due_at).toLocaleDateString() : "—"}
                        {r.expires_at && (
                          <div className="text-[10px] text-slate-500">
                            exp {new Date(r.expires_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <Button asChild size="sm" variant="outline" className="h-7 text-[11px]">
                          <Link to={`/admin/registry/api-clients/${r.id}`}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function AdminApiClientsList() {
  return (
    <RequireAuth role="platform_admin" fallbackRoute="/desk">
      <Page />
    </RequireAuth>
  );
}
