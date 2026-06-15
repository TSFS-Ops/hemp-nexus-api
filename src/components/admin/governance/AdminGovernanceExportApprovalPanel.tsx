/**
 * Admin Export Controls Batch 4 - Pending Governance Record Export Approvals.
 *
 * Platform-admin only. AAL2-required (server enforced). Lists
 * `awaiting_approval` admin export requests anchored to the current
 * Governance Record (matchId) and lets a second platform admin approve.
 *
 * Hard contract - this panel NEVER renders:
 *   - download / signed URL / prepare / destroy controls
 *   - generated file links
 *   - wording that implies the export is available for retrieval
 *
 * "Approved means approved only - not prepared, not generated, not downloadable."
 */

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Lock, ShieldCheck, ClipboardCheck } from "lucide-react";

interface PendingRow {
  id: string;
  requester_user_id: string;
  requested_at: string;
  reason: string | null;
  purpose: string | null;
  redaction_mode: string | null;
  governance_record_id: string;
  verification: Record<string, unknown> | null;
}

interface Props {
  governanceRecordId: string;
  recordRef: string;
}

type RowState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; previousStatus: string; newStatus: string }
  | { kind: "denied"; code: string; message: string }
  | { kind: "failed"; message: string };

export function AdminGovernanceExportApprovalPanel({
  governanceRecordId,
  recordRef,
}: Props) {
  const { isPlatformAdmin, user } = useAuth();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [perRow, setPerRow] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("export_requests")
        .select(
          "id, requester_user_id, requested_at, reason, purpose, redaction_mode, governance_record_id, verification",
        )
        .eq("kind", "admin_export")
        .eq("status", "awaiting_approval")
        .eq("governance_record_id", governanceRecordId)
        .order("requested_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows((data ?? []) as PendingRow[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [governanceRecordId, isPlatformAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isPlatformAdmin) return null;

  const approve = async (row: PendingRow) => {
    setPerRow((p) => ({ ...p, [row.id]: { kind: "submitting" } }));
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-governance-export-approve",
        {
          body: {
            request_id: row.id,
            approval_note: (notes[row.id] ?? "").trim(),
          },
        },
      );
      if (error) {
        const code =
          (error as { context?: { code?: string } })?.context?.code ?? "";
        const message = error.message ?? "Approval failed.";
        const known = [
          "MFA_REQUIRED",
          "NOT_PLATFORM_ADMIN",
          "SELF_APPROVAL_BLOCKED",
          "REQUEST_NOT_FOUND",
          "REQUEST_NOT_PENDING",
          "NOT_GOVERNANCE_RECORD_REQUEST",
        ];
        if (known.includes(code)) {
          setPerRow((p) => ({
            ...p,
            [row.id]: { kind: "denied", code, message },
          }));
          toast.error(code.replace(/_/g, " ").toLowerCase());
          return;
        }
        setPerRow((p) => ({
          ...p,
          [row.id]: { kind: "failed", message },
        }));
        toast.error(`Approval failed: ${message}`);
        return;
      }
      const resp = data as {
        previous_status?: string;
        new_status?: string;
      };
      setPerRow((p) => ({
        ...p,
        [row.id]: {
          kind: "success",
          previousStatus: resp?.previous_status ?? "awaiting_approval",
          newStatus: resp?.new_status ?? "approved",
        },
      }));
      toast.success("Export request approved");
      void load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPerRow((p) => ({ ...p, [row.id]: { kind: "failed", message } }));
      toast.error(`Approval failed: ${message}`);
    } finally {
      // Zero Swallowed Errors - state always advances.
    }
  };

  return (
    <section
      className="rounded-sm border border-border bg-card p-5 space-y-4"
      data-testid="admin-governance-export-approval-panel"
    >
      <header className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
          HQ · Admin Export Controls
        </p>
        <h3 className="text-sm font-medium text-foreground">
          Pending Governance Record export approvals
        </h3>
        <p className="text-xs text-muted-foreground">
          Anchor: <span className="font-mono">{recordRef}</span>
        </p>
      </header>

      <Alert>
        <Lock className="h-4 w-4" />
        <AlertTitle className="text-xs">AAL2 required</AlertTitle>
        <AlertDescription className="text-xs">
          Approving an export request requires multi-factor authentication.
          Approval records a governance decision only - no file is
          generated, no signed URL is minted, and no download link is
          created. A requester may not approve their own request.
        </AlertDescription>
      </Alert>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading pending requests…</p>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle className="text-xs">Could not load requests</AlertTitle>
          <AlertDescription className="text-xs">{loadError}</AlertDescription>
        </Alert>
      )}
      {!loading && !loadError && rows.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="no-pending">
          No pending Governance Record export requests for this anchor.
        </p>
      )}

      <ul className="space-y-3">
        {rows.map((row) => {
          const state = perRow[row.id] ?? { kind: "idle" as const };
          const isSelf = user?.id === row.requester_user_id;
          const legalHold =
            (row.verification as Record<string, unknown> | null)?.[
              "legal_hold_context"
            ] ?? null;
          return (
            <li
              key={row.id}
              className="rounded-sm border border-border bg-background p-3 space-y-2"
              data-testid="pending-request-row"
              data-request-id={row.id}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-mono text-foreground">{row.id}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Requested by{" "}
                    <span className="font-mono">{row.requester_user_id}</span>{" "}
                    at <span>{new Date(row.requested_at).toISOString()}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {row.redaction_mode ?? "redacted_client_safe"}
                  </Badge>
                  {legalHold && (
                    <Badge variant="outline" className="text-[10px]">
                      legal-hold context
                    </Badge>
                  )}
                </div>
              </div>
              {row.reason && (
                <p className="text-[11px] text-foreground whitespace-pre-wrap">
                  <span className="text-muted-foreground">Reason: </span>
                  {row.reason}
                </p>
              )}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-foreground">
                  Approval note (optional, recorded in audit)
                </label>
                <Textarea
                  value={notes[row.id] ?? ""}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [row.id]: e.target.value }))
                  }
                  maxLength={500}
                  rows={2}
                  placeholder="Why is this approval being granted?"
                  data-testid="approval-note"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => approve(row)}
                  disabled={isSelf || state.kind === "submitting"}
                  data-testid="approve-button"
                >
                  <ClipboardCheck className="h-3 w-3 mr-1" />
                  {state.kind === "submitting" ? "Approving…" : "Approve"}
                </Button>
                {isSelf && (
                  <Badge variant="outline" className="text-[10px]">
                    Self-approval blocked - another platform admin must approve.
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  <ShieldCheck className="h-3 w-3 mr-1" />
                  No file generated · No download link
                </Badge>
              </div>
              {state.kind === "success" && (
                <Alert data-testid="approve-success">
                  <AlertTitle className="text-xs">
                    Approval recorded
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    Status: <span className="font-mono">{state.previousStatus}</span>{" "}
                    → <span className="font-mono">{state.newStatus}</span>.
                    Approved means approved only - no file has been generated,
                    no signed URL has been minted, and no download link exists.
                  </AlertDescription>
                </Alert>
              )}
              {state.kind === "denied" && (
                <Alert variant="destructive" data-testid="approve-denied">
                  <AlertTitle className="text-xs">{state.code}</AlertTitle>
                  <AlertDescription className="text-xs">
                    {state.message}
                  </AlertDescription>
                </Alert>
              )}
              {state.kind === "failed" && (
                <Alert variant="destructive" data-testid="approve-failed">
                  <AlertTitle className="text-xs">Approval failed</AlertTitle>
                  <AlertDescription className="text-xs">
                    {state.message}
                  </AlertDescription>
                </Alert>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
