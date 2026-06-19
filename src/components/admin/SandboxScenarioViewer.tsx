/**
 * SandboxScenarioViewer — Public API V1 · Sand/Prod Batch 8
 *
 * Read-only, internal-only viewer for the deterministic sandbox scenario
 * catalogue (public.api_sandbox_records). Surfaces nothing about real
 * production counterparties. No writes, no exports, no document /
 * evidence / governance / POI / WaD / payment / compliance fields.
 *
 * Access is enforced at the database by RLS on api_sandbox_records
 * (platform_admin / api_admin / auditor only).
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, FlaskConical } from "lucide-react";
import { toast } from "sonner";

type SandboxRow = {
  id: string;
  scenario_code: string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  country: string | null;
  website_domain: string | null;
  email_domain: string | null;
  match_status: string | null;
  confidence_band: string | null;
  verification_status: string | null;
  record_scope: string | null;
  next_action: string | null;
  data_freshness_date: string | null;
  scenario_notes: string | null;
  test_data: boolean | null;
  active: boolean | null;
};

const STATUS_TONE: Record<string, string> = {
  verified_match: "bg-emerald-50 text-emerald-800 border-emerald-300",
  unverified_match: "bg-amber-50 text-amber-800 border-amber-300",
  no_match: "bg-slate-100 text-slate-700 border-slate-300",
  multiple_possible_matches: "bg-blue-50 text-blue-800 border-blue-300",
  blocked_record: "bg-red-50 text-red-800 border-red-300",
  stale_record: "bg-orange-50 text-orange-800 border-orange-300",
};

export function SandboxScenarioViewer() {
  const [rows, setRows] = useState<SandboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from("api_sandbox_records") as any)
        .select(
          "id, scenario_code, legal_name, trading_name, registration_number, country, website_domain, email_domain, match_status, confidence_band, verification_status, record_scope, next_action, data_freshness_date, scenario_notes, test_data, active",
        )
        .order("scenario_code", { ascending: true })
        .limit(200);
      if (error) throw error;
      setRows((data ?? []) as SandboxRow[]);
    } catch (e: any) {
      toast.error(`Unable to load sandbox scenarios: ${e?.message ?? e}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((r) => {
    if (!filter.trim()) return true;
    const f = filter.toLowerCase();
    return (
      r.scenario_code?.toLowerCase().includes(f) ||
      r.legal_name?.toLowerCase().includes(f) ||
      r.country?.toLowerCase().includes(f) ||
      r.match_status?.toLowerCase().includes(f)
    );
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" />
            Sandbox scenario catalogue · read-only · test_data=true
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Deterministic test records served by the sandbox host. These rows
            are never returned in production, never represent real
            counterparties, and never expose documents, evidence, payments,
            governance, POI or WaD fields.
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Filter by code / name / country / status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64 h-8 text-xs"
          />
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border border-border rounded-sm">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Scenario</th>
              <th className="p-2">Legal name</th>
              <th className="p-2">Country</th>
              <th className="p-2">Match status</th>
              <th className="p-2">Confidence</th>
              <th className="p-2">Verification</th>
              <th className="p-2">Scope</th>
              <th className="p-2">Next action</th>
              <th className="p-2">Freshness</th>
              <th className="p-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} className="p-4 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="p-4 text-center text-muted-foreground">
                  No sandbox scenarios match the filter.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-2 font-mono">{r.scenario_code}</td>
                  <td className="p-2">{r.legal_name ?? "—"}</td>
                  <td className="p-2">{r.country ?? "—"}</td>
                  <td className="p-2">
                    {r.match_status ? (
                      <Badge
                        variant="outline"
                        className={STATUS_TONE[r.match_status] ?? "bg-slate-100 text-slate-700 border-slate-300"}
                      >
                        {r.match_status}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-2">{r.confidence_band ?? "—"}</td>
                  <td className="p-2">{r.verification_status ?? "—"}</td>
                  <td className="p-2">{r.record_scope ?? "—"}</td>
                  <td className="p-2">{r.next_action ?? "—"}</td>
                  <td className="p-2">{r.data_freshness_date ?? "—"}</td>
                  <td className="p-2">{r.active ? "yes" : "no"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-muted-foreground">
        Read-only. Source: <span className="font-mono">public.api_sandbox_records</span>. Scenario data only — no real counterparty information is shown.
      </div>
    </div>
  );
}

export default SandboxScenarioViewer;
