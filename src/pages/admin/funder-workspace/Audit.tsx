/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Audit & Usage read-only console.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAuditEvents, listUsageEvents } from "@/lib/funder-workspace/admin-client";
import type { AuditEventRow, UsageEventRow } from "@/lib/funder-workspace/types";

export default function FunderWorkspaceAudit() {
  const [usage, setUsage] = useState<UsageEventRow[]>([]);
  const [audit, setAudit] = useState<AuditEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [u, a] = await Promise.all([
          listUsageEvents({ limit: 300 }),
          listAuditEvents({ limit: 300 }),
        ]);
        setUsage(u);
        setAudit(a);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div className="p-6 space-y-4" data-testid="fw-admin-audit">
      <div>
        <h1 className="text-2xl font-semibold">Funder Workspace — Audit & Usage</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of the funder audit ledger and non-financial usage events.
        </p>
      </div>

      {error && <Card><CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent></Card>}

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit events</TabsTrigger>
          <TabsTrigger value="usage">Usage events</TabsTrigger>
        </TabsList>
        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">{audit.length} audit event(s)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Funder org</TableHead>
                    <TableHead>Object</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="text-xs">{e.user_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.funder_organisation_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.object_type ?? "—"} / {e.object_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.reason_code ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="usage">
          <Card>
            <CardHeader><CardTitle className="text-base">{usage.length} usage event(s)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Funder org</TableHead>
                    <TableHead>Deal</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>Pack version</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
                      <TableCell className="text-xs">{e.actor_user_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.funder_organisation_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.deal_reference ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.release_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.pack_version_id ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
