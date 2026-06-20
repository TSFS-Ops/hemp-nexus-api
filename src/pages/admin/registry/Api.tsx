/**
 * Batch 5 — Admin API Management surface (M016).
 * Lists API clients, their scopes / keys / recent requests, and recent
 * audit events. Status mutations are routed through the audited
 * registry-api-client-manage edge function.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReadinessBanner } from "@/components/registry/ReadinessBanner";
import {
  REGISTRY_API_SCOPES,
  REGISTRY_API_RESULT_STATES,
} from "@/lib/registry-institutional-api";

interface ApiClientRow {
  id: string;
  client_code: string;
  display_name: string;
  environment: string;
  status: string;
  scopes: string[];
  rate_limit_per_minute: number;
  rate_limit_per_day: number;
  admin_notes: string | null;
  created_at: string;
}

interface RequestLogRow {
  id: string;
  client_id: string | null;
  environment: string;
  endpoint: string;
  result_state: string;
  status_code: number;
  scope_granted: boolean;
  rate_limited: boolean;
  business_decision_blocked: boolean;
  created_at: string;
}

interface AuditRow {
  id: string;
  audit_event_name: string;
  client_id: string | null;
  reason: string | null;
  created_at: string;
}

export default function AdminRegistryApi() {
  const [clients, setClients] = useState<ApiClientRow[]>([]);
  const [logs, setLogs] = useState<RequestLogRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const c = await supabase.from("registry_api_clients").select("*").order("created_at", { ascending: false }).limit(100);
        const l = await supabase.from("registry_api_request_logs").select("*").order("created_at", { ascending: false }).limit(50);
        const a = await supabase.from("registry_api_audit_events").select("id, audit_event_name, client_id, reason, created_at").order("created_at", { ascending: false }).limit(50);
        if (cancelled) return;
        setClients((c.data ?? []) as ApiClientRow[]);
        setLogs((l.data ?? []) as RequestLogRow[]);
        setAudits((a.data ?? []) as AuditRow[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Registry API management</h1>
      <ReadinessBanner state="shell_ready" moduleCode="M016" />

      <Card>
        <CardHeader><CardTitle className="text-base">Canonical scopes (M016)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {REGISTRY_API_SCOPES.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-xs">{s}</Badge>
          ))}
          <p className="w-full text-xs text-muted-foreground mt-2">
            No raw bank-detail scope exists in Batch 5. Any future raw-detail
            scope would require a separate Business Decision and contract.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">API clients ({clients.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API clients have been provisioned yet. Use the
              <code className="mx-1 px-1 bg-muted rounded text-xs">registry-api-client-manage</code>
              edge function (action: <code className="px-1 bg-muted rounded text-xs">create_client</code>) to add one.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {clients.map((c) => (
                <li key={c.id} className="py-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{c.display_name}</span>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>{c.status}</Badge>
                    <Badge variant="outline">{c.environment}</Badge>
                    <code className="text-xs text-muted-foreground">{c.client_code}</code>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(c.scopes ?? []).map((s) => (
                      <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Rate: {c.rate_limit_per_minute}/min · {c.rate_limit_per_day}/day
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent requests</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? <p className="text-sm text-muted-foreground">No API requests recorded.</p> : (
            <ul className="text-xs font-mono divide-y divide-border">
              {logs.map((l) => (
                <li key={l.id} className="py-1 flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                  <span>{l.endpoint}</span>
                  <Badge variant={l.scope_granted ? "default" : "destructive"}>{l.result_state}</Badge>
                  <span>{l.status_code}</span>
                  {l.rate_limited ? <Badge variant="destructive">rate-limited</Badge> : null}
                  {l.business_decision_blocked ? <Badge variant="destructive">bd-required</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            Allowed result states: {REGISTRY_API_RESULT_STATES.join(", ")}.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Audit trail</CardTitle></CardHeader>
        <CardContent>
          {audits.length === 0 ? <p className="text-sm text-muted-foreground">No audit events yet.</p> : (
            <ul className="text-xs font-mono divide-y divide-border">
              {audits.map((a) => (
                <li key={a.id} className="py-1 flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                  <span>{a.audit_event_name}</span>
                  {a.reason ? <span className="text-muted-foreground italic">— {a.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
