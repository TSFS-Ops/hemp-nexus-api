/**
 * Institutional Funder Evidence Workspace
 * Admin-only "Edit release permissions" dialog.
 *
 * UI-only surface. All authorisation, validation, and audit logging
 * live in fw_admin_update_release_permissions_v1. This component only:
 *   - Renders the six current flags as toggles.
 *   - Requires a written reason.
 *   - Shows a confirmation summary of what will change.
 *   - Disables save until a real change exists AND reason is valid
 *     AND raw-download consistency holds.
 *   - Calls the RPC and surfaces the result.
 *
 * The control is only rendered by callers who have already gated on
 * platform_admin (see ReleaseDetail). Even so, the server rejects
 * non-admin callers regardless of what the UI shows.
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  RELEASE_PERMISSION_KEYS,
  RELEASE_PERMISSION_LABEL,
  ELEVATED_PERMISSION_KEYS,
  type ReleasePermissionKey,
  type ReleasePermissionSet,
  diffPermissions,
  permissionsFromRelease,
  validatePermissionEdit,
} from "@/lib/funder-workspace/release-permission-edit";
import {
  updateReleasePermissions,
  type UpdateReleasePermissionsResult,
} from "@/lib/funder-workspace/admin-client";

interface Props {
  releaseId: string;
  currentPermissions: Partial<Record<ReleasePermissionKey, boolean>>;
  disabled?: boolean;
  disabledReason?: string;
  onUpdated: (result: UpdateReleasePermissionsResult) => void;
}

export function EditReleasePermissionsButton({
  releaseId,
  currentPermissions,
  disabled,
  disabledReason,
  onUpdated,
}: Props) {
  const [open, setOpen] = useState(false);
  const before = useMemo(() => permissionsFromRelease(currentPermissions), [currentPermissions]);
  const [draft, setDraft] = useState<ReleasePermissionSet>(before);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const openDialog = () => {
    setDraft(permissionsFromRelease(currentPermissions));
    setReason("");
    setOpen(true);
  };

  const validation = validatePermissionEdit(before, draft, reason);
  const changes = diffPermissions(before, draft);
  const canSave = validation === null && !busy;

  const handleSave = async () => {
    if (validation) {
      toast.error(validation.message);
      return;
    }
    setBusy(true);
    try {
      const res = await updateReleasePermissions({
        p_release_id: releaseId,
        p_can_view_evidence_summary: draft.can_view_evidence_summary,
        p_can_view_evidence_room: draft.can_view_evidence_room,
        p_can_download_compiled_pack: draft.can_download_compiled_pack,
        p_can_view_raw_documents: draft.can_view_raw_documents,
        p_can_download_raw_documents: draft.can_download_raw_documents,
        p_can_view_unmasked_sensitive_details: draft.can_view_unmasked_sensitive_details,
        p_reason: reason,
      });
      toast.success(res.changed ? "Release permissions updated" : "No change applied");
      setOpen(false);
      onUpdated(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={openDialog}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        data-testid="fw-admin-edit-permissions"
      >
        Edit permissions
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : setOpen(false))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Amend release permissions</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Only the six release permission flags may be amended here. Organisation, deal,
              evidence pack, consent, status and history remain unchanged. Every change is
              recorded as an audited <span className="font-mono">funder_deal.permissions_updated</span>{" "}
              event.
            </p>

            <div className="space-y-2" data-testid="fw-admin-edit-permissions-toggles">
              {RELEASE_PERMISSION_KEYS.map((k) => {
                const elevated = ELEVATED_PERMISSION_KEYS.includes(k);
                const changed = before[k] !== draft[k];
                return (
                  <label
                    key={k}
                    htmlFor={`fw-perm-${k}`}
                    className={`flex items-center justify-between rounded border p-2 text-sm ${
                      changed ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <span>
                      {RELEASE_PERMISSION_LABEL[k]}
                      {elevated && (
                        <span className="ml-2 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-medium uppercase text-destructive">
                          Elevated
                        </span>
                      )}
                    </span>
                    <Checkbox
                      id={`fw-perm-${k}`}
                      checked={draft[k]}
                      onCheckedChange={(v) =>
                        setDraft((d) => ({ ...d, [k]: v === true }))
                      }
                      data-testid={`fw-perm-toggle-${k}`}
                    />
                  </label>
                );
              })}
            </div>

            {validation?.code === "raw_download_requires_raw_view" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Invalid combination</AlertTitle>
                <AlertDescription>{validation.message}</AlertDescription>
              </Alert>
            )}

            {changes.length > 0 && (
              <div
                className="rounded border bg-muted/40 p-3 text-xs"
                data-testid="fw-admin-edit-permissions-summary"
              >
                <div className="mb-1 font-medium">Changes to apply</div>
                <ul className="space-y-1">
                  {changes.map((c) => (
                    <li key={c.key}>
                      <span className="font-medium">{RELEASE_PERMISSION_LABEL[c.key]}:</span>{" "}
                      <span className="font-mono">{c.from ? "On" : "Off"}</span> →{" "}
                      <span className="font-mono">{c.to ? "On" : "Off"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="fw-perm-reason">Reason (required)</Label>
              <Textarea
                id="fw-perm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder="Why is this amendment necessary?"
                data-testid="fw-admin-edit-permissions-reason"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={!canSave}
              data-testid="fw-admin-edit-permissions-save"
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
