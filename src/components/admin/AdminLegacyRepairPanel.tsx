/**
 * Batch O Phase 2b Step 5 - Legacy Repair queue with admin actions.
 *
 * Wires the existing read-only queue to the two MT-008 admin edge functions:
 *   • `admin-match-legacy-archive`  → marks an inconsistent match as archived/held
 *   • `admin-match-legacy-repair`   → applies a bounded repair operation
 *
 * Hard scope (Step 5):
 *   • UI wiring only. Backend RPCs/edge functions unchanged.
 *   • No detection scan button. No cron. No Daniel-facing material.
 *   • No POI / WaD / payment / credit / notification / rating / compliance
 *     / public-status / lifecycle / SLA / Batch D / Batch E imports.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inconsistencyReasons, type LifecycleMatch } from "@/lib/match-lifecycle";

type Row = {
  id: string;
  commodity: string | null;
  buyer_org_id: string | null;
  seller_org_id: string | null;
  org_id: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  status: string | null;
  state: string | null;
  poi_state: string | null;
  settled_at: string | null;
  completed_at: string | null;
  buyer_committed_at: string | null;
  seller_committed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
  inconsistency_reasons: string[] | null;
};

const REASON_LABEL: Record<string, string> = {
  legacy_repair_required: "Operator marker: legacy repair required",
  state_reconciliation_required: "Operator marker: state reconciliation required",
  settled_with_draft_poi: "Settled status with draft POI",
  completed_state_with_open_poi: "Completed state with open POI",
  settled_at_without_settled_status: "settled_at set but status not terminal",
  both_committed_but_still_discovery: "Both sides committed but state = discovery",
  same_org_both_sides: "Same organisation on both sides",
};

type RepairOperation =
  | "clear_stale_settled_at"
  | "restore_poi_state_for_completed"
  | "clear_legacy_repair_marker"
  | "force_terminal_for_orphan_settled";

const REPAIR_OPERATIONS: ReadonlyArray<{
  value: RepairOperation;
  label: string;
  deferred?: boolean;
  hint: string;
}> = [
  {
    value: "clear_stale_settled_at",
    label: "Clear stale settled_at",
    hint: "Removes a settled_at timestamp that was set without a terminal status.",
  },
  {
    value: "restore_poi_state_for_completed",
    label: "Restore POI state for completed match",
    hint: "Aligns a completed match whose POI state is still open.",
  },
  {
    value: "clear_legacy_repair_marker",
    label: "Clear legacy repair marker",
    hint: "Removes the operator-set legacy_repair_required / state_reconciliation_required marker.",
  },
  {
    value: "force_terminal_for_orphan_settled",
    label: "Force terminal for orphan settled (deferred)",
    deferred: true,
    hint: "Deferred - requires business decision before this operation can run.",
  },
];

const ERROR_COPY: Record<string, string> = {
  VALIDATION_ERROR: "Notes must be between 10 and 2000 characters.",
  OPERATION_DEFERRED:
    "This operation is deferred pending a business decision and cannot be applied yet.",
  OPERATION_NOT_APPLICABLE:
    "The selected operation does not match an inconsistency reason currently present on this row.",
  STILL_INCONSISTENT_AFTER_REPAIR:
    "Repair was applied but the row is still inconsistent. Choose another operation.",
  NOT_INCONSISTENT: "This match is no longer flagged as inconsistent.",
  MATCH_NOT_FOUND: "This match no longer exists.",
  FORBIDDEN: "You do not have permission to perform this action.",
  IDEMPOTENCY_KEY_REQUIRED: "Internal: missing idempotency key. Please retry.",
  INTERNAL_ERROR: "The action could not be completed. Please retry.",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function rowToLifecycle(r: Row): LifecycleMatch {
  return {
    status: r.status,
    state: r.state,
    poi_state: r.poi_state,
    settled_at: r.settled_at,
    completed_at: r.completed_at,
    buyer_committed_at: r.buyer_committed_at,
    seller_committed_at: r.seller_committed_at,
    buyer_org_id: r.buyer_org_id,
    seller_org_id: r.seller_org_id,
    metadata: r.metadata ?? null,
  };
}

function safeErrorCopy(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_COPY[code] ?? fallback;
}

/** Extract the structured error code from a supabase.functions.invoke error. */
async function extractErrorCode(err: unknown): Promise<{ code?: string; message?: string }> {
  // edge functions return JSON like { error: "CODE", message: "..." } with non-2xx status.
  // The supabase-js client wraps that into FunctionsHttpError with a .context.response.
  const anyErr = err as {
    context?: { response?: Response };
    message?: string;
  } | null;
  try {
    const resp = anyErr?.context?.response;
    if (resp) {
      const cloned = resp.clone();
      const body = await cloned.json();
      return { code: body?.error, message: body?.message };
    }
  } catch {
    // fall through
  }
  return { message: anyErr?.message };
}

export function AdminLegacyRepairPanel() {
  const queryClient = useQueryClient();
  const [archiveRow, setArchiveRow] = useState<Row | null>(null);
  const [repairRow, setRepairRow] = useState<Row | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-legacy-repair"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("admin_list_inconsistent_matches");
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
    staleTime: 30_000,
  });

  const refetchQueue = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-legacy-repair"] });

  const recordDetectionsMutation = useMutation({
    mutationFn: async (matchIds: string[]) => {
      const idempotencyKey = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke(
        "admin-match-legacy-record-detections",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: { match_ids: matchIds },
        },
      );
      if (error) {
        const { code, message } = await extractErrorCode(error);
        const friendly = safeErrorCopy(code, message ?? "Detection scan failed");
        throw new Error(friendly);
      }
      return data as {
        ok: true;
        result: {
          scanned: number;
          recorded: number;
          already_recorded: number;
          skipped: number;
        };
      };
    },
    onSuccess: (data) => {
      const r = data.result;
      toast.success(
        `Detection audit recorded for ${r.recorded} match${r.recorded === 1 ? "" : "es"}. ${r.already_recorded} already recorded.`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as Error)?.message ?? "Failed to load legacy repair queue";
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        {msg}
      </div>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground text-center">
        No inconsistent matches detected. All deal lifecycle data is consistent.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {rows.length} match{rows.length === 1 ? "" : "es"} flagged for repair
        </span>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0 || recordDetectionsMutation.isPending}
            onClick={() =>
              recordDetectionsMutation.mutate(rows.map((r) => r.id))
            }
          >
            {recordDetectionsMutation.isPending
              ? "Recording…"
              : "Record detection audit"}
          </Button>
          <span className="font-mono">Admin actions: archive · repair</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Match</th>
              <th className="text-left px-3 py-2 font-medium">Commodity</th>
              <th className="text-left px-3 py-2 font-medium">Buyer org</th>
              <th className="text-left px-3 py-2 font-medium">Seller org</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">State</th>
              <th className="text-left px-3 py-2 font-medium">POI</th>
              <th className="text-left px-3 py-2 font-medium">Reasons</th>
              <th className="text-left px-3 py-2 font-medium">Updated</th>
              <th className="text-left px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              // Prefer client-derived reasons (single source of truth) and
              // fall back to the RPC-supplied list if absent.
              const reasons = inconsistencyReasons(rowToLifecycle(r));
              const reasonCodes = reasons.length
                ? reasons
                : (r.inconsistency_reasons ?? []);
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs">{r.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">{r.commodity ?? "-"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.buyer_org_id ? r.buyer_org_id.slice(0, 8) : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.seller_org_id ? r.seller_org_id.slice(0, 8) : "-"}
                  </td>
                  <td className="px-3 py-2">{r.status ?? "-"}</td>
                  <td className="px-3 py-2">{r.state ?? "-"}</td>
                  <td className="px-3 py-2">{r.poi_state ?? "-"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {reasonCodes.map((reason) => (
                        <Badge
                          key={reason}
                          variant="outline"
                          className="text-[10px] font-normal border-amber-300 bg-amber-50 text-amber-900"
                        >
                          {REASON_LABEL[reason] ?? reason}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.updated_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setArchiveRow(r)}
                      >
                        Archive
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRepairRow(r)}
                      >
                        Repair
                      </Button>
                      <Link
                        to={`/admin?tab=spine&match=${r.id}`}
                        className="text-[11px] text-primary underline-offset-2 hover:underline text-center"
                      >
                        Spine
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ArchiveDialog
        row={archiveRow}
        onClose={() => setArchiveRow(null)}
        onSuccess={() => {
          setArchiveRow(null);
          refetchQueue();
        }}
      />
      <RepairDialog
        row={repairRow}
        onClose={() => setRepairRow(null)}
        onSuccess={() => {
          setRepairRow(null);
          refetchQueue();
        }}
      />
    </div>
  );
}

// ─── Archive dialog ────────────────────────────────────────────────────────

function ArchiveDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: Row | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [notes, setNotes] = useState("");
  const trimmed = notes.trim();
  const valid = trimmed.length >= 10 && trimmed.length <= 2000;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row selected");
      const idempotencyKey = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke(
        "admin-match-legacy-archive",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: { match_id: row.id, notes: trimmed },
        },
      );
      if (error) {
        const { code, message } = await extractErrorCode(error);
        const friendly = safeErrorCopy(code, message ?? "Archive failed");
        throw new Error(friendly);
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Match archived.");
      setNotes("");
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          setNotes("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive legacy match</DialogTitle>
          <DialogDescription>
            This keeps the match hidden from normal user progression. It does not
            change POI, WaD, payments, credits or notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="archive-notes">Admin notes (required, 10–2000 chars)</Label>
          <Textarea
            id="archive-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Reason for archiving this legacy row..."
            disabled={mutation.isPending}
          />
          <p className="text-xs text-muted-foreground">{trimmed.length} / 2000</p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (mutation.isPending) return;
              setNotes("");
              onClose();
            }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!valid || mutation.isPending}
          >
            {mutation.isPending ? "Archiving..." : "Confirm archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Repair dialog ─────────────────────────────────────────────────────────

function RepairDialog({
  row,
  onClose,
  onSuccess,
}: {
  row: Row | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [operation, setOperation] = useState<RepairOperation | "">("");
  const [notes, setNotes] = useState("");
  const trimmed = notes.trim();
  const notesValid = trimmed.length >= 10 && trimmed.length <= 2000;
  const selectedOp = useMemo(
    () => REPAIR_OPERATIONS.find((o) => o.value === operation),
    [operation],
  );
  const opValid = !!selectedOp && !selectedOp.deferred;
  const valid = notesValid && opValid;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!row || !operation) throw new Error("Missing row or operation");
      const idempotencyKey = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke(
        "admin-match-legacy-repair",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: { match_id: row.id, operation, notes: trimmed },
        },
      );
      if (error) {
        const { code, message } = await extractErrorCode(error);
        const friendly = safeErrorCopy(code, message ?? "Repair failed");
        throw new Error(friendly);
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Repair applied.");
      setNotes("");
      setOperation("");
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) {
          setNotes("");
          setOperation("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repair legacy match</DialogTitle>
          <DialogDescription>
            Applies a single bounded repair operation. POI, WaD, payments,
            credits and notifications are not affected.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="repair-operation">Operation</Label>
            <Select
              value={operation}
              onValueChange={(v) => setOperation(v as RepairOperation)}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="repair-operation">
                <SelectValue placeholder="Select an operation" />
              </SelectTrigger>
              <SelectContent>
                {REPAIR_OPERATIONS.map((op) => (
                  <SelectItem
                    key={op.value}
                    value={op.value}
                    disabled={op.deferred}
                  >
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOp && (
              <p className="text-xs text-muted-foreground">{selectedOp.hint}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="repair-notes">Admin notes (required, 10–2000 chars)</Label>
            <Textarea
              id="repair-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Reason for this repair..."
              disabled={mutation.isPending}
            />
            <p className="text-xs text-muted-foreground">{trimmed.length} / 2000</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (mutation.isPending) return;
              setNotes("");
              setOperation("");
              onClose();
            }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!valid || mutation.isPending}
          >
            {mutation.isPending ? "Applying..." : "Confirm repair"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
