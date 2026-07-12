/**
 * Batch 3 — small badge helpers for the funder workspace UI.
 */
import { Badge } from "@/components/ui/badge";
import type { ConsentStatus, ReleaseStatus } from "@/lib/funder-workspace/types";

export function FunderReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const variant =
    status === "active" ? "default" : status === "revoked" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
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
