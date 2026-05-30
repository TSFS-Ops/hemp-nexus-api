/**
 * Admin Export Controls Batch 5 — HQ Governance Export Request List View.
 *
 * Platform-admin only (UI guard) + AAL2-required (server enforced).
 * Read-only cross-record listing of Governance Record export requests.
 *
 * Hard contract — this panel NEVER renders:
 *   - prepare / generate / download / destroy controls
 *   - signed URLs, file paths, storage keys, download tokens
 *   - CSV / JSON / PDF export buttons
 *   - wording implying the export is available for retrieval
 *
 * The list view does not mutate any export_requests row. Approval and
 * request shells (Batch 2 / Batch 4) remain the only mutation surfaces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, RefreshCw, ShieldCheck, Filter } from "lucide-react";

export const BATCH_5_LIST_STATUSES = [
  "awaiting_approval",
  "approved",
  "denied",
  "failed",
] as const;
type ListStatus = (typeof BATCH_5_LIST_STATUSES)[number];

interface ListRow {
  export_request_id: string;
  governance_record_id: string;
  status: string;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  redaction_mode: string | null;
  purpose: string | null;
  reason_summary: string | null;
  approval_note_summary: string | null;
  legal_hold_context_present: boolean;
  legal_hold_context_scope: string | null;
  target_org_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  ok: true;
  count: number;
  items: ListRow[];
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; rows: ListRow[]; count: number }
  | { kind: "denied"; code: string; message: string }
  | { kind: "error"; message: string };

export function AdminGovernanceExportRequestsListPanel() {
  const { isPlatformAdmin } = useAuth();
  const [statuses, setStatuses] = useState<ReadonlyArray<ListStatus>>([
    "awaiting_approval",
    "approved",
  ]);
  const [recordFilter, setRecordFilter] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setState({ kind: "loading" });
    try {
      const body: Record<string, unknown> = {
        statuses,
        limit: 100,
      };
      const trimmed = recordFilter.trim();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
        body.governance_record_id = trimmed;
      }
      const { data, error } = await supabase.functions.invoke(
        "admin-governance-export-list",
        { body },
      );
      if (error) {
        const code =
          (error as { context?: { code?: string } })?.context?.code ?? "";
        const message = error.message ?? "List failed.";
        if (code === "MFA_REQUIRED" || code === "NOT_PLATFORM_ADMIN") {
          setState({ kind: "denied", code, message });
          return;
        }
        setState({ kind: "error", message });
        return;
      }
      const resp = data as ListResponse;
      setState({ kind: "loaded", rows: resp.items ?? [], count: resp.count ?? 0 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ kind: "error", message });
    } finally {
      // Zero Swallowed Errors — state always advances.
    }
  }, [isPlatformAdmin, recordFilter, statuses]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusToggle = useMemo(
    () =>
      BATCH_5_LIST_STATUSES.map((s) => {
        const active = statuses.includes(s);
        return (
          <Button
            key={s}
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setStatuses((prev) =>
                prev.includes(s)
                  ? (prev.filter((x) => x !== s) as ListStatus[])
                  : ([...prev, s] as ListStatus[]),
              )
            }
            data-testid={`status-toggle-${s}`}
            className="text-[11px]"
          >
            {s}
          </Button>
        );
      }),
    [statuses],
  );

  if (!isPlatformAdmin) {
    return (
      <Alert variant="destructive" data-testid="not-platform-admin">
        <AlertTitle className="text-xs">Restricted</AlertTitle>
        <AlertDescription className="text-xs">
          Governance Record export request listing is restricted to platform
          admins.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <section
      className="rounded-sm border border-border bg-card p-5 space-y-4"
      data-testid="admin-governance-export-list-panel"
    >
      <header className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          HQ · Admin Export Controls · Batch 5
        </p>
        <h3 className="text-sm font-medium text-foreground">
          Governance Record export requests
        </h3>
        <p className="text-xs text-muted-foreground">
          Read-only cross-record listing. No file generation, no signed URLs,
          no download links, no prepare / destroy controls.
        </p>
      </header>

      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle className="text-xs">AAL2 required</AlertTitle>
        <AlertDescription className="text-xs">
          Listing Governance Record export requests requires multi-factor
          authentication. This view exposes governance metadata only —
          requesters, approvers, status, redaction mode, and legal-hold
          context presence. It exposes no raw sanctions / PEP data, no raw
          API payloads, no storage keys, and no download tokens.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Filter className="h-3 w-3" /> Status
          </label>
          <div className="flex flex-wrap gap-1">{statusToggle}</div>
        </div>
        <div className="space-y-1 grow min-w-[240px]">
          <label
            htmlFor="record-filter"
            className="text-[11px] text-muted-foreground"
          >
            Governance Record ID (uuid, optional)
          </label>
          <Input
            id="record-filter"
            value={recordFilter}
            onChange={(e) => setRecordFilter(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            data-testid="record-filter"
            className="font-mono text-xs"
            maxLength={64}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={state.kind === "loading"}
          data-testid="refresh-button"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      <Badge variant="outline" className="text-[10px]">
        <ShieldCheck className="h-3 w-3 mr-1" />
        No file generated · No download link · No signed URL · No prepare /
        destroy
      </Badge>

      {state.kind === "loading" && (
        <div className="space-y-2" data-testid="list-loading">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      )}
      {state.kind === "denied" && (
        <Alert variant="destructive" data-testid="list-denied">
          <AlertTitle className="text-xs">{state.code}</AlertTitle>
          <AlertDescription className="text-xs">{state.message}</AlertDescription>
        </Alert>
      )}
      {state.kind === "error" && (
        <Alert variant="destructive" data-testid="list-error">
          <AlertTitle className="text-xs">Could not load list</AlertTitle>
          <AlertDescription className="text-xs">{state.message}</AlertDescription>
        </Alert>
      )}
      {state.kind === "loaded" && state.rows.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="list-empty">
          No Governance Record export requests match the current filter.
        </p>
      )}
      {state.kind === "loaded" && state.rows.length > 0 && (
        <div className="rounded-sm border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Governance Record</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead>Requested at</TableHead>
                <TableHead>Approved by</TableHead>
                <TableHead>Approved at</TableHead>
                <TableHead>Redaction</TableHead>
                <TableHead>Legal hold</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Approval note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.rows.map((row) => (
                <TableRow
                  key={row.export_request_id}
                  data-testid="list-row"
                  data-request-id={row.export_request_id}
                  data-status={row.status}
                >
                  <TableCell className="font-mono text-[11px]">
                    {row.export_request_id}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {row.governance_record_id}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {row.requested_by}
                  </TableCell>
                  <TableCell className="text-[11px]">
                    {new Date(row.requested_at).toISOString()}
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">
                    {row.approved_by ?? "—"}
                  </TableCell>
                  <TableCell className="text-[11px]">
                    {row.approved_at
                      ? new Date(row.approved_at).toISOString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {row.redaction_mode ?? "redacted_client_safe"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {row.legal_hold_context_present ? (
                      <Badge
                        variant="outline"
                        className="text-[10px]"
                        data-testid="legal-hold-indicator"
                      >
                        legal-hold context
                        {row.legal_hold_context_scope
                          ? ` · ${row.legal_hold_context_scope}`
                          : ""}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-[11px] max-w-[260px] whitespace-pre-wrap"
                    title={row.reason_summary ?? ""}
                  >
                    {row.reason_summary ?? "—"}
                  </TableCell>
                  <TableCell
                    className="text-[11px] max-w-[260px] whitespace-pre-wrap"
                    title={row.approval_note_summary ?? ""}
                  >
                    {row.approval_note_summary ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
