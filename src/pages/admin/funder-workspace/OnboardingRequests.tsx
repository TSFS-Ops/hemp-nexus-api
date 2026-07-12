/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin: Onboarding Requests. Platform-admin guarded at route layer.
 * All mutations go through fw_admin_approve_funder_org_v1 /
 * fw_admin_reject_funder_org_v1.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  approveOnboardingRequest,
  listOnboardingRequests,
  rejectOnboardingRequest,
} from "@/lib/funder-workspace/admin-client";
import { FUNDER_TYPE_LABELS, type OnboardingRequestRow } from "@/lib/funder-workspace/types";

type DialogMode = { kind: "approve" | "reject"; row: OnboardingRequestRow } | null;

const TERMINAL_STATUSES = new Set(["approved", "rejected", "withdrawn"]);

export default function FunderWorkspaceOnboarding() {
  const [rows, setRows] = useState<OnboardingRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await listOnboardingRequests();
      setRows(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeDialog = () => {
    setDialog(null);
    setReason("");
    setNotes("");
  };

  const handleApprove = async () => {
    if (!dialog || dialog.kind !== "approve") return;
    setBusy(true);
    try {
      await approveOnboardingRequest({
        p_request_id: dialog.row.id,
        p_notes_internal: notes.trim() || null,
      });
      toast.success("Funder onboarding approved");
      closeDialog();
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!dialog || dialog.kind !== "reject") return;
    const trimmed = reason.trim();
    if (trimmed === "") {
      toast.error("Rejection reason is required");
      return;
    }
    setBusy(true);
    try {
      await rejectOnboardingRequest({
        p_request_id: dialog.row.id,
        p_reason: trimmed,
      });
      toast.success("Funder onboarding rejected");
      closeDialog();
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4" data-testid="fw-admin-onboarding">
      <div>
        <h1 className="text-2xl font-semibold">Funder Onboarding Requests</h1>
        <p className="text-sm text-muted-foreground">
          Approve or reject applications from prospective funder organisations. Rejections require a reason.
        </p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">Failed to load: {error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Funder type</TableHead>
                <TableHead>Jurisdiction</TableHead>
                <TableHead>Approved domain</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reviewed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((r) => {
                const isTerminal = TERMINAL_STATUSES.has(r.status);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.organisation_name}</TableCell>
                    <TableCell>{FUNDER_TYPE_LABELS[r.funder_type] ?? r.funder_type}</TableCell>
                    <TableCell>{r.jurisdiction ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.approved_email_domain ?? "—"}</TableCell>
                    <TableCell>
                      <div>{r.primary_contact_name}</div>
                      <div className="text-xs text-muted-foreground">{r.primary_contact_email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isTerminal}
                        onClick={() => setDialog({ kind: "approve", row: r })}
                        data-testid={`fw-onboarding-approve-${r.id}`}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isTerminal}
                        onClick={() => setDialog({ kind: "reject", row: r })}
                        data-testid={`fw-onboarding-reject-${r.id}`}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows !== null && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    No onboarding requests.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialog?.kind === "approve"} onOpenChange={(v) => { if (!v) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve funder onboarding</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Confirm approval for <span className="font-medium">{dialog?.row.organisation_name}</span>. This
              will create the funder organisation record and cannot be undone from this screen.
            </p>
            <Label htmlFor="fw-approve-notes">Internal notes (optional)</Label>
            <Textarea
              id="fw-approve-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal review notes — not shown to the funder."
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleApprove} disabled={busy} data-testid="fw-onboarding-approve-confirm">
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "reject"} onOpenChange={(v) => { if (!v) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject funder onboarding</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              Rejecting <span className="font-medium">{dialog?.row.organisation_name}</span>. A written reason is
              required and will be stored on the audit ledger.
            </p>
            <Label htmlFor="fw-reject-reason">Rejection reason (required)</Label>
            <Textarea
              id="fw-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this application cannot be approved."
              maxLength={1000}
              required
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={busy || reason.trim() === ""}
              data-testid="fw-onboarding-reject-confirm"
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
