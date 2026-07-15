/**
 * Batch 3 — Funder workspace: organisation-scoped usage activity.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity as ActivityIcon } from "lucide-react";
import { FunderWorkspaceShell } from "./components/FunderWorkspaceShell";
import { listMyUsageEvents } from "@/lib/funder-workspace/funder-client";
import type { UsageEventRow } from "@/lib/funder-workspace/types";
import {
  EmptyState,
  InfoBanner,
  LoadingState,
  SectionHeading,
  formatDateTime,
  usageEventLabel,
} from "@/lib/funder-workspace/ui";

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
  const [rows, setRows] = useState<UsageEventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listMyUsageEvents({ limit: 200 })
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  if (err)
    return (
      <InfoBanner tone="destructive" title="Failed to load activity">
        {err}
      </InfoBanner>
    );

  return (
    <Card data-testid="fw-funder-activity">
      <CardHeader>
        <SectionHeading
          title="Recent activity"
          description="Most recent 200 events. Older activity remains in the audit trail."
        />
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <LoadingState label="Loading activity…" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No recorded activity yet"
            description="Downloads, RFIs and decisions will appear here as you use the workspace."
            icon={<ActivityIcon className="h-8 w-8" />}
          />
        ) : (
          <div className="overflow-x-auto">
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
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(e.occurred_at)}
                    </TableCell>
                    <TableCell className="text-sm">{usageEventLabel(e.event_type)}</TableCell>
                    <TableCell className="text-sm">{e.deal_reference ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
