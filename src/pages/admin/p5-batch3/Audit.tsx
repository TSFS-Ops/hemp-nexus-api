/**
 * P-5 Batch 3 — Stage 4 audit view (read-only).
 *
 * Reads live rows from `p5_batch3_funder_audit_events` (RLS enforces
 * platform-admin visibility on the server).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollText } from "lucide-react";
import {
  EmptyState,
  LoadingState,
  SectionHeading,
  formatDateTime,
  humanize,
  shortId,
} from "@/lib/funder-workspace/ui";

interface AuditRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  funder_organisation_id: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  prior_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason_code: string | null;
  source_channel: string | null;
}

const T = "p5_batch3_funder_audit_events";

export default function P5Batch3Audit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from(T)
        .select(
          "id, created_at, actor_user_id, funder_organisation_id, action, object_type, object_id, prior_state, new_state, reason_code, source_channel",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        setErr(error.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as AuditRow[]);
    })();
  }, []);

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div>
        <Link to="/admin/p5-batch3" className="text-sm text-muted-foreground underline">
          ← Funder workflow
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Audit</h1>
        <p className="text-sm text-muted-foreground">
          Read-only. Every material funder-workflow action is recorded
          server-side and is immutable.
        </p>
      </div>

      {err && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive" role="alert">
            {err}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <SectionHeading
            title="Audit events"
            description="Most recent 200 events across all funder organisations."
          />
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <LoadingState label="Loading audit events…" />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No audit events recorded yet"
              description="Invitations, role changes and deactivations will appear here."
              icon={<ScrollText className="h-8 w-8" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Object</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(e.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{humanize(e.action)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{humanize(e.object_type ?? "")}</div>
                        {e.object_id && (
                          <code className="text-[11px] text-muted-foreground">
                            {shortId(e.object_id)}
                          </code>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{e.reason_code ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {humanize(e.source_channel ?? "")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
