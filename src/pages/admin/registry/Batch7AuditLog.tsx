// Batch 7 — Admin audit log view for registry claim, evidence, conflict,
// correction, and outreach-block decisions, with CSV export.
//
// Calls the edge function `registry-batch7-audit-export` which enforces
// platform_admin via SECURITY DEFINER inside `admin_list_batch7_audit_events`.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";

interface AuditRow {
  id: string;
  event_name: string;
  aggregate_id: string | null;
  aggregate_type: string | null;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  request_id: string | null;
  occurred_at: string;
}

export default function Batch7AuditLog() {
  const [from, setFrom] = useState<string>(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("registry-batch7-audit-export", {
        body: null,
        method: "GET" as any,
      });
      if (error) throw error;
      const parsed = (data as { rows?: AuditRow[] })?.rows ?? [];
      setRows(parsed);
    } catch (e) {
      toast.error("Failed to load audit log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        toast.error("Not authenticated");
        return;
      }
      const projectRef = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID ?? "";
      const url = `https://${projectRef}.supabase.co/functions/v1/registry-batch7-audit-export?format=csv&from=${from}&to=${to}&limit=5000`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!resp.ok) throw new Error(`http_${resp.status}`);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `batch7-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("CSV exported");
    } catch {
      toast.error("CSV export failed");
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <BackButton />
      <Card>
        <CardHeader>
          <CardTitle>Batch 7 — Registry Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</Button>
            <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Aggregate</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Request ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No Batch 7 audit events in the selected range.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.occurred_at}</TableCell>
                    <TableCell>{r.event_name}</TableCell>
                    <TableCell className="font-mono text-xs">{r.aggregate_type}/{r.aggregate_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.actor_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.request_id ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
