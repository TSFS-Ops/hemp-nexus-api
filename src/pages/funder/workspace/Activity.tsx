/**
 * Batch 3 — Funder workspace: organisation-scoped usage activity.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import { listMyUsageEvents } from "@/lib/funder-workspace/funder-client";
import type { UsageEventRow } from "@/lib/funder-workspace/types";

export default function FunderWorkspaceActivity() {
  return (
    <FunderWorkspaceShell
      title="Activity"
      description="Recorded activity for your funder organisation."
    >
      {() => <Body />}
    </FunderWorkspaceShell>
  );
}

function Body() {
  const [rows, setRows] = useState<UsageEventRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listMyUsageEvents({ limit: 200 })
      .then(setRows)
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-destructive">{err}</CardContent>
      </Card>
    );

  return (
    <Card data-testid="fw-funder-activity">
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Deal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">
                    {new Date(e.occurred_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.event_type}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.deal_reference ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
