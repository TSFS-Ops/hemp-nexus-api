/**
 * Batch 3 — small badge helpers for the funder workspace UI.
 * The release-status badge accepts the *effective* status (see
 * lib/funder-workspace/release-state.ts) so admin + funder surfaces
 * render identical colours and labels.
 */
import { Badge } from "@/components/ui/badge";
import type { ConsentStatus } from "@/lib/funder-workspace/types";
import {
  statusBadgeVariant,
  statusLabel,
  type EffectiveReleaseStatus,
} from "@/lib/funder-workspace/release-state";

export function FunderReleaseStatusBadge({
  status,
}: {
  status: EffectiveReleaseStatus;
}) {
  return <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>;
}

export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
  const variant =
    status === "granted" || status === "not_required"
      ? "default"
      : status === "overridden" || status === "declined"
      ? "destructive"
      : "secondary";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}

export function PermissionBadge({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? "default" : "secondary"}>{value ? "Yes" : "No"}</Badge>
  );
}
