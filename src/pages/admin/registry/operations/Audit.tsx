/**
 * Batch 17 — Operations audit activity view.
 * Safe summaries only. Never renders raw provider payloads or raw bank fields.
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { REGISTRY_OPS_EMPTY_COPY } from "@/lib/registry-operations-centre-ssot";

interface AuditEvent {
  id: string; timestamp: string; event_name: string; module: string;
  actor_role: string; safe_object_reference: string | null;
  safe_summary: Record<string, unknown>; audit_reference: string | null;
}

export default function AdminRegistryOperationsAudit() {
  const [items, setItems] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [since, setSince] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (eventName) params.set("event_name", eventName);
      if (since) params.set("since", since);
      params.set("limit", "200");
      const { data, error } = await supabase.functions.invoke(`registry-operations-audit?${params.toString()}`, { body: {} });
      if (error) throw error;
      setItems((data?.events ?? []) as AuditEvent[]);
    } catch (e: any) { setError(e?.message ?? "Failed to load audit view"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <main className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Audit activity</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Safe audit summaries for registry operations. Raw provider payloads, raw bank fields, full API keys and personal contacts are excluded.
      </p>

      <Card className="mb-3">
        <CardContent className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
          <label className="text-xs flex flex-col gap-1">Event name
            <Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. registry_company_claim_submitted" data-testid="ops-audit-event-name" />
          </label>
          <label className="text-xs flex flex-col gap-1">Since (ISO)
            <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="2026-06-01T00:00:00Z" data-testid="ops-audit-since" />
          </label>
          <Button onClick={load} disabled={loading} data-testid="ops-audit-apply">Apply</Button>
        </CardContent>
      </Card>

      {error && <Card className="mb-3 border-destructive/50"><CardContent className="p-3 text-sm text-destructive">{error}</CardContent></Card>}

      <Card>
        <CardContent className="p-0">
          <Table data-testid="ops-audit-table">
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead><TableHead>Event</TableHead><TableHead>Module</TableHead>
                <TableHead>Object</TableHead><TableHead>Summary</TableHead><TableHead>Ref</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((e) => (
                <TableRow key={e.id} data-testid={`ops-audit-row-${e.event_name}`}>
                  <TableCell className="text-xs">{new Date(e.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{e.event_name}</TableCell>
                  <TableCell className="text-xs">{e.module}</TableCell>
                  <TableCell className="text-xs">{e.safe_object_reference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{Object.entries(e.safe_summary).map(([k, v]) => `${k}: ${String(v)}`).join("; ") || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.audit_reference ?? "—"}</TableCell>
                </TableRow>
              ))}
              {items !== null && items.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">{REGISTRY_OPS_EMPTY_COPY.audit}</TableCell></TableRow>}
              {items === null && !error && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
